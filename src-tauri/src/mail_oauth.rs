use std::{
    collections::HashMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::Url;

use crate::{
    keyring_store::{
        clear_mail_oauth_token, clear_mail_password, load_mail_oauth_token, load_mail_password,
        save_mail_oauth_token, save_mail_password, MailOAuthToken, MailPasswordSecret,
    },
    settings_store::SettingsStore,
    AppState,
};

const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const OUTLOOK_SCOPE: &str = "openid profile email offline_access Mail.Read";
const POLL_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MailProvider {
    Gmail,
    Outlook,
    #[serde(rename = "qq")]
    Qq,
}

impl MailProvider {
    fn key(self) -> &'static str {
        match self {
            Self::Gmail => "gmail",
            Self::Outlook => "outlook",
            Self::Qq => "qq",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailOAuthStatus {
    pub(crate) provider: String,
    pub(crate) configured: bool,
    pub(crate) connected: bool,
    pub(crate) email: Option<String>,
    pub(crate) redirect_uri: String,
    pub(crate) requires_password: bool,
    pub(crate) client_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailOAuthConfigRequest {
    pub(crate) provider: MailProvider,
    pub(crate) client_id: String,
    pub(crate) client_secret: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailCodePollRequest {
    pub(crate) provider: MailProvider,
    pub(crate) email: String,
    pub(crate) station_url: String,
    pub(crate) started_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailCodeResult {
    pub(crate) code: String,
    pub(crate) subject: Option<String>,
    pub(crate) from: Option<String>,
    pub(crate) received_at: Option<String>,
    pub(crate) content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailPasswordRequest {
    pub(crate) provider: MailProvider,
    pub(crate) email: String,
    pub(crate) password: String,
}

fn setting_key(provider: MailProvider, field: &str) -> String {
    format!("mail_oauth.{}.{}", provider.key(), field)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn random_string() -> String {
    let bytes = uuid::Uuid::new_v4().as_bytes().to_vec();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn read_config(
    state: &AppState,
    provider: MailProvider,
) -> Result<(String, Option<String>), String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let client_id = store
        .setting(&setting_key(provider, "client_id"))?
        .unwrap_or_default();
    let secret = store.setting(&setting_key(provider, "client_secret"))?;
    Ok((client_id, secret))
}

fn redirect_uri(listener: &TcpListener) -> Result<String, String> {
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{}/callback", address.port()))
}

async fn exchange_code(
    client: &Client,
    provider: MailProvider,
    config: &(String, Option<String>),
    code: &str,
    redirect: &str,
    verifier: &str,
) -> Result<MailOAuthToken, String> {
    let (token_url, params) = match provider {
        MailProvider::Gmail => (
            "https://oauth2.googleapis.com/token",
            vec![
                ("client_id", config.0.clone()),
                ("code", code.to_string()),
                ("code_verifier", verifier.to_string()),
                ("grant_type", "authorization_code".into()),
                ("redirect_uri", redirect.to_string()),
            ],
        ),
        MailProvider::Outlook => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            vec![
                ("client_id", config.0.clone()),
                ("code", code.to_string()),
                ("code_verifier", verifier.to_string()),
                ("grant_type", "authorization_code".into()),
                ("redirect_uri", redirect.to_string()),
            ],
        ),
        MailProvider::Qq => return Err("QQ 邮箱请使用 IMAP 授权码连接".into()),
    };
    let mut form = params;
    if let Some(secret) = &config.1 {
        form.push(("client_secret", secret.clone()));
    }
    let response = client
        .post(token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("OAuth 授权失败")
            .to_string());
    }
    let access_token = body
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("OAuth 未返回访问令牌")?
        .to_string();
    let expires_at = now()
        + body
            .get("expires_in")
            .and_then(Value::as_i64)
            .unwrap_or(3600);
    let refresh_token = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_string);
    let email = fetch_mail_identity(client, provider, &access_token)
        .await
        .ok();
    Ok(MailOAuthToken {
        access_token,
        refresh_token,
        expires_at,
        email,
    })
}

async fn fetch_mail_identity(
    client: &Client,
    provider: MailProvider,
    access_token: &str,
) -> Result<String, String> {
    let url = match provider {
        MailProvider::Gmail => "https://gmail.googleapis.com/gmail/v1/users/me/profile".to_string(),
        MailProvider::Outlook => {
            "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName".to_string()
        }
        MailProvider::Qq => return Err("QQ 邮箱不支持 OAuth 身份读取".into()),
    };
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err("无法读取邮箱地址".into());
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    match provider {
        MailProvider::Gmail => body
            .get("emailAddress")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "OAuth 未返回邮箱地址".into()),
        MailProvider::Outlook => body
            .get("mail")
            .or_else(|| body.get("userPrincipalName"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "OAuth 未返回邮箱地址".into()),
        MailProvider::Qq => Err("QQ 邮箱不支持 OAuth 身份读取".into()),
    }
}

async fn refresh_if_needed(
    client: &Client,
    provider: MailProvider,
    state: &AppState,
) -> Result<String, String> {
    let mut token = load_mail_oauth_token(provider.key())?;
    if token.expires_at > now() + 60 {
        return Ok(token.access_token);
    }
    let refresh = token
        .refresh_token
        .clone()
        .ok_or("邮箱 OAuth 已过期，请重新连接")?;
    let (url, mut form) = match provider {
        MailProvider::Gmail => (
            "https://oauth2.googleapis.com/token",
            vec![
                ("client_id", read_config(state, provider)?.0),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token".into()),
            ],
        ),
        MailProvider::Outlook => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            vec![
                ("client_id", read_config(state, provider)?.0),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token".into()),
                ("scope", OUTLOOK_SCOPE.into()),
            ],
        ),
        MailProvider::Qq => return Err("QQ 邮箱请重新输入 IMAP 授权码".into()),
    };
    if let Some(secret) = read_config(state, provider)?.1 {
        form.push(("client_secret", secret));
    }
    let response = client
        .post(url)
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err("刷新邮箱 OAuth 令牌失败，请重新连接".into());
    }
    token.access_token = body
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("刷新令牌响应无访问令牌")?
        .to_string();
    token.expires_at = now()
        + body
            .get("expires_in")
            .and_then(Value::as_i64)
            .unwrap_or(3600);
    if let Some(next) = body.get("refresh_token").and_then(Value::as_str) {
        token.refresh_token = Some(next.to_string());
    }
    save_mail_oauth_token(provider.key(), &token)?;
    Ok(token.access_token)
}

async fn await_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let accepted = timeout(POLL_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "OAuth 授权超时".to_string())?
        .map_err(|e| e.to_string())?;
    let mut socket = accepted.0;
    let mut buffer = vec![0_u8; 8192];
    let size = socket.read(&mut buffer).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let first_line = request.lines().next().unwrap_or_default();
    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or("OAuth 回调无效")?;
    let url = Url::parse(&format!("http://localhost{}", path)).map_err(|e| e.to_string())?;
    let values: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let response = if values.get("state").map(String::as_str) != Some(expected_state) {
        "授权状态校验失败，请关闭此页面"
    } else if let Some(error) = values.get("error") {
        return Err(format!("OAuth 授权失败：{}", error));
    } else {
        "授权完成，可以返回 RelayHub"
    };
    let body = format!("<html><meta charset=\"utf-8\"><body>{response}</body></html>");
    let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
    let _ = socket.write_all(reply.as_bytes()).await;
    if values.get("state").map(String::as_str) != Some(expected_state) {
        return Err("OAuth 状态校验失败".into());
    }
    values
        .get("code")
        .cloned()
        .ok_or("OAuth 回调未包含授权码".into())
}

#[tauri::command]
pub(crate) async fn get_mail_oauth_status(
    state: State<'_, AppState>,
    provider: MailProvider,
) -> Result<MailOAuthStatus, String> {
    let (client_id, _) = read_config(&state, provider)?;
    let token = load_mail_oauth_token(provider.key()).ok();
    let password = load_mail_password(provider.key()).ok();
    Ok(MailOAuthStatus {
        provider: provider.key().into(),
        configured: !client_id.trim().is_empty() || password.is_some(),
        connected: token.is_some() || password.is_some(),
        email: token
            .and_then(|value| value.email)
            .or_else(|| password.map(|value| value.email)),
        redirect_uri: "授权时自动生成本机回调地址".into(),
        requires_password: matches!(provider, MailProvider::Qq),
        client_id: (!client_id.trim().is_empty()).then_some(client_id),
    })
}

#[tauri::command]
pub(crate) async fn save_mail_password_config(
    state: State<'_, AppState>,
    request: MailPasswordRequest,
) -> Result<MailOAuthStatus, String> {
    if !matches!(request.provider, MailProvider::Qq) {
        return Err("只有 QQ 邮箱使用 IMAP 密码连接".into());
    }
    if !request.email.trim().contains('@') || request.password.trim().is_empty() {
        return Err("请填写 QQ 邮箱和 IMAP 授权码".into());
    }
    save_mail_password(
        request.provider.key(),
        &MailPasswordSecret {
            email: request.email.trim().into(),
            password: request.password,
        },
    )?;
    get_mail_oauth_status(state, request.provider).await
}

#[tauri::command]
pub(crate) async fn save_mail_oauth_config(
    state: State<'_, AppState>,
    request: MailOAuthConfigRequest,
) -> Result<MailOAuthStatus, String> {
    if request.client_id.trim().is_empty() {
        return Err("OAuth Client ID 不能为空".into());
    }
    {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        store.save_setting(
            &setting_key(request.provider, "client_id"),
            request.client_id.trim(),
        )?;
        store.save_setting(
            &setting_key(request.provider, "client_secret"),
            request.client_secret.as_deref().unwrap_or("").trim(),
        )?;
    }
    get_mail_oauth_status(state, request.provider).await
}

#[tauri::command]
pub(crate) async fn start_mail_oauth(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: MailProvider,
) -> Result<MailOAuthStatus, String> {
    let config = read_config(&state, provider)?;
    if matches!(provider, MailProvider::Qq) {
        return Err("QQ 邮箱请使用 IMAP 授权码连接".into());
    }
    if config.0.trim().is_empty() {
        return Err("请先配置 OAuth Client ID".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let redirect = redirect_uri(&listener)?;
    let verifier = random_string();
    let state_value = random_string();
    let authorize_url = match provider {
        MailProvider::Gmail => "https://accounts.google.com/o/oauth2/v2/auth",
        MailProvider::Outlook => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        MailProvider::Qq => unreachable!(),
    };
    let scope = match provider {
        MailProvider::Gmail => GMAIL_SCOPE,
        MailProvider::Outlook => OUTLOOK_SCOPE,
        MailProvider::Qq => unreachable!(),
    };
    let mut url = Url::parse(authorize_url).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", &config.0)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", scope)
        .append_pair("state", &state_value)
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    if matches!(provider, MailProvider::Gmail) {
        url.query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;
    let code = await_callback(listener, &state_value).await?;
    let token = exchange_code(
        &state.client,
        provider,
        &config,
        &code,
        &redirect,
        &verifier,
    )
    .await?;
    save_mail_oauth_token(provider.key(), &token)?;
    get_mail_oauth_status(state, provider).await
}

#[tauri::command]
pub(crate) async fn disconnect_mail_oauth(provider: MailProvider) -> Result<(), String> {
    clear_mail_oauth_token(provider.key());
    clear_mail_password(provider.key());
    Ok(())
}

fn strip_html_markup(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut remainder = text;
    loop {
        let Some(start) = remainder.find('<') else {
            output.push_str(remainder);
            break;
        };
        output.push_str(&remainder[..start]);
        output.push(' ');
        let markup = &remainder[start..];
        let lower_markup = markup.to_ascii_lowercase();
        if lower_markup.starts_with("<!--") {
            if let Some(end) = markup.find("-->") {
                remainder = &markup[end + 3..];
                continue;
            }
            break;
        }
        if lower_markup.starts_with("<style") || lower_markup.starts_with("<script") {
            let closing = if lower_markup.starts_with("<style") {
                "</style>"
            } else {
                "</script>"
            };
            if let Some(end) = lower_markup.find(closing) {
                remainder = &markup[end + closing.len()..];
                continue;
            }
            break;
        }
        if let Some(end) = markup.find('>') {
            remainder = &markup[end + 1..];
            continue;
        }
        break;
    }
    output
}

fn decode_hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn decode_quoted_printable(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'=' {
            if index + 2 < bytes.len() && bytes[index + 1] == b'\r' && bytes[index + 2] == b'\n' {
                index += 3;
                continue;
            }
            if index + 1 < bytes.len() && bytes[index + 1] == b'\n' {
                index += 2;
                continue;
            }
            if index + 2 < bytes.len() {
                if let (Some(high), Some(low)) =
                    (decode_hex(bytes[index + 1]), decode_hex(bytes[index + 2]))
                {
                    output.push(high * 16 + low);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let output: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{output}…")
    } else {
        output
    }
}

fn is_mail_header_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    line.starts_with("--")
        || lower.starts_with("received:")
        || lower.starts_with("delivered-to:")
        || lower.starts_with("return-path:")
        || lower.starts_with("from:")
        || lower.starts_with("to:")
        || lower.starts_with("subject:")
        || lower.starts_with("date:")
        || lower.starts_with("message-id:")
        || lower.starts_with("content-")
        || lower.starts_with("mime-version:")
        || lower.starts_with("dkim-")
        || lower.starts_with("arc-")
        || lower.starts_with("authentication-results:")
        || lower.starts_with("x-")
}

fn summarize_mail_content(raw: &str) -> String {
    let decoded = decode_quoted_printable(raw);
    let rendered = strip_html_markup(&decoded);
    let lines = rendered
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !is_mail_header_line(line))
        .collect::<Vec<_>>();
    let normalized = decode_html_entities(&lines.join(" "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_chars(&normalized, 1600)
}

fn optional_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn decode_mime_header(value: &str) -> String {
    let value = value.trim();
    let Some(encoded) = value
        .strip_prefix("=?UTF-8?B?")
        .and_then(|value| value.strip_suffix("?="))
    else {
        return value.to_string();
    };
    general_purpose::STANDARD
        .decode(encoded)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| value.to_string())
}

fn eml_header(raw: &str, name: &str) -> Option<String> {
    let prefix = format!("{}:", name.to_ascii_lowercase());
    raw.lines().find_map(|line| {
        let trimmed = line.trim_start();
        let lower = trimmed.to_ascii_lowercase();
        lower
            .starts_with(&prefix)
            .then(|| decode_mime_header(trimmed[prefix.len()..].trim()))
    })
}

fn gmail_header(value: &Value, name: &str) -> Option<String> {
    value
        .get("payload")
        .and_then(|payload| payload.get("headers"))
        .and_then(Value::as_array)
        .and_then(|headers| {
            headers.iter().find_map(|header| {
                let header_name = header.get("name").and_then(Value::as_str)?;
                header_name
                    .eq_ignore_ascii_case(name)
                    .then(|| optional_text(header.get("value")))
                    .flatten()
            })
        })
}

fn received_at_from_unix(seconds: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, 0).map(|value| value.to_rfc3339())
}

fn received_at_from_millis(value: &Value) -> Option<String> {
    value
        .as_str()
        .and_then(|value| value.parse::<i64>().ok())
        .and_then(|value| received_at_from_unix(value / 1_000))
}

fn collect_mail_body_text(value: &Value, output: &mut String) {
    fn append_data(data: &str, output: &mut String) {
        let decoded = general_purpose::URL_SAFE_NO_PAD
            .decode(data)
            .or_else(|_| general_purpose::URL_SAFE.decode(data))
            .or_else(|_| general_purpose::STANDARD.decode(data));
        if let Ok(bytes) = decoded {
            output.push_str(&String::from_utf8_lossy(&bytes));
            output.push('\n');
        } else if data.len() <= 4096 {
            output.push_str(data);
            output.push('\n');
        }
    }

    match value {
        Value::String(text) => {
            output.push_str(text);
            output.push('\n');
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_mail_body_text(item, output)),
        Value::Object(map) => map.iter().for_each(|(key, item)| {
            if matches!(
                key.as_str(),
                "headers" | "filename" | "mimeType" | "attachmentId"
            ) {
                return;
            }
            if key == "data" {
                if let Some(data) = item.as_str() {
                    append_data(data, output);
                }
                return;
            }
            if item.is_object() || item.is_array() || matches!(key.as_str(), "body" | "parts") {
                collect_mail_body_text(item, output);
            }
        }),
        _ => {}
    }
}

fn scan_code(text: &str) -> Option<String> {
    fn first_code_in(text: &str) -> Option<String> {
        fn code_from_token(token: &str) -> Option<String> {
            let has_digit = token.chars().any(|value| value.is_ascii_digit());
            let is_numeric_code =
                token.chars().all(|value| value.is_ascii_digit()) && (4..=8).contains(&token.len());
            let is_alphanumeric_code = (4..=16).contains(&token.len())
                && has_digit
                && token.chars().all(|value| value.is_ascii_alphanumeric());
            if is_numeric_code || is_alphanumeric_code {
                Some(token.to_string())
            } else {
                None
            }
        }

        let mut token = String::new();
        let mut in_html_tag = false;
        for character in text.chars().chain(std::iter::once(' ')) {
            if character == '<' {
                if let Some(code) = code_from_token(&token) {
                    return Some(code);
                }
                in_html_tag = true;
                token.clear();
                continue;
            }
            if in_html_tag {
                if character == '>' {
                    in_html_tag = false;
                }
                continue;
            }
            if character.is_ascii_alphanumeric() {
                token.push(character);
                continue;
            }
            if let Some(code) = code_from_token(&token) {
                return Some(code);
            }
            token.clear();
        }
        None
    }

    // Search normalized rendered text. CSS, tracking URLs, MIME headers, and
    // HTML attributes routinely contain digit-heavy strings that are not codes.
    let rendered = strip_html_markup(text);
    let normalized = rendered.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_ascii_lowercase();
    let mut explicit_candidates: Vec<String> = Vec::new();
    for keyword in [
        "your verification code is",
        "your verification code:",
        "verification code is",
        "verification code:",
        "verify code is",
        "verify code:",
        "security code is",
        "security code:",
        "one-time code is",
        "one-time code:",
        "验证码为",
        "验证码：",
        "验证码:",
    ] {
        let mut offset = 0;
        while let Some(relative) = lower[offset..].find(keyword) {
            let start = offset + relative + keyword.len();
            // Keep the search local to this occurrence so a subject or greeting
            // cannot make an unrelated number look like the verification code.
            let window: String = normalized[start..].chars().take(128).collect();
            if let Some(code) = first_code_in(&window) {
                explicit_candidates.push(code);
            }
            offset = start;
        }
    }
    if !explicit_candidates.is_empty() {
        // Plain-text and HTML MIME parts often repeat the same code. Prefer the
        // value repeated by the message body instead of a one-off preheader or
        // tracking token that happens to be near a verification label.
        let mut counts = HashMap::<String, (usize, usize)>::new();
        for (index, code) in explicit_candidates.into_iter().enumerate() {
            let entry = counts.entry(code).or_insert((0, index));
            entry.0 += 1;
            entry.1 = index;
        }
        return counts
            .into_iter()
            .max_by_key(|(_, (count, last_index))| (*count, *last_index))
            .map(|(code, _)| code);
    }

    // Do not trust arbitrary numbers from API metadata (message ids, dates,
    // size estimates). Only use an unambiguous fallback candidate.
    let mut candidate = None;
    let bytes = rendered.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        while start < bytes.len() && !bytes[start].is_ascii_digit() {
            start += 1;
        }
        let end = start;
        while start < bytes.len() && bytes[start].is_ascii_digit() {
            start += 1;
        }
        let len = start - end;
        let embedded_in_word = (end > 0 && bytes[end - 1].is_ascii_alphanumeric())
            || (start < bytes.len() && bytes[start].is_ascii_alphanumeric());
        if !embedded_in_word && (4..=8).contains(&len) {
            if candidate.is_some() {
                return None;
            }
            candidate = Some(rendered[end..start].to_string());
        }
    }
    candidate
}

fn relevant(text: &str, email: &str, station_url: &str) -> bool {
    let haystack = text.to_ascii_lowercase();
    let host = Url::parse(station_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase));
    let site_match = host
        .as_deref()
        .map(|host| haystack.contains(host))
        .unwrap_or(false);
    let code_words = ["verification", "verify", "验证码", "code", "注册", "确认"];
    let identity_match = site_match || haystack.contains(&email.to_ascii_lowercase());
    identity_match && code_words.iter().any(|word| haystack.contains(word))
}

fn collect_json_text(value: &Value, output: &mut String) {
    fn append_decoded(data: &str, output: &mut String) {
        let decoded = general_purpose::URL_SAFE_NO_PAD
            .decode(data)
            .or_else(|_| general_purpose::URL_SAFE.decode(data))
            .or_else(|_| general_purpose::STANDARD.decode(data));
        if let Ok(bytes) = decoded {
            if let Ok(text) = String::from_utf8(bytes) {
                output.push_str(&text);
                output.push('\n');
            }
        }
    }

    match value {
        Value::String(text) => {
            output.push_str(text);
            output.push('\n');
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_json_text(item, output)),
        Value::Object(map) => map.iter().for_each(|(key, item)| {
            if matches!(
                key.as_str(),
                "id" | "threadId"
                    | "historyId"
                    | "internalDate"
                    | "sizeEstimate"
                    | "etag"
                    | "partId"
                    | "labelIds"
            ) {
                return;
            }
            if key == "data" {
                if let Some(data) = item.as_str() {
                    let before = output.len();
                    append_decoded(data, output);
                    // A few providers return a short, already-decoded body in
                    // this field. Keep it only when it was not base64 data.
                    if output.len() == before && data.len() <= 4096 {
                        output.push_str(data);
                        output.push('\n');
                    }
                }
                return;
            }
            collect_json_text(item, output);
        }),
        _ => {}
    }
}

async fn poll_gmail(
    client: &Client,
    token: &str,
    email: &str,
    station_url: &str,
    started_at: i64,
) -> Result<Option<MailCodeResult>, String> {
    let query = format!("after:{}", started_at.max(0));
    let list = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
        .bearer_auth(token)
        .query(&[
            ("q", query),
            ("includeSpamTrash", "true".into()),
            ("maxResults", "20".into()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if list.status() == StatusCode::UNAUTHORIZED {
        return Err("邮箱 OAuth 已失效，请重新连接".into());
    }
    if !list.status().is_success() {
        return Err(format!("Gmail 查询失败：{}", list.status()));
    }
    let body: Value = list.json().await.map_err(|e| e.to_string())?;
    let Some(messages) = body.get("messages").and_then(Value::as_array) else {
        return Ok(None);
    };
    for message in messages {
        let Some(id) = message.get("id").and_then(Value::as_str) else {
            continue;
        };
        let detail = client
            .get(format!(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
            ))
            .bearer_auth(token)
            .query(&[("format", "full")])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !detail.status().is_success() {
            continue;
        }
        let value: Value = detail.json().await.map_err(|e| e.to_string())?;
        if value
            .get("internalDate")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<i64>().ok())
            .is_some_and(|received_at| received_at / 1_000 < started_at.saturating_sub(30))
        {
            continue;
        }
        let mut text = String::new();
        collect_json_text(&value, &mut text);
        if relevant(&text, email, station_url) {
            if let Some(code) = scan_code(&text) {
                let mut body = String::new();
                if let Some(payload) = value.get("payload") {
                    collect_mail_body_text(payload, &mut body);
                }
                if body.trim().is_empty() {
                    body.clone_from(&text);
                }
                return Ok(Some(MailCodeResult {
                    code,
                    subject: gmail_header(&value, "Subject"),
                    from: gmail_header(&value, "From"),
                    received_at: value.get("internalDate").and_then(received_at_from_millis),
                    content: summarize_mail_content(&body),
                }));
            }
        }
    }
    Ok(None)
}

async fn poll_outlook(
    client: &Client,
    token: &str,
    email: &str,
    station_url: &str,
    started_at: i64,
) -> Result<Option<MailCodeResult>, String> {
    let since = chrono::DateTime::<chrono::Utc>::from_timestamp(started_at.max(0), 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    for folder in ["inbox", "junkemail"] {
        let response = client
            .get(format!(
                "https://graph.microsoft.com/v1.0/me/mailFolders/{folder}/messages"
            ))
            .bearer_auth(token)
            .query(&[
                ("$top", "25"),
                ("$orderby", "receivedDateTime desc"),
                ("$filter", &format!("receivedDateTime ge {since}")),
                ("$select", "subject,from,receivedDateTime,body,bodyPreview"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err("邮箱 OAuth 已失效，请重新连接".into());
        }
        if !response.status().is_success() {
            return Err(format!("Outlook 查询失败：{}", response.status()));
        }
        let value: Value = response.json().await.map_err(|e| e.to_string())?;
        if let Some(messages) = value.get("value").and_then(Value::as_array) {
            for message in messages {
                let mut text = String::new();
                collect_json_text(message, &mut text);
                if relevant(&text, email, station_url) {
                    if let Some(code) = scan_code(&text) {
                        let body = message
                            .get("body")
                            .and_then(|body| body.get("content"))
                            .and_then(Value::as_str)
                            .or_else(|| message.get("bodyPreview").and_then(Value::as_str))
                            .unwrap_or(&text);
                        let from = message
                            .get("from")
                            .and_then(|value| value.get("emailAddress"))
                            .and_then(|value| {
                                let address = optional_text(value.get("address"));
                                let name = optional_text(value.get("name"));
                                match (name, address) {
                                    (Some(name), Some(address)) => {
                                        Some(format!("{name} <{address}>"))
                                    }
                                    (Some(name), None) => Some(name),
                                    (None, Some(address)) => Some(address),
                                    (None, None) => None,
                                }
                            });
                        return Ok(Some(MailCodeResult {
                            code,
                            subject: optional_text(message.get("subject")),
                            from,
                            received_at: optional_text(message.get("receivedDateTime")),
                            content: summarize_mail_content(body),
                        }));
                    }
                }
            }
        }
    }
    Ok(None)
}

fn poll_qq_once(
    secret: &MailPasswordSecret,
    email: &str,
    station_url: &str,
    started_at: i64,
) -> Result<Option<MailCodeResult>, String> {
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let client =
        imap::connect(("imap.qq.com", 993), "imap.qq.com", &tls).map_err(|e| e.to_string())?;
    let mut session = client
        .login(&secret.email, &secret.password)
        .map_err(|e| e.0.to_string())?;
    let folders = session.list(None, Some("*")).map_err(|e| e.to_string())?;
    let since = chrono::DateTime::<chrono::Utc>::from_timestamp(started_at.max(0), 0)
        .unwrap_or_else(chrono::Utc::now)
        .format("%d-%b-%Y")
        .to_string();
    let mut folder_names = vec!["INBOX".to_string()];
    for folder in folders.iter() {
        let name = folder.name().to_string();
        let lower = name.to_ascii_lowercase();
        if lower.contains("spam")
            || lower.contains("junk")
            || lower.contains("trash")
            || name.contains('垃')
            || name.contains('圾')
            || name.contains('废')
        {
            folder_names.push(name);
        }
    }
    folder_names.sort();
    folder_names.dedup();
    for folder in folder_names {
        if session.select(&folder).is_err() {
            continue;
        }
        let ids = session
            .search(format!("SINCE {}", since))
            .map_err(|e| e.to_string())?;
        let mut ids: Vec<u32> = ids.into_iter().collect();
        ids.sort_unstable();
        for id in ids.into_iter().rev().take(30) {
            let fetched = session
                .fetch(id.to_string(), "(INTERNALDATE RFC822)")
                .map_err(|e| e.to_string())?;
            let Some(message) = fetched.iter().next() else {
                continue;
            };
            if message
                .internal_date()
                .is_some_and(|received_at| received_at.timestamp() < started_at.saturating_sub(30))
            {
                continue;
            }
            let Some(body) = message.body() else {
                continue;
            };
            let text = String::from_utf8_lossy(body);
            if relevant(&text, email, station_url) {
                if let Some(code) = scan_code(&text) {
                    let received_at = message
                        .internal_date()
                        .and_then(|value| received_at_from_unix(value.timestamp()));
                    let _ = session.logout();
                    return Ok(Some(MailCodeResult {
                        code,
                        subject: eml_header(&text, "Subject"),
                        from: eml_header(&text, "From"),
                        received_at,
                        content: summarize_mail_content(&text),
                    }));
                }
            }
        }
    }
    let _ = session.logout();
    Ok(None)
}

#[tauri::command]
pub(crate) async fn poll_registration_code(
    state: State<'_, AppState>,
    request: MailCodePollRequest,
) -> Result<MailCodeResult, String> {
    let email = request.email.trim();
    if !email.contains('@') {
        return Err("请先填写注册邮箱".into());
    }
    let station_url = request.station_url.trim();
    if Url::parse(station_url).is_err() {
        return Err("站点地址无效".into());
    }
    let started_at = request.started_at.unwrap_or_else(|| now() - 120);
    let deadline = tokio::time::Instant::now() + POLL_TIMEOUT;
    loop {
        let result = match request.provider {
            MailProvider::Gmail => {
                let token = refresh_if_needed(&state.client, request.provider, &state).await?;
                poll_gmail(&state.client, &token, email, station_url, started_at).await?
            }
            MailProvider::Outlook => {
                let token = refresh_if_needed(&state.client, request.provider, &state).await?;
                poll_outlook(&state.client, &token, email, station_url, started_at).await?
            }
            MailProvider::Qq => {
                let secret = load_mail_password("qq")?;
                let email = email.to_string();
                let station_url = station_url.to_string();
                tokio::task::spawn_blocking(move || {
                    poll_qq_once(&secret, &email, &station_url, started_at)
                })
                .await
                .map_err(|e| e.to_string())??
            }
        };
        if let Some(result) = result {
            return Ok(result);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("在收件箱和垃圾邮件中未找到验证码".into());
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    use super::{relevant, scan_code, summarize_mail_content};
    #[test]
    fn finds_common_codes() {
        assert_eq!(
            scan_code("Your verification code is 482901"),
            Some("482901".into())
        );
    }
    #[test]
    fn ignores_mail_metadata_numbers_before_the_code() {
        let message = r#"{"id":"abc123","historyId":"987654","sizeEstimate":456789,"snippet":"Your verification code is 482901"}"#;
        assert_eq!(scan_code(message), Some("482901".into()));
    }
    #[test]
    fn decodes_gmail_body_data_before_scanning() {
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode("Your verification code is 731904");
        let message = serde_json::json!({"payload": {"body": {"data": encoded}}});
        let mut text = String::new();
        super::collect_json_text(&message, &mut text);
        assert_eq!(scan_code(&text), Some("731904".into()));
    }
    #[test]
    fn filters_by_site_or_code_words() {
        assert!(relevant(
            "relay.example.com verification code",
            "x@y.com",
            "https://relay.example.com"
        ));
    }

    #[test]
    fn finds_code_after_quoted_printable_html_markup() {
        let text = concat!(
            "Received: for <mailbox@example.com>\r\n",
            "Subject: [NexaRelay] Email verification code\r\n",
            "Content-Transfer-Encoding: quoted-printable\r\n",
            "Content-Type: text/html; charset=utf-8\r\n\r\n",
            "<p>Your verification code is:</p>\r\n",
            "<p style=3D\"font-size: 32px; font-weight: 700; letter-spacing: 8px; ",
            "text-align: center;\">731904</p>"
        );
        assert_eq!(super::scan_code(text), Some("731904".into()));
        assert!(super::relevant(
            text,
            "mailbox@example.com",
            "https://api.nexarelay.com"
        ));
    }

    #[test]
    fn summarizes_received_mail_for_registration_log() {
        let text = concat!(
            "From: NexaRelay Notice <noreply@nexarelay.com>\r\n",
            "Subject: [NexaRelay] Email verification code\r\n",
            "Content-Transfer-Encoding: quoted-printable\r\n\r\n",
            "<p>Hello 3650430,</p><p>Your verification code is:</p>",
            "<p style=3D\"font-size: 32px\">850403</p>",
            "<p>This code expires in <strong>15</strong> minutes.</p>"
        );
        let summary = summarize_mail_content(text);
        assert!(summary.contains("Hello 3650430"));
        assert!(summary.contains("Your verification code is:"));
        assert!(summary.contains("850403"));
        assert!(!summary.contains("Content-Transfer-Encoding"));
        assert!(!summary.contains("font-size"));
    }

    #[test]
    fn ignores_html_style_values_and_greeting_numbers() {
        let text = concat!(
            "Subject: [Relay] Email verification code\r\n",
            "Content-Type: text/html; charset=utf-8\r\n\r\n",
            "<style>body{background:#f4f4f5}.container{max-width:640px}</style>",
            "<h1>Email verification code</h1>",
            "<p>Hello 3650430,</p>",
            "<p>Your verification code is:</p>",
            "<p style=\"font-size:32px;letter-spacing:8px\">731904</p>"
        );
        assert_eq!(super::scan_code(text), Some("731904".into()));
    }

    #[test]
    fn finds_alphanumeric_code_after_chinese_html_label() {
        let text = concat!(
            "From: noreply@example.test\r\n",
            "Subject: AI8.my 邮箱验证\r\n\r\n",
            "<p>您好，你正在进行站点邮箱验证。</p>",
            "<p>您的验证码为: <strong>7a3c1f</strong></p>",
            "<p>验证码 10 分钟内有效，如果不是本人操作，请忽略。</p>"
        );
        assert_eq!(super::scan_code(text), Some("7a3c1f".into()));
        assert!(super::relevant(
            text,
            "mailbox@example.com",
            "https://ai8.my"
        ));
    }

    #[test]
    fn prefers_the_repeated_body_code_over_a_one_off_preheader_token() {
        let text = concat!(
            "Your verification code: 62233S2\n",
            "<p>Your verification code is:</p><strong>855840</strong>\n",
            "<p>Your verification code is: 855840</p>"
        );
        assert_eq!(scan_code(text), Some("855840".into()));
    }

    #[test]
    fn does_not_return_unlabelled_alphanumeric_tracking_tokens() {
        assert_eq!(scan_code("tracking token 62233S2 expires soon"), None);
    }
}
