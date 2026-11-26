//! Signing in to a web service for a plugin: OAuth 2 with PKCE, the flow for
//! installed apps (Google, Microsoft, GitHub… call it "desktop app" or
//! "native app"). The system browser opens the provider's sign-in page, which
//! sends the browser back to a one-off listener on 127.0.0.1; Rust exchanges
//! the code for tokens. The refresh token goes into the keychain (secrets.rs,
//! "oauth:<plugin>:<hash of the provider>") and never leaves Rust; the plugin
//! gets short-lived access tokens, refreshed here when they run out.
//!
//! Plugins share one webview, so this keeps tokens out of the database,
//! settings and page, not apart from each other: a plugin that knows another's
//! client id and scopes could ask for its token too.
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::secrets;

/// How long the browser has to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// An access token this close to running out is refreshed first.
const MARGIN_MS: u64 = 60_000;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    client_id: String,
    /// Some providers want one even for desktop apps (Google's "Desktop app" clients); it isn't secret there.
    client_secret: Option<String>,
    auth_url: String,
    token_url: String,
    scopes: Vec<String>,
    /// Extra parameters for the sign-in page ("prompt", "access_type", "login_hint"…).
    #[serde(default)]
    auth_params: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccessToken {
    access_token: String,
    /// Milliseconds since the epoch.
    expires_at: u64,
    /// What the provider granted (it may be less than asked).
    scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

enum Failure {
    /// The refresh token is no longer accepted (revoked, expired): sign in again.
    InvalidGrant,
    Other(String),
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn tokens() -> &'static Mutex<HashMap<String, AccessToken>> {
    static CACHE: OnceLock<Mutex<HashMap<String, AccessToken>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

static CANCEL: AtomicBool = AtomicBool::new(false);

/// https only, except a local server (for development).
fn checked_url(s: &str, what: &str) -> Result<Url, String> {
    let url = Url::parse(s).map_err(|_| format!("The {what} isn't a valid address: {s}"))?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    if url.scheme() == "https" || (url.scheme() == "http" && local) {
        Ok(url)
    } else {
        Err(format!("The {what} must be an https address: {s}"))
    }
}

/// The keychain name for this plugin and provider (client, token address and scopes).
fn key(plugin: &str, p: &Provider) -> Result<String, String> {
    let valid = !plugin.is_empty() && plugin.len() <= 60 && plugin.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!("Not a valid plugin id: {plugin}"));
    }
    if p.client_id.trim().is_empty() {
        return Err("A client id is needed to sign in".into());
    }
    let mut scopes = p.scopes.clone();
    scopes.sort();
    let digest = Sha256::digest(format!("{}\n{}\n{}", p.client_id, p.token_url, scopes.join(" ")));
    let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    Ok(format!("oauth:{plugin}:{hash}"))
}

fn random(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("No randomness available: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        s.append_pair(k, v);
    }
    s.finish()
}

async fn token_request(p: &Provider, mut pairs: Vec<(&str, &str)>) -> Result<TokenResponse, Failure> {
    let url = checked_url(&p.token_url, "token address").map_err(Failure::Other)?;
    pairs.push(("client_id", &p.client_id));
    if let Some(secret) = p.client_secret.as_deref().filter(|s| !s.is_empty()) {
        pairs.push(("client_secret", secret));
    }
    let res = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| Failure::Other(e.to_string()))?
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        // GitHub answers with a form unless asked for JSON.
        .header("Accept", "application/json")
        .body(form(&pairs))
        .send()
        .await
        .map_err(|e| Failure::Other(format!("Couldn't reach the sign-in service: {e}")))?;
    let status = res.status();
    let body: TokenResponse = res
        .json()
        .await
        .map_err(|_| Failure::Other(format!("The sign-in service answered something unexpected ({status})")))?;
    if let Some(error) = body.error.as_deref() {
        if error == "invalid_grant" {
            return Err(Failure::InvalidGrant);
        }
        let more = body.error_description.as_deref().map(|d| format!(": {d}")).unwrap_or_default();
        return Err(Failure::Other(format!("Sign-in failed ({error}){more}")));
    }
    if body.access_token.is_none() {
        return Err(Failure::Other(format!("The sign-in service gave no access token ({status})")));
    }
    Ok(body)
}

/// Keep what came back: the access token in memory, a (new) refresh token in the keychain.
fn keep(key: &str, body: TokenResponse) -> Result<AccessToken, String> {
    if let Some(refresh) = body.refresh_token {
        secrets::write(key.to_string(), refresh)?;
    }
    let token = AccessToken {
        access_token: body.access_token.unwrap_or_default(),
        // No lifetime given: assume an hour, like most providers.
        expires_at: now_ms() + body.expires_in.unwrap_or(3600) * 1000,
        scope: body.scope,
    };
    tokens().lock().unwrap_or_else(|e| e.into_inner()).insert(key.to_string(), token.clone());
    Ok(token)
}

/// One HTTP request on the listener: the provider's redirect with `code` (or `error`).
fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Sign-in was cancelled".into());
        }
        if Instant::now() > deadline {
            return Err("Sign-in took too long: try again".into());
        }
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        if let Some(result) = handle(stream, state) {
            return result;
        }
    }
}

/// None: not the redirect (a favicon request…), keep waiting.
fn handle(mut stream: TcpStream, state: &str) -> Option<Result<String, String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
    let url = Url::parse(&format!("http://127.0.0.1{path}")).ok()?;
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if url.path() != "/" || (query.get("code").is_none() && query.get("error").is_none()) {
        respond(&mut stream, "404 Not Found", "");
        return None;
    }
    if query.get("state").map(String::as_str) != Some(state) {
        respond(&mut stream, "400 Bad Request", page("Sign-in didn't match", "Go back to Forgor and try again."));
        return Some(Err("Sign-in didn't match the request: try again".into()));
    }
    if let Some(error) = query.get("error") {
        respond(&mut stream, "200 OK", page("Not signed in", "You can close this tab and go back to Forgor."));
        return Some(Err(if error == "access_denied" { "Sign-in was cancelled".into() } else { format!("Sign-in failed ({error})") }));
    }
    respond(&mut stream, "200 OK", page("Signed in", "You can close this tab and go back to Forgor."));
    Some(Ok(query["code"].clone()))
}

fn page(title: &str, text: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title><body style=\"font:15px system-ui;display:grid;place-items:center;height:90vh;color:#333\"><div><h2>{title}</h2><p>{text}</p></div>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: impl AsRef<str>) {
    let body = body.as_ref();
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

async fn sign_in(p: &Provider) -> Result<TokenResponse, String> {
    let mut auth = checked_url(&p.auth_url, "sign-in address")?;
    let verifier = random(48)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random(24)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Couldn't start the sign-in: {e}"))?;
    let redirect = format!("http://127.0.0.1:{}/", listener.local_addr().map_err(|e| e.to_string())?.port());
    {
        let mut q = auth.query_pairs_mut();
        q.append_pair("response_type", "code")
            .append_pair("client_id", &p.client_id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("scope", &p.scopes.join(" "))
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        const OURS: [&str; 7] = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"];
        for (k, v) in &p.auth_params {
            if !OURS.contains(&k.as_str()) {
                q.append_pair(k, v);
            }
        }
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri_plugin_opener::open_url(auth.as_str(), None::<&str>).map_err(|e| format!("Couldn't open the browser: {e}"))?;
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state))
        .await
        .map_err(|e| e.to_string())??;
    token_request(
        p,
        vec![("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier)],
    )
    .await
    .map_err(|f| match f {
        Failure::InvalidGrant => "The sign-in code wasn't accepted: try again".to_string(),
        Failure::Other(e) => e,
    })
}

fn sign_ins() -> &'static tauri::async_runtime::Mutex<()> {
    static LOCK: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

/// A valid access token for this plugin and provider: cached, refreshed, or
/// (with `interactive`) after signing in in the browser. None: not signed in
/// and not interactive.
#[tauri::command]
pub async fn oauth_token(plugin: String, provider: Provider, interactive: bool) -> Result<Option<AccessToken>, String> {
    let key = key(&plugin, &provider)?;
    checked_url(&provider.token_url, "token address")?;
    // One at a time: two calls at once would both refresh, or open the browser twice.
    let _one = sign_ins().lock().await;
    if let Some(t) = tokens().lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        if t.expires_at > now_ms() + MARGIN_MS {
            return Ok(Some(t.clone()));
        }
    }
    if let Some(refresh) = secrets::read(key.clone())? {
        match token_request(&provider, vec![("grant_type", "refresh_token"), ("refresh_token", &refresh)]).await {
            Ok(body) => return keep(&key, body).map(Some),
            Err(Failure::InvalidGrant) => secrets::remove(key.clone())?,
            Err(Failure::Other(e)) => return Err(e),
        }
    }
    if !interactive {
        return Ok(None);
    }
    let body = sign_in(&provider).await?;
    keep(&key, body).map(Some)
}

/// Stop waiting for the browser.
#[tauri::command]
pub fn oauth_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Forget the tokens for this plugin and provider (the provider's own consent stays until revoked there).
#[tauri::command]
pub fn oauth_sign_out(plugin: String, provider: Provider) -> Result<(), String> {
    let key = key(&plugin, &provider)?;
    tokens().lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
    secrets::remove(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(scopes: &[&str]) -> Provider {
        Provider {
            client_id: "abc".into(),
            client_secret: None,
            auth_url: "https://accounts.example.com/auth".into(),
            token_url: "https://oauth.example.com/token".into(),
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
            auth_params: HashMap::new(),
        }
    }

    #[test]
    fn keys_are_per_plugin_and_provider_not_scope_order() {
        let a = key("mail", &provider(&["read", "labels"])).unwrap();
        assert_eq!(a, key("mail", &provider(&["labels", "read"])).unwrap());
        assert_ne!(a, key("other", &provider(&["read", "labels"])).unwrap());
        assert_ne!(a, key("mail", &provider(&["read"])).unwrap());
        assert!(a.starts_with("oauth:mail:"));
        assert!(key("Bad Id", &provider(&[])).is_err());
    }

    #[test]
    fn only_https_or_a_local_server() {
        assert!(checked_url("https://x.com/t", "t").is_ok());
        assert!(checked_url("http://localhost:8080/t", "t").is_ok());
        assert!(checked_url("http://x.com/t", "t").is_err());
        assert!(checked_url("file:///etc/passwd", "t").is_err());
    }

    #[test]
    fn the_redirect_gives_the_code_when_the_state_matches() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = std::thread::spawn(move || {
            // A browser asks for the favicon too: that must not end the wait.
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /?state=s1&code=the-code HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        });
        assert_eq!(wait_for_code(listener, "s1").unwrap(), "the-code");
        assert!(client.join().unwrap().contains("Signed in"));
    }

    #[test]
    fn a_wrong_state_or_a_refusal_is_an_error() {
        for (request, expect) in [("GET /?state=other&code=x", "didn't match"), ("GET /?state=s1&error=access_denied", "cancelled")] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let req = format!("{request} HTTP/1.1\r\nHost: x\r\n\r\n");
            let client = std::thread::spawn(move || {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(req.as_bytes()).unwrap();
                let mut out = String::new();
                let _ = s.read_to_string(&mut out);
            });
            let err = wait_for_code(listener, "s1").unwrap_err();
            assert!(err.contains(expect), "{err}");
            client.join().unwrap();
        }
    }
}
