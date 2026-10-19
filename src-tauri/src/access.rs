//! What the webview may touch on disk. Plugins run in the webview with the
//! app's own permissions, so these limits apply to them too:
//! - Files: only the notes folder (granted here at runtime) and the installed
//!   plugins' folder (capabilities/default.json), not the whole disk.
//! - Which notes folder: one chosen in Forgor's own folder dialog (`vault_pick`),
//!   the default one, or (once, when updating from a version without this list)
//!   the folder that was already open. The list lives in app data, which the
//!   webview can read but not write, so a script can't add folders to it.
//! - Opening files with their default app (`open_path`): only files in a notes
//!   folder that aren't programs or scripts, and plain folders.
//! - A new plugin project is written here too (`plugin_project_create`), in a
//!   folder chosen in Rust's dialog.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

const FILE: &str = "trusted-folders.json";

#[derive(Default, Serialize, Deserialize)]
struct Trusted {
    folders: Vec<PathBuf>,
}

/// None until read from disk; `bootstrap` while the file didn't exist yet.
struct State {
    trusted: Trusted,
    bootstrap: bool,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn list_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(FILE))
}

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut State) -> T) -> Result<T, String> {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let path = list_path(app)?;
        let state = match std::fs::read_to_string(&path) {
            Ok(text) => State { trusted: serde_json::from_str(&text).unwrap_or_default(), bootstrap: false },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State { trusted: Trusted::default(), bootstrap: true },
            Err(e) => return Err(format!("Couldn't read {FILE}: {e}")),
        };
        *guard = Some(state);
    }
    Ok(f(guard.as_mut().unwrap()))
}

fn save(app: &AppHandle, trusted: &Trusted) -> Result<(), String> {
    let path = list_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(trusted).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Couldn't save {FILE}: {e}"))
}

/// The real path (symlinks resolved) when it exists, else as given without trailing separators.
fn normalize(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| {
        let s = path.to_string_lossy();
        PathBuf::from(s.trim_end_matches(['/', '\\']))
    })
}

fn same(a: &Path, b: &Path) -> bool {
    let (a, b) = (normalize(a), normalize(b));
    if cfg!(windows) {
        a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

fn has_parent_dir(path: &Path) -> bool {
    path.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

fn inside(path: &Path, dir: &Path) -> bool {
    if has_parent_dir(path) {
        return false;
    }
    let (p, d) = (normalize(path), normalize(dir));
    if cfg!(windows) {
        let (p, d) = (p.to_string_lossy().to_lowercase(), d.to_string_lossy().to_lowercase());
        PathBuf::from(p).starts_with(PathBuf::from(d))
    } else {
        p.starts_with(d)
    }
}

/// Folders that are fine without being picked: the suggested default, and in dev builds the repo's dev-vault/.
fn built_in(app: &AppHandle, dir: &Path) -> bool {
    if let Ok(docs) = app.path().document_dir() {
        if same(dir, &docs.join("Forgor")) {
            return true;
        }
    }
    cfg!(debug_assertions) && same(dir, &Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("dev-vault"))
}

/// The app's own dot-folders in a notes folder (TRASH_DIR, MEETINGS_DIR in src/lib/paths.ts).
const DOT_FOLDERS: &[&str] = &[".trash", ".meetings"];

/// Lets the webview read and write the folder (files and asset URLs), as given and as its real path.
/// Runtime grants always skip dot-folders on macOS/Linux (the fs plugin builds this scope without its
/// `requireLiteralLeadingDot` setting), so the app's own ones are granted by name. Other dot-folders
/// (.git, .obsidian…) stay out of reach.
fn grant(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let real = normalize(dir);
    for path in [dir.to_path_buf(), real] {
        app.fs_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;
        for dot in DOT_FOLDERS {
            app.fs_scope().allow_directory(path.join(dot), true).map_err(|e| e.to_string())?;
        }
        app.asset_protocol_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn trust(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let changed = with_state(app, |s| {
        s.bootstrap = false;
        if s.trusted.folders.iter().any(|f| same(f, dir)) {
            return None;
        }
        s.trusted.folders.push(normalize(dir));
        Some(Trusted { folders: s.trusted.folders.clone() })
    })?;
    match changed {
        Some(trusted) => save(app, &trusted),
        None => Ok(()),
    }
}

/// The notes folder dialog. The chosen folder becomes one the app may open.
#[tauri::command]
pub async fn vault_pick(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Choose your notes folder").blocking_pick_folder();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    trust(&app, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Opens (creating it if needed) a notes folder for the webview, if it may.
#[tauri::command]
pub fn vault_open(app: AppHandle, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() || has_parent_dir(&dir) {
        return Err(format!("Not a full path: {path}"));
    }
    let known = with_state(&app, |s| s.bootstrap || s.trusted.folders.iter().any(|f| same(f, &dir)))?;
    if !known && !built_in(&app, &dir) {
        return Err(format!("untrusted-folder: {path} wasn't chosen in Forgor. Choose it again."));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {path}: {e}"))?;
    trust(&app, &dir)?;
    grant(&app, &dir)
}

/// Plugins → Create plugin project: asks where (Rust's own dialog), then writes
/// `<there>/<folder>/` with the files. Done here, not in the webview: the webview
/// can't write outside the notes folder, and a folder granted to it at runtime
/// skips dot-files on macOS (`.gitignore` failed). Returns the folder, or None when cancelled.
#[tauri::command]
pub async fn plugin_project_create(app: AppHandle, folder: String, files: HashMap<String, String>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Choose where to create the plugin project").blocking_pick_folder();
    let Some(parent) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    write_project(&parent, &folder, &files).map(|dir| Some(dir.to_string_lossy().into_owned()))
}

fn write_project(parent: &Path, folder: &str, files: &HashMap<String, String>) -> Result<PathBuf, String> {
    let valid_id = !folder.is_empty() && folder.len() <= 64 && folder.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !folder.starts_with('-');
    if !valid_id {
        return Err(format!("\"{folder}\" isn't a valid plugin id."));
    }
    let dir = parent.join(folder);
    if dir.exists() {
        return Err(format!("There's already a folder \"{folder}\" there. Choose another place, or another name."));
    }
    // Check every path before writing anything: only plain relative paths inside the project.
    let mut targets = Vec::with_capacity(files.len());
    for (name, text) in files {
        let rel = Path::new(name);
        let plain = !name.is_empty() && rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
        if !plain {
            return Err(format!("Not a project file path: {name}"));
        }
        targets.push((dir.join(rel), text));
    }
    for (path, text) in targets {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("Couldn't create {}: {e}", p.display()))?;
        }
        std::fs::write(&path, text).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
    }
    Ok(dir)
}

/// What opening runs instead of showing: apps, installers, scripts, shortcuts.
const PROGRAMS: &[&str] = &[
    // macOS
    "app", "command", "tool", "terminal", "workflow", "action", "scpt", "scptd", "applescript", "pkg", "mpkg", "fileloc", "inetloc", "mobileconfig", "prefpane", "kext", "bundle", "plugin", "saver", "dylib",
    // Windows
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "msc", "lnk", "scr", "pif", "reg", "hta", "cpl", "inf", "url", "appref-ms", "application", "gadget", "dll", "sys",
    // anywhere
    "sh", "bash", "zsh", "csh", "ksh", "fish", "py", "pyc", "pyw", "pl", "rb", "php", "jar", "desktop", "appimage", "run", "bin", "so",
];

fn is_program(path: &Path) -> bool {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase());
    if ext.is_some_and(|e| PROGRAMS.contains(&e.as_str())) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0) {
            return true;
        }
    }
    false
}

/// Opens a file with its default app, or a folder in Finder / Explorer.
/// Files: only inside a notes folder, and never programs or scripts.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let target = normalize(Path::new(&path));
    let meta = std::fs::metadata(&target).map_err(|_| format!("{path} doesn't exist."))?;
    if meta.is_dir() {
        // A folder with an extension can be an app bundle (Something.app).
        if target.extension().is_some() {
            return Err(format!("Forgor only opens plain folders, not {path}."));
        }
    } else {
        let folders = with_state(&app, |s| s.trusted.folders.clone())?;
        if !folders.iter().any(|f| inside(&target, f)) {
            return Err(format!("Forgor only opens files in your notes folder, not {path}."));
        }
        if is_program(&target) {
            return Err("Forgor doesn't open programs or scripts. Use “Show in Finder / Explorer” to find the file.".into());
        }
    }
    app.opener().open_path(target.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_are_refused() {
        for name in ["Calculator.app", "x.COMMAND", "a.exe", "run.sh", "evil.js", "x.lnk", "profile.mobileconfig"] {
            assert!(is_program(Path::new(name)), "{name}");
        }
        for name in ["notes.pdf", "photo.PNG", "talk.mp4", "sheet.xlsx", "README"] {
            assert!(!is_program(Path::new(name)), "{name}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn executable_files_are_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("forgor-access-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("innocent.txt");
        std::fs::write(&file, "#!/bin/sh\n").unwrap();
        assert!(!is_program(&file));
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_program(&file));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_a_project_with_dot_files_and_refuses_odd_paths() {
        let parent = std::env::temp_dir().join(format!("forgor-project-{}", std::process::id()));
        std::fs::create_dir_all(&parent).unwrap();
        let files: HashMap<String, String> = [(".gitignore", "dist\n"), ("src/index.tsx", "x"), ("scripts/zip.mjs", "y")].into_iter().map(|(a, b)| (a.into(), b.into())).collect();
        let dir = write_project(&parent, "my-plugin", &files).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), "dist\n");
        assert_eq!(std::fs::read_to_string(dir.join("src/index.tsx")).unwrap(), "x");
        assert!(write_project(&parent, "my-plugin", &files).unwrap_err().contains("already a folder"));
        for bad in ["../escape.txt", "/etc/x", "a/../../b", ""] {
            let files: HashMap<String, String> = [(bad.to_string(), "x".to_string())].into();
            assert!(write_project(&parent, "other", &files).is_err(), "{bad}");
        }
        assert!(!parent.join("other").exists() && !parent.join("escape.txt").exists());
        assert!(write_project(&parent, "../up", &HashMap::new()).is_err());
        std::fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn inside_needs_a_whole_folder_name() {
        assert!(inside(Path::new("/a/notes/x.pdf"), Path::new("/a/notes")));
        assert!(inside(Path::new("/a/notes/x.pdf"), Path::new("/a/notes/")));
        assert!(!inside(Path::new("/a/notes-evil/x.pdf"), Path::new("/a/notes")));
        assert!(!inside(Path::new("/a/notes/../x.pdf"), Path::new("/a/notes")));
    }
}
