//! Small secrets in the OS keychain (macOS Keychain / Windows Credential
//! Manager), by name: the plugin store's publish keys ("store:<plugin id>")
//! and plugins' sign-in refresh tokens ("oauth:…", oauth.rs). Never in the
//! database or settings. Like Jira's token, each value is read from the
//! keychain once per run and then cached (every read can prompt on macOS).
//!
//! The webview (and so every plugin) only reaches the store's keys through
//! the commands below: refresh tokens never leave Rust.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

const SERVICE: &str = "Forgor";

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    let valid = !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || ":._-".contains(c));
    if !valid {
        return Err(format!("Not a valid secret name: {name}"));
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| format!("Keychain unavailable: {e}"))
}

/// What the webview may read and write: the store's publish keys only.
fn webview_may(name: &str) -> Result<(), String> {
    if name.starts_with("store:") {
        Ok(())
    } else {
        Err(format!("Not a secret the app may read: {name}"))
    }
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    webview_may(&name)?;
    read(name)
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    webview_may(&name)?;
    write(name, value)
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    webview_may(&name)?;
    remove(name)
}

pub fn read(name: String) -> Result<Option<String>, String> {
    if let Some(cached) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(&name) {
        return Ok(cached.clone());
    }
    let value = match entry(&name)?.get_password() {
        Ok(v) => Some(v),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => return Err(format!("Couldn't read from the keychain: {e}")),
    };
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(name, value.clone());
    Ok(value)
}

pub fn write(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|e| format!("Couldn't save in the keychain: {e}"))?;
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(name, Some(value));
    Ok(())
}

pub fn remove(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("Couldn't remove it from the keychain: {e}")),
    }
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(name, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_webview_only_reaches_the_store_keys() {
        assert!(webview_may("store:hello").is_ok());
        assert!(webview_may("oauth:mail:0123abcd").is_err());
        assert!(secret_get("oauth:mail:0123abcd".into()).is_err());
        assert!(secret_set("jira".into(), "x".into()).is_err());
        assert!(secret_delete("oauth:mail:0123abcd".into()).is_err());
    }
}
