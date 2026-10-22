//! Bitbucket Cloud: read-only requests with the user's Atlassian email + an API
//! token with Bitbucket scopes (Basic auth). Like Jira's, the token lives in the
//! OS keychain, is read once per run, and requests go through Rust (the webview
//! can't call Bitbucket: CORS, and the token must stay out of it).

use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};

const SERVICE: &str = "Forgor Bitbucket";
const API: &str = "https://api.bitbucket.org";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// "{…}": what pull requests name authors and reviewers by.
    pub uuid: String,
    pub display_name: String,
    pub email: String,
}

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn entry(email: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, email).map_err(|e| format!("Keychain unavailable: {e}"))
}

/// Only GETs on the API's own paths.
fn valid_path(path: &str) -> bool {
    path.starts_with("/2.0/") && !path.contains("..") && !path.contains("://") && !path.contains('#')
}

async fn get(email: &str, token: &str, path: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{API}{path}"))
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Bitbucket didn't answer in time".to_string() } else { format!("Couldn't reach Bitbucket: {e}") })?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    match status {
        200..=299 => serde_json::from_str(&body).map_err(|e| format!("Unexpected answer from Bitbucket: {e}")),
        401 => Err("Bitbucket didn't accept the email and API token (wrong, expired, revoked, or a token without Bitbucket scopes). Connect again in the Bitbucket plugin's settings.".into()),
        403 => Err(format!("Bitbucket refused this: {}", message(&body).unwrap_or_else(|| "the token may be missing a scope (it needs read access to the account, workspaces, repositories and pull requests).".into()))),
        // The path (without its query) says which request it was.
        404 => Err(format!("Not found in Bitbucket (deleted, or no access): {}", path.split('?').next().unwrap_or(path))),
        429 => Err("Bitbucket is limiting requests right now; try again in a minute.".into()),
        _ => Err(format!("Bitbucket answered {status}: {}", message(&body).unwrap_or_else(|| body.chars().take(200).collect()))),
    }
}

/// Bitbucket's error text (`{"error": {"message": …, "detail": …}}`).
fn message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let e = &v["error"];
    let text = [e["message"].as_str(), e["detail"].as_str()].into_iter().flatten().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

fn token(email: &str) -> Result<String, String> {
    let cached = || cache().lock().unwrap_or_else(|e| e.into_inner()).get(email).cloned();
    if let Some(t) = cached() {
        return Ok(t);
    }
    // One keychain read at a time: a page fires several requests at once, and each would prompt.
    static READING: Mutex<()> = Mutex::new(());
    let _reading = READING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = cached() {
        return Ok(t);
    }
    match entry(email)?.get_password() {
        Ok(t) => {
            cache().lock().unwrap_or_else(|e| e.into_inner()).insert(email.to_string(), t.clone());
            Ok(t)
        }
        Err(keyring::Error::NoEntry) => Err("Not connected to Bitbucket. Connect your account in the Bitbucket plugin's settings.".into()),
        Err(e) => Err(format!("Couldn't read the token from the keychain: {e}")),
    }
}

/// Checks the token with Bitbucket and stores it in the keychain.
#[tauri::command]
pub async fn bitbucket_connect(email: String, token: String) -> Result<Account, String> {
    let (email, token) = (email.trim().to_string(), token.trim().to_string());
    if email.is_empty() || token.is_empty() {
        return Err("Enter your email and an API token".into());
    }
    let me = get(&email, &token, "/2.0/user").await?;
    entry(&email)?.set_password(&token).map_err(|e| format!("Couldn't save the token in the keychain: {e}"))?;
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(email.clone(), token);
    Ok(Account {
        uuid: me["uuid"].as_str().unwrap_or_default().to_string(),
        display_name: me["display_name"].as_str().unwrap_or(&email).to_string(),
        email,
    })
}

/// Forgets the token.
#[tauri::command]
pub fn bitbucket_disconnect(email: String) -> Result<(), String> {
    cache().lock().unwrap_or_else(|e| e.into_inner()).remove(&email);
    match entry(&email)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the token from the keychain: {e}")),
    }
}

/// GET an API path ("/2.0/…") on api.bitbucket.org. Read-only.
#[tauri::command]
pub async fn bitbucket_get(email: String, path: String) -> Result<serde_json::Value, String> {
    if !valid_path(&path) {
        return Err("Not a Bitbucket API path".into());
    }
    let token = token(&email)?;
    get(&email, &token, &path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_api_paths() {
        assert!(valid_path("/2.0/user"));
        assert!(valid_path("/2.0/repositories/acme/web/pullrequests?state=OPEN&q=author.uuid%3D%22x%22"));
        assert!(!valid_path("/1.0/user"));
        assert!(!valid_path("https://evil.example/2.0/user"));
        assert!(!valid_path("/2.0/../internal"));
        assert!(!valid_path("/2.0/x?next=https://evil.example"));
    }

    #[test]
    fn error_messages_from_bitbucket() {
        assert_eq!(message(r#"{"type":"error","error":{"message":"Token is invalid","detail":"Missing scope"}}"#).unwrap(), "Token is invalid Missing scope");
        assert!(message("<html>").is_none());
    }
}
