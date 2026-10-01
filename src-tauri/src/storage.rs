//! Settings → Storage: how much Forgor uses on this device, and where.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// What it is ("notes", "attachments", "trash", "meetings", "database", "model:speech", …).
    id: String,
    path: String,
    bytes: u64,
}

/// Total size of a file or folder (0 when missing). `skip`: top-level folder names to leave out.
fn size_of(path: &Path, skip: &[&str]) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| !skip.iter().any(|s| e.file_name() == *s))
        .map(|e| size_of(&e.path(), &[]))
        .sum()
}

/// Sizes in the notes folder, split into notes, attachments, unassigned
/// recordings and trash. Attachment folders sit next to notes at any depth.
fn vault_usage(root: &Path) -> (u64, u64) {
    fn walk(dir: &Path, notes: &mut u64, attachments: &mut u64) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            let path = e.path();
            if name.starts_with('.') {
                continue; // .trash, .meetings (counted separately), .git…
            }
            if name == "_attachments" {
                *attachments += size_of(&path, &[]);
            } else if path.is_dir() {
                walk(&path, notes, attachments);
            } else {
                *notes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    let (mut notes, mut attachments) = (0, 0);
    walk(root, &mut notes, &mut attachments);
    (notes, attachments)
}

fn entry(id: impl Into<String>, path: &Path, bytes: u64) -> Usage {
    Usage { id: id.into(), path: path.to_string_lossy().into_owned(), bytes }
}

#[tauri::command]
pub async fn storage_usage(app: AppHandle, vault: Option<String>) -> Result<Vec<Usage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        if let Some(root) = vault.map(PathBuf::from).filter(|p| p.is_dir()) {
            let (notes, attachments) = vault_usage(&root);
            out.push(entry("notes", &root, notes));
            out.push(entry("attachments", &root, attachments));
            out.push(entry("meetings", &root.join(".meetings"), size_of(&root.join(".meetings"), &[])));
            out.push(entry("trash", &root.join(".trash"), size_of(&root.join(".trash"), &[])));
        }

        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let db: u64 = ["forgor.db", "forgor.db-wal", "forgor.db-shm"].iter().map(|f| size_of(&data.join(f), &[])).sum();
        out.push(entry("database", &data.join("forgor.db"), db));
        for model in crate::meetings::models::MODELS {
            let dir = data.join("models").join(model.id);
            out.push(entry(format!("model:{}", model.id), &dir, size_of(&dir, &[])));
        }
        out.push(entry("recordings", &data.join("recordings"), size_of(&data.join("recordings"), &[])));
        // Anything else in the app data folder.
        let known = ["forgor.db", "forgor.db-wal", "forgor.db-shm", "models", "recordings"];
        out.push(entry("app-other", &data, size_of(&data, &known)));

        // The webview's own storage and caches (managed by the OS webview).
        let mut cache = 0;
        let mut cache_path = None;
        let mut add = |p: PathBuf| {
            if p.exists() && p != data {
                cache += size_of(&p, &[]);
                cache_path.get_or_insert(p);
            }
        };
        if let Ok(p) = app.path().app_cache_dir() {
            add(p);
        }
        if let Ok(p) = app.path().app_local_data_dir() {
            add(p); // Windows: the WebView2 profile lives here
        }
        #[cfg(target_os = "macos")]
        if let Ok(home) = app.path().home_dir() {
            add(home.join("Library/WebKit").join(&app.config().identifier));
        }
        if let Some(p) = cache_path {
            out.push(entry("cache", &p, cache));
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_notes_folder() {
        let dir = std::env::temp_dir().join(format!("forgor-storage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, len) in [("a.md", 10), ("Klant/b.md", 20), ("Klant/_attachments/x.png", 300), (".trash/old.md", 4000), (".meetings/m.md", 50000)] {
            let p = dir.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, vec![0u8; len]).unwrap();
        }
        assert_eq!(vault_usage(&dir), (30, 300));
        assert_eq!(size_of(&dir.join(".trash"), &[]), 4000);
        assert_eq!(size_of(&dir, &[".trash", ".meetings"]), 330);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
