use serde::{Deserialize, Serialize};
use std::{thread, time::Duration};

const GEMINI_ENDPOINT: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_MAX_RETRIES: u8 = 5;
const KEYRING_SERVICE: &str = "RezeAfterFireworks";
const GEMINI_KEY_ACCOUNT: &str = "gemini-api-key";

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorBody {
    error: Option<GeminiApiError>,
}

#[derive(Debug, Deserialize)]
struct GeminiApiError {
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentRequest {
    contents: Vec<Content>,
    system_instruction: Content,
    generation_config: GenerationConfig,
}

#[derive(Clone, Debug, Serialize)]
struct Content {
    parts: Vec<TextPart>,
}

#[derive(Clone, Debug, Serialize)]
struct TextPart {
    text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    temperature: f32,
    max_output_tokens: u16,
    thinking_config: ThinkingConfig,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThinkingConfig {
    thinking_budget: i16,
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

fn gemini_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, GEMINI_KEY_ACCOUNT)
        .map_err(|error| format!("打开系统凭据失败：{error}"))
}

fn read_saved_gemini_key() -> Result<String, String> {
    let api_key = gemini_key_entry()?.get_password().map_err(|_| {
        "请先在设置里保存 Gemini API Key。它会存进 Windows 凭据管理器，不会写入项目文件。".to_string()
    })?;

    if api_key.trim().is_empty() {
        Err("请先在设置里保存 Gemini API Key。".to_string())
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

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status == reqwest::StatusCode::INTERNAL_SERVER_ERROR
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
        || lower.contains("rate limit")
        || lower.contains("quota")
}

fn format_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Gemini 请求超时：当前网络无法在 20 秒内连接到 generativelanguage.googleapis.com。请检查代理/VPN 或网络环境。".to_string()
    } else if error.is_connect() {
        format!("Gemini 连接失败：无法连接到 generativelanguage.googleapis.com。通常是网络、代理、DNS 或防火墙问题，不是 API Key 错。详细信息：{error}")
    } else if error.is_request() {
        format!("Gemini 请求无法发送：请检查系统代理、证书或网络环境。详细信息：{error}")
    } else {
        format!("Gemini 请求失败：{error}")
    }
}

fn parse_gemini_body(body: &str) -> Result<String, String> {
    let parsed: GeminiResponse =
        serde_json::from_str(body).map_err(|error| format!("解析 Gemini 响应失败：{error}"))?;

    let candidate = parsed
        .candidates
        .and_then(|mut candidates| candidates.pop())
        .ok_or_else(|| "Gemini 没有返回候选回复。".to_string())?;

    let finish_reason = candidate.finish_reason.unwrap_or_else(|| "UNKNOWN".to_string());
    let text = candidate
        .content
        .and_then(|content| content.parts)
        .and_then(|parts| {
            let joined = parts
                .into_iter()
                .filter_map(|part| part.text)
                .collect::<Vec<_>>()
                .join("");

            if joined.trim().is_empty() {
                None
            } else {
                Some(joined.trim().to_string())
            }
        })
        .ok_or_else(|| format!("Gemini 没有返回可显示的文本。结束原因：{finish_reason}"))?;

    if finish_reason == "MAX_TOKENS" {
        return Err(format!("Gemini 输出被 token 上限截断：{text}"));
    }

    Ok(text)
}

#[tauri::command]
fn save_gemini_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 不能为空。".to_string());
    }

    gemini_key_entry()?
        .set_password(api_key)
        .map_err(|error| format!("保存 Gemini API Key 失败：{error}"))
}

#[tauri::command]
fn has_gemini_api_key() -> Result<bool, String> {
    match gemini_key_entry()?.get_password() {
        Ok(api_key) => Ok(!api_key.trim().is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn delete_gemini_api_key() -> Result<(), String> {
    match gemini_key_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(_) => Ok(()),
    }
}

async fn call_gemini(prompt: String, user_note: String) -> Result<String, String> {
    let api_key = read_saved_gemini_key()?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("初始化 Gemini HTTP 客户端失败：{error}"))?;

    let mut last_error = "Gemini 请求失败。".to_string();

    for attempt in 0..=GEMINI_MAX_RETRIES {
        let request = GenerateContentRequest {
            contents: vec![Content {
                parts: vec![TextPart {
                    text: normalize_prompt(&prompt),
                }],
            }],
            system_instruction: Content {
                parts: vec![TextPart {
                    text: default_instruction(&user_note),
                }],
            },
            generation_config: GenerationConfig {
                temperature: 0.95,
                max_output_tokens: 512,
                thinking_config: ThinkingConfig { thinking_budget: 0 },
            },
        };

        let response = client
            .post(GEMINI_ENDPOINT)
            .header("x-goog-api-key", api_key.trim())
            .json(&request)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let retryable = error.is_timeout() || error.is_connect() || error.is_request();
                last_error = format_transport_error(error);
                if retryable && attempt < GEMINI_MAX_RETRIES {
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
            .map_err(|error| format!("读取 Gemini 响应失败：{error}"))?;

        if status.is_success() {
            return parse_gemini_body(&body);
        }

        let mut retryable = is_retryable_status(status);
        if let Ok(error_body) = serde_json::from_str::<GeminiErrorBody>(&body) {
            if let Some(message) = error_body.error.and_then(|error| error.message) {
                retryable = retryable || is_retryable_message(&message);
                last_error = format!("Gemini 返回错误：{message}");
            } else {
                last_error = format!("Gemini 返回错误：HTTP {status}");
            }
        } else {
            retryable = retryable || is_retryable_message(&body);
            last_error = format!("Gemini 返回错误：HTTP {status}");
        }

        if retryable && attempt < GEMINI_MAX_RETRIES {
            thread::sleep(retry_delay(attempt + 1));
            continue;
        }

        return Err(last_error);
    }

    Err(format!("{last_error} 已自动重试 {GEMINI_MAX_RETRIES} 次。"))
}

#[tauri::command]
async fn ask_gemini(prompt: String, user_note: String) -> Result<String, String> {
    call_gemini(prompt, user_note).await
}

#[tauri::command]
async fn test_gemini_connection(user_note: String) -> Result<String, String> {
    call_gemini("请只回复：连接成功。".to_string(), user_note).await
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
