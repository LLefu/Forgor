//! Jira Cloud: requests with the user's email + API token (Basic auth). The
//! token lives in the OS keychain (macOS Keychain / Windows Credential
//! Manager), never in the database or settings. Requests go through Rust
//! because the webview can't call Atlassian directly (CORS).

use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};

const SERVICE: &str = "Forgor Jira";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Normalized: "https://acme.atlassian.net".
    pub site: String,
    pub account_id: String,
    pub display_name: String,
    pub email: String,
}

/// "acme", "acme.atlassian.net" or any URL on the site → "https://acme.atlassian.net".
fn normalize_site(input: &str) -> Result<String, String> {
    let s = input.trim().trim_start_matches("https://").trim_start_matches("http://");
    let host = s.split(['/', '?', '#']).next().unwrap_or("").to_lowercase();
    let host = if host.contains('.') { host } else { format!("{host}.atlassian.net") };
    let valid = host.len() > ".atlassian.net".len() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    if !valid {
        return Err("Enter your Jira address, e.g. yourcompany.atlassian.net".into());
    }
    Ok(format!("https://{host}"))
}

/// Tokens read from the keychain this run. Reading it on every request made
/// macOS ask for keychain access again and again (each read can prompt, and
/// "Always allow" doesn't survive a new build).
fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn cache_key(site: &str, email: &str) -> String {
    format!("{email} @ {site}")
}

fn entry(site: &str, email: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("{email} @ {site}")).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())
}

async fn get(site: &str, email: &str, token: &str, path: &str) -> Result<serde_json::Value, String> {
    let response = client()?
        .get(format!("{site}{path}"))
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Jira didn't answer in time".to_string() } else { format!("Couldn't reach Jira: {e}") })?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    match status {
        200..=299 => serde_json::from_str(&body).map_err(|e| format!("Unexpected answer from Jira: {e}")),
        401 => Err("Jira didn't accept the email and API token (wrong, expired or revoked). Connect again in Settings → Jira.".into()),
        403 => Err("Your Jira account has no access to this.".into()),
        404 => Err("Not found in Jira (deleted, or no access).".into()),
        429 => Err("Jira is limiting requests right now; try again in a minute.".into()),
        _ => Err(format!("Jira answered {status}: {}", jira_message(&body))),
    }
}

/// Jira's error text ("errorMessages" / "errors"), or the start of the body.
fn jira_message(body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let mut parts: Vec<String> = v["errorMessages"].as_array().into_iter().flatten().filter_map(|m| m.as_str().map(String::from)).collect();
    if let Some(errors) = v["errors"].as_object() {
        parts.extend(errors.values().filter_map(|m| m.as_str().map(String::from)));
    }
    if parts.is_empty() {
        body.chars().take(200).collect()
    } else {
        parts.join(" ")
    }
}

/// Checks the token with Jira and stores it in the keychain.
#[tauri::command]
pub async fn jira_connect(site: String, email: String, token: String) -> Result<Account, String> {
    let site = normalize_site(&site)?;
    let (email, token) = (email.trim().to_string(), token.trim().to_string());
    if email.is_empty() || token.is_empty() {
        return Err("Enter your email and an API token".into());
    }
    let me = get(&site, &email, &token, "/rest/api/3/myself").await?;
    entry(&site, &email)?.set_password(&token).map_err(|e| format!("Couldn't save the token in the keychain: {e}"))?;
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(cache_key(&site, &email), token);
    Ok(Account {
        site,
        account_id: me["accountId"].as_str().unwrap_or_default().to_string(),
        display_name: me["displayName"].as_str().unwrap_or(&email).to_string(),
        email,
    })
}

/// Forgets the token.
#[tauri::command]
pub fn jira_disconnect(site: String, email: String) -> Result<(), String> {
    cache().lock().unwrap_or_else(|e| e.into_inner()).remove(&cache_key(&site, &email));
    match entry(&site, &email)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the token from the keychain: {e}")),
    }
}

/// GET a Jira REST path ("/rest/api/3/…" or "/rest/agile/1.0/…") on the connected site. Read-only.
#[tauri::command]
pub async fn jira_get(site: String, email: String, path: String) -> Result<serde_json::Value, String> {
    if !path.starts_with("/rest/") || path.contains("..") {
        return Err("Not a Jira REST path".into());
    }
    let site = normalize_site(&site)?;
    let token = token(&site, &email)?;
    get(&site, &email, &token, &path).await
}

fn token(site: &str, email: &str) -> Result<String, String> {
    let cached = || cache().lock().unwrap_or_else(|e| e.into_inner()).get(&cache_key(site, email)).cloned();
    if let Some(t) = cached() {
        return Ok(t);
    }
    // One keychain read at a time: a page fires several requests at once, and each would prompt.
    static READING: Mutex<()> = Mutex::new(());
    let _reading = READING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = cached() {
        return Ok(t);
    }
    match entry(site, email)?.get_password() {
        Ok(t) => {
            cache().lock().unwrap_or_else(|e| e.into_inner()).insert(cache_key(site, email), t.clone());
            Ok(t)
        }
        Err(keyring::Error::NoEntry) => Err("Not connected to Jira. Connect your account in Settings → Jira.".into()),
        Err(e) => Err(format!("Couldn't read the token from the keychain: {e}")),
    }
}

/// Larger attachments aren't shown inline (they open in Jira).
const MAX_ATTACHMENT: u64 = 25 * 1024 * 1024;

/// An attachment's bytes (images in descriptions and comments need the login,
/// so the webview can't load them from Jira itself). Jira redirects to a
/// pre-signed media URL; reqwest follows it (and drops the login on the way).
#[tauri::command]
pub async fn jira_attachment(site: String, email: String, id: String) -> Result<tauri::ipc::Response, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Not an attachment id".into());
    }
    let site = normalize_site(&site)?;
    let token = token(&site, &email)?;
    let response = client()?
        .get(format!("{site}/rest/api/3/attachment/content/{id}"))
        .basic_auth(&email, Some(&token))
        .send()
        .await
        .map_err(|e| format!("Couldn't load the attachment: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't load the attachment ({})", response.status()));
    }
    if response.content_length().is_some_and(|n| n > MAX_ATTACHMENT) {
        return Err("The attachment is too large to show here".into());
    }
    let bytes = response.bytes().await.map_err(|e| format!("Couldn't load the attachment: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_addresses() {
        assert_eq!(normalize_site("acme").unwrap(), "https://acme.atlassian.net");
        assert_eq!(normalize_site(" Acme.atlassian.net ").unwrap(), "https://acme.atlassian.net");
        assert_eq!(normalize_site("https://acme.atlassian.net/jira/software/projects/X/boards/1").unwrap(), "https://acme.atlassian.net");
        assert!(normalize_site("").is_err());
        assert!(normalize_site("bad host!").is_err());
    }

    #[test]
    fn error_messages_from_jira() {
        assert_eq!(jira_message(r#"{"errorMessages":["Field 'x' does not exist."],"errors":{}}"#), "Field 'x' does not exist.");
        assert_eq!(jira_message("<html>oops</html>"), "<html>oops</html>");
    }
}
