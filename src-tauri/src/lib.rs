use serde::{Deserialize, Serialize};
use std::{thread, time::Duration};

const DEFAULT_CHAT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_CHAT_MODEL: &str = "gpt-5.5";
const CHAT_MAX_RETRIES: u8 = 5;
const KEYRING_SERVICE: &str = "RezeAfterFireworks";
const API_KEY_ACCOUNT: &str = "chat-api-key";
const LEGACY_GEMINI_KEY_ACCOUNT: &str = "gemini-api-key";

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Option<Vec<ChatChoice>>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: Option<ChatMessageResponse>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatErrorBody {
    error: Option<ChatApiError>,
}

#[derive(Debug, Deserialize)]
struct ChatApiError {
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessageRequest>,
    reasoning_effort: String,
    max_completion_tokens: u16,
}

#[derive(Clone, Debug, Serialize)]
struct ChatMessageRequest {
    role: String,
    content: String,
}

fn normalize_prompt(prompt: &str) -> String {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        "请随便说一句适合当前气氛的话。".to_string()
    } else {
        prompt.to_string()
    }
}

fn default_instruction(user_note: &str) -> String {
    let note = user_note.trim();
    let base = "你正在扮演桌面陪伴应用里的蕾塞。请用中文回复，尽量30到70字之间。减少AI味，不要总结，不要排比，不要说自己是AI，语气自然、有边界感。";

    if note.is_empty() {
        base.to_string()
    } else {
        format!("{base}\n额外备注：{note}")
    }
}

fn api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, API_KEY_ACCOUNT)
        .map_err(|error| format!("打开系统凭据失败：{error}"))
}

fn legacy_gemini_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, LEGACY_GEMINI_KEY_ACCOUNT)
        .map_err(|error| format!("打开旧系统凭据失败：{error}"))
}

fn read_saved_api_key() -> Result<String, String> {
    let api_key = api_key_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .or_else(|_| {
            legacy_gemini_key_entry()
                .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        })
        .map_err(|_| {
            "请先在设置里保存中转站 API Key。它会存进 Windows 凭据管理器，不会写入项目文件。".to_string()
        })?;

    if api_key.trim().is_empty() {
        Err("请先在设置里保存中转站 API Key。".to_string())
    } else {
        Ok(api_key)
    }
}

fn retry_delay(attempt: u8) -> Duration {
    let seconds = match attempt {
        1 => 1,
        2 => 2,
        3 => 4,
        4 => 6,
        _ => 8,
    };
    Duration::from_secs(seconds)
}

fn normalize_chat_endpoint(base_url: String) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let base = if trimmed.is_empty() {
        DEFAULT_CHAT_BASE_URL
    } else {
        trimmed
    };

    if base.ends_with("/chat/completions") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

fn normalize_model(model: String) -> String {
    let model = model.trim();
    if model.is_empty() {
        DEFAULT_CHAT_MODEL.to_string()
    } else {
        model.to_string()
    }
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::INTERNAL_SERVER_ERROR
        || status == reqwest::StatusCode::BAD_GATEWAY
        || status == reqwest::StatusCode::SERVICE_UNAVAILABLE
        || status == reqwest::StatusCode::GATEWAY_TIMEOUT
}

fn is_retryable_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("high demand")
        || lower.contains("temporar")
        || lower.contains("try again")
        || lower.contains("overloaded")
}

fn format_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "AI 请求超时：当前网络无法在 20 秒内连接到中转站。请检查代理/VPN 或中转站状态。".to_string()
    } else if error.is_connect() {
        format!("AI 连接失败：无法连接到中转站。通常是 Base URL、网络、代理、DNS 或防火墙问题。详细信息：{error}")
    } else if error.is_request() {
        format!("AI 请求无法发送：请检查中转站地址、系统代理、证书或网络环境。详细信息：{error}")
    } else {
        format!("AI 请求失败：{error}")
    }
}

fn parse_chat_body(body: &str) -> Result<String, String> {
    let parsed: ChatCompletionResponse =
        serde_json::from_str(body).map_err(|error| format!("解析 AI 响应失败：{error}"))?;

    let choice = parsed
        .choices
        .and_then(|mut choices| choices.pop())
        .ok_or_else(|| "AI 没有返回候选回复。".to_string())?;

    let finish_reason = choice.finish_reason.unwrap_or_else(|| "UNKNOWN".to_string());
    let text = choice
        .message
        .and_then(|message| message.content)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| format!("AI 没有返回可显示的文本。结束原因：{finish_reason}"))?;

    if finish_reason == "length" || finish_reason == "MAX_TOKENS" {
        return Err(format!("AI 输出被 token 上限截断：{text}"));
    }

    Ok(text)
}

fn format_api_error(status: reqwest::StatusCode, body: &str) -> (String, bool) {
    let mut retryable = is_retryable_status(status);
    let message = serde_json::from_str::<ChatErrorBody>(body)
        .ok()
        .and_then(|error_body| error_body.error.and_then(|error| error.message))
        .unwrap_or_else(|| body.trim().to_string());

    retryable = retryable || is_retryable_message(&message);

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || message.to_lowercase().contains("quota")
        || message.to_lowercase().contains("rate limit")
    {
        return (format!("AI 请求太频繁或额度不足：{message}"), false);
    }

    if message.is_empty() {
        (format!("AI 返回错误：HTTP {status}"), retryable)
    } else {
        (format!("AI 返回错误：{message}"), retryable)
    }
}

#[tauri::command]
fn save_gemini_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 不能为空。".to_string());
    }

    api_key_entry()?
        .set_password(api_key)
        .map_err(|error| format!("保存 API Key 失败：{error}"))
}

#[tauri::command]
fn has_gemini_api_key() -> Result<bool, String> {
    match read_saved_api_key() {
        Ok(api_key) => Ok(!api_key.trim().is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn delete_gemini_api_key() -> Result<(), String> {
    if let Ok(entry) = api_key_entry() {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = legacy_gemini_key_entry() {
        let _ = entry.delete_credential();
    }
    Ok(())
}

async fn call_ai(base_url: String, model: String, prompt: String, user_note: String) -> Result<String, String> {
    let api_key = read_saved_api_key()?;
    let endpoint = normalize_chat_endpoint(base_url);
    let model = normalize_model(model);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("初始化 AI HTTP 客户端失败：{error}"))?;

    let mut last_error = "AI 请求失败。".to_string();

    for attempt in 0..=CHAT_MAX_RETRIES {
        let request = ChatCompletionRequest {
            model: model.clone(),
            messages: vec![
                ChatMessageRequest {
                    role: "system".to_string(),
                    content: default_instruction(&user_note),
                },
                ChatMessageRequest {
                    role: "user".to_string(),
                    content: normalize_prompt(&prompt),
                },
            ],
            reasoning_effort: "medium".to_string(),
            max_completion_tokens: 512,
        };

        let response = client
            .post(&endpoint)
            .bearer_auth(api_key.trim())
            .json(&request)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let retryable = error.is_timeout() || error.is_connect() || error.is_request();
                last_error = format_transport_error(error);
                if retryable && attempt < CHAT_MAX_RETRIES {
                    thread::sleep(retry_delay(attempt + 1));
                    continue;
                }
                return Err(last_error);
            }
        };

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("读取 AI 响应失败：{error}"))?;

        if status.is_success() {
            return parse_chat_body(&body);
        }

        let (message, retryable) = format_api_error(status, &body);
        last_error = message;

        if retryable && attempt < CHAT_MAX_RETRIES {
            thread::sleep(retry_delay(attempt + 1));
            continue;
        }

        return Err(last_error);
    }

    Err(format!("{last_error} 已自动重试 {CHAT_MAX_RETRIES} 次。"))
}

#[tauri::command]
async fn ask_gemini(base_url: String, model: String, prompt: String, user_note: String) -> Result<String, String> {
    call_ai(base_url, model, prompt, user_note).await
}

#[tauri::command]
async fn test_gemini_connection(base_url: String, model: String, user_note: String) -> Result<String, String> {
    call_ai(base_url, model, "请只回复：连接成功。".to_string(), user_note).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ask_gemini,
            test_gemini_connection,
            save_gemini_api_key,
            has_gemini_api_key,
            delete_gemini_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
