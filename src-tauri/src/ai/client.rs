use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::command::strip_code_fences;
use super::sanitizer::sanitize_terminal_buffer;

/// Error string returned when a request was cancelled via [`AiClient::cancel`].
/// The frontend matches on it to show "cancelled" instead of an error.
pub const AI_CANCELLED: &str = "__AI_CANCELLED__";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStreamChunk {
    pub chunk: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Total timeout for non-streaming requests (connection test, sync completion).
const SYNC_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Max characters of a provider error body echoed back to the UI.
const ERROR_BODY_MAX_CHARS: usize = 500;

tokio::task_local! {
    /// Set by [`AiClient::cancel`] before the abort takes effect. Abort is only
    /// observed at the next `.await`, so the SSE loops check this flag before
    /// every `on_chunk` to guarantee nothing is emitted after a cancel.
    static CANCEL_FLAG: Arc<AtomicBool>;
}

fn cancel_requested() -> bool {
    CANCEL_FLAG
        .try_with(|f| f.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// Removes `user:pass@` userinfo and the query string (which may carry
/// `?key=…`) from a URL before it is shown in an error message.
fn redact_url(url: &str) -> String {
    let (scheme, rest) = match url.find("://") {
        Some(i) => (&url[..i + 3], &url[i + 3..]),
        None => ("", url),
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, path) = rest.split_at(authority_end);
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let path = path.split(['?', '#']).next().unwrap_or("");
    format!("{scheme}{host}{path}")
}

/// Truncates and sanitizes a provider error body (it may echo request data).
fn redact_error_body(body: &str, api_key: Option<&str>) -> String {
    let mut text: String = body.trim().chars().take(ERROR_BODY_MAX_CHARS).collect();
    if body.trim().chars().count() > ERROR_BODY_MAX_CHARS {
        text.push('…');
    }
    if let Some(key) = api_key.filter(|k| k.len() >= 4) {
        text = text.replace(key, "[REDACTED]");
    }
    sanitize_terminal_buffer(&text)
}

fn request_error(url: &str, e: reqwest::Error) -> String {
    format!("Request failed to {}: {}", redact_url(url), e.without_url())
}

async fn http_error(provider: &str, resp: reqwest::Response, api_key: Option<&str>) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    format!("{provider} returned HTTP {status}: {}", redact_error_body(&body, api_key))
}

/// Result of feeding one SSE line to a provider-specific parser.
#[derive(Debug, Default, PartialEq)]
struct SseStep {
    text: Option<String>,
    /// A terminal event arrived; stop reading.
    done: bool,
}

trait SseParser {
    /// Parses one complete, trimmed, non-empty line. `Err` aborts the stream.
    fn parse_line(&mut self, line: &str) -> Result<SseStep, String>;
}

const STREAM_TRUNCATED: &str = "AI response truncated (token limit reached)";
const STREAM_ENDED: &str = "AI stream ended unexpectedly before the response was complete";

fn stream_error_message(json: &serde_json::Value, api_key: Option<&str>) -> String {
    let err = &json["error"];
    let msg = err["message"]
        .as_str()
        .map(str::to_string)
        .or_else(|| err.as_str().map(str::to_string))
        .unwrap_or_else(|| err.to_string());
    format!("AI provider stream error: {}", redact_error_body(&msg, api_key))
}

/// OpenAI-compatible (`/chat/completions`) SSE, also used for Ollama.
#[derive(Default)]
struct OpenAiSse {
    api_key: Option<String>,
}

impl SseParser for OpenAiSse {
    fn parse_line(&mut self, line: &str) -> Result<SseStep, String> {
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(SseStep::default());
        };
        let data = data.trim();
        if data == "[DONE]" {
            return Ok(SseStep { text: None, done: true });
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
            return Ok(SseStep::default());
        };
        if !json["error"].is_null() {
            return Err(stream_error_message(&json, self.api_key.as_deref()));
        }
        let choice = &json["choices"][0];
        let text = choice["delta"]["content"]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        let done = match choice["finish_reason"].as_str() {
            None => false,
            Some("length") => return Err(STREAM_TRUNCATED.to_string()),
            Some("content_filter") => {
                return Err("AI response was blocked by the provider's content filter".to_string())
            }
            Some(_) => true,
        };
        Ok(SseStep { text, done })
    }
}

/// Anthropic Messages API SSE.
#[derive(Default)]
struct AnthropicSse {
    api_key: Option<String>,
}

impl SseParser for AnthropicSse {
    fn parse_line(&mut self, line: &str) -> Result<SseStep, String> {
        // `event: error` is always followed by a `data:` line with the details.
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(SseStep::default());
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
            return Ok(SseStep::default());
        };
        match json["type"].as_str().unwrap_or("") {
            "content_block_delta" => Ok(SseStep {
                text: json["delta"]["text"]
                    .as_str()
                    .filter(|t| !t.is_empty())
                    .map(str::to_string),
                done: false,
            }),
            "message_delta" if json["delta"]["stop_reason"].as_str() == Some("max_tokens") => {
                Err(STREAM_TRUNCATED.to_string())
            }
            "message_stop" => Ok(SseStep { text: None, done: true }),
            "error" => Err(stream_error_message(&json, self.api_key.as_deref())),
            _ => Ok(SseStep::default()),
        }
    }
}

/// Splits a byte stream into lines and drives an [`SseParser`]. Kept
/// synchronous so the termination / error logic is unit-testable.
struct SseDriver<P> {
    parser: P,
    /// Raw bytes; only complete lines are decoded so a multi-byte UTF-8 char
    /// split across network chunks is not garbled.
    buffer: Vec<u8>,
    full_text: String,
    done: bool,
}

impl<P: SseParser> SseDriver<P> {
    fn new(parser: P) -> Self {
        Self { parser, buffer: Vec::new(), full_text: String::new(), done: false }
    }

    fn handle_line<F>(&mut self, line_bytes: &[u8], on_chunk: &mut F) -> Result<(), String>
    where
        F: FnMut(&str, bool) -> Result<(), String>,
    {
        let line = String::from_utf8_lossy(line_bytes);
        let line = line.trim();
        if line.is_empty() {
            return Ok(());
        }
        let step = self.parser.parse_line(line)?;
        if let Some(text) = step.text {
            if cancel_requested() {
                return Err(AI_CANCELLED.to_string());
            }
            self.full_text.push_str(&text);
            on_chunk(&text, false)?;
        }
        if step.done {
            self.done = true;
        }
        Ok(())
    }

    /// Feeds network bytes. Returns `Ok(true)` once a terminal event arrived.
    fn feed<F>(&mut self, bytes: &[u8], on_chunk: &mut F) -> Result<bool, String>
    where
        F: FnMut(&str, bool) -> Result<(), String>,
    {
        self.buffer.extend_from_slice(bytes);
        while !self.done {
            let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') else { break };
            let line: Vec<u8> = self.buffer.drain(..=pos).collect();
            self.handle_line(&line, on_chunk)?;
        }
        Ok(self.done)
    }

    /// Called at EOF (or after a terminal event). Processes a trailing line
    /// without `\n`, then fails unless a terminal event was seen.
    fn finish<F>(mut self, on_chunk: &mut F) -> Result<String, String>
    where
        F: FnMut(&str, bool) -> Result<(), String>,
    {
        if !self.done && !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            self.handle_line(&rest, on_chunk)?;
        }
        if !self.done {
            return Err(STREAM_ENDED.to_string());
        }
        if cancel_requested() {
            return Err(AI_CANCELLED.to_string());
        }
        on_chunk("", true)?;
        Ok(self.full_text)
    }
}

async fn drive_sse<P, F>(resp: reqwest::Response, parser: P, mut on_chunk: F) -> Result<String, String>
where
    P: SseParser,
    F: FnMut(&str, bool) -> Result<(), String> + Send,
{
    let mut stream = resp.bytes_stream();
    let mut driver = SseDriver::new(parser);
    while let Some(chunk_res) = stream.next().await {
        let chunk_bytes = chunk_res.map_err(|e| format!("Stream read error: {}", e.without_url()))?;
        if driver.feed(&chunk_bytes, &mut on_chunk)? {
            break;
        }
    }
    // Raw text: callers decide how to post-process (JSON parse vs. prose).
    driver.finish(&mut on_chunk)
}

#[derive(Default)]
struct InflightRegistry {
    running: HashMap<String, (AbortHandle, Arc<AtomicBool>)>,
    /// Cancels that arrived before the request registered (the frontend may
    /// hit Stop right after invoking). Bounded so stale ids can't pile up.
    cancelled_early: HashSet<String>,
}

pub struct AiClient {
    http: reqwest::Client,
    inflight: Mutex<InflightRegistry>,
}

impl AiClient {
    pub fn new() -> Self {
        // No total `timeout` here: it would cap the whole streamed body and cut long
        // generations (e.g. slow local Ollama) mid-stream. `read_timeout` resets on
        // every received chunk, so it only fires when the server actually stalls.
        // Non-streaming requests set their own per-request total timeout.
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http,
            inflight: Mutex::new(InflightRegistry::default()),
        }
    }

    /// Runs `fut` under `request_id` so it can be aborted with [`Self::cancel`].
    /// Dropping the future also drops the in-flight HTTP stream, so the
    /// provider connection is closed and no further tokens are billed.
    pub async fn run_cancellable<T, Fut>(&self, request_id: &str, fut: Fut) -> Result<T, String>
    where
        Fut: Future<Output = Result<T, String>>,
    {
        let (handle, registration) = AbortHandle::new_pair();
        let flag = Arc::new(AtomicBool::new(false));
        {
            let mut reg = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
            if reg.cancelled_early.remove(request_id) {
                return Err(AI_CANCELLED.to_string());
            }
            reg.running.insert(request_id.to_string(), (handle, flag.clone()));
        }

        let result = CANCEL_FLAG.scope(flag, Abortable::new(fut, registration)).await;

        self.inflight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .running
            .remove(request_id);

        match result {
            Ok(inner) => inner,
            Err(_aborted) => Err(AI_CANCELLED.to_string()),
        }
    }

    /// Cancels an in-flight request. Returns true if it was running.
    pub fn cancel(&self, request_id: &str) -> bool {
        let mut reg = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((handle, flag)) = reg.running.remove(request_id) {
            flag.store(true, Ordering::SeqCst);
            handle.abort();
            true
        } else {
            if reg.cancelled_early.len() >= 64 {
                reg.cancelled_early.clear();
            }
            reg.cancelled_early.insert(request_id.to_string());
            false
        }
    }

    /// Test if the provider endpoint and API key are valid
    pub async fn test_connection(
        &self,
        provider_type: &str,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
    ) -> Result<String, String> {
        if provider_type == "ollama" && (model_name.is_empty() || model_name == "default") {
            // Check Ollama server availability
            let root_url = base_url.trim_end_matches('/').trim_end_matches("/v1");
            let url = format!("{root_url}/api/version");
            let resp = self.http.get(&url).timeout(Duration::from_secs(5)).send().await
                .map_err(|e| format!("Failed to connect to Ollama at {}: {}", redact_url(base_url), e.without_url()))?;
            if resp.status().is_success() {
                return Ok("Ollama server connected successfully".to_string());
            }
        }

        // Test with a quick 1-token prompt
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "hi".to_string(),
        }];

        let result = self.chat_completion_sync(
            provider_type,
            base_url,
            model_name,
            api_key,
            &messages,
            Some(5),
        ).await?;

        Ok(format!("Connected successfully! Response: {}", result.trim()))
    }

    /// Fetch installed models from local Ollama instance (GET /api/tags)
    pub async fn fetch_ollama_models(&self, base_url: &str) -> Result<Vec<String>, String> {
        let root_url = base_url
            .trim_end_matches('/')
            .trim_end_matches("/v1");
        let url = format!("{root_url}/api/tags");

        let resp = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to query Ollama at {}: {}", redact_url(&url), e.without_url()))?;

        if !resp.status().is_success() {
            return Err(format!("Ollama returned status {}", resp.status()));
        }

        #[derive(Deserialize)]
        struct OllamaTags {
            models: Option<Vec<OllamaModel>>,
        }
        #[derive(Deserialize)]
        struct OllamaModel {
            name: String,
        }

        let tags: OllamaTags = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama model response: {}", e.without_url()))?;

        let models = tags
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|m| m.name)
            .collect();

        Ok(models)
    }

    /// Synchronous chat completion (used for quick checks or non-streaming)
    pub async fn chat_completion_sync(
        &self,
        provider_type: &str,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        if provider_type == "anthropic" {
            self.anthropic_chat_sync(base_url, model_name, api_key, messages, max_tokens).await
        } else {
            // "openai_compatible" and "ollama"
            self.openai_chat_sync(base_url, model_name, api_key, messages, max_tokens).await
        }
    }

    /// Streaming chat completion invoking `on_chunk(chunk, done)` callback.
    /// Returns the raw concatenated reply (not fence-stripped).
    pub async fn stream_chat_completion<F>(
        &self,
        provider_type: &str,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        on_chunk: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str, bool) -> Result<(), String> + Send,
    {
        if provider_type == "anthropic" {
            self.stream_anthropic(base_url, model_name, api_key, messages, on_chunk).await
        } else {
            self.stream_openai(base_url, model_name, api_key, messages, on_chunk).await
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OpenAI / Ollama Implementation
    // ─────────────────────────────────────────────────────────────────────────

    fn build_openai_url(base_url: &str) -> String {
        let trimmed = base_url.trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else if has_version_segment(trimmed) {
            // Already versioned: /v1, /v1beta/openai, /api/paas/v4, …
            format!("{trimmed}/chat/completions")
        } else {
            format!("{trimmed}/v1/chat/completions")
        }
    }

    async fn openai_chat_sync(
        &self,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let url = Self::build_openai_url(base_url);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(key) = api_key {
            if !key.is_empty() {
                if let Ok(val) = HeaderValue::from_str(&format!("Bearer {key}")) {
                    headers.insert(AUTHORIZATION, val);
                }
            }
        }

        let body = serde_json::json!({
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens.unwrap_or(2048),
            "temperature": 0.2,
            "stream": false,
        });

        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .timeout(SYNC_REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| request_error(&url, e))?;

        if !resp.status().is_success() {
            return Err(http_error("AI Provider", resp, api_key).await);
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response JSON: {}", e.without_url()))?;

        let text = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(strip_code_fences(&text))
    }

    async fn stream_openai<F>(
        &self,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        on_chunk: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str, bool) -> Result<(), String> + Send,
    {
        let url = Self::build_openai_url(base_url);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(key) = api_key {
            if !key.is_empty() {
                if let Ok(val) = HeaderValue::from_str(&format!("Bearer {key}")) {
                    headers.insert(AUTHORIZATION, val);
                }
            }
        }

        let body = serde_json::json!({
            "model": model_name,
            "messages": messages,
            "max_tokens": 2048,
            "temperature": 0.2,
            "stream": true,
        });

        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| request_error(&url, e))?;

        if !resp.status().is_success() {
            return Err(http_error("AI Provider", resp, api_key).await);
        }

        let parser = OpenAiSse { api_key: api_key.map(str::to_string) };
        drive_sse(resp, parser, on_chunk).await
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Anthropic Implementation
    // ─────────────────────────────────────────────────────────────────────────

    fn build_anthropic_url(base_url: &str) -> String {
        let trimmed = base_url.trim_end_matches('/');
        if trimmed.ends_with("/messages") {
            trimmed.to_string()
        } else if trimmed.ends_with("/v1") {
            format!("{trimmed}/messages")
        } else {
            format!("{trimmed}/v1/messages")
        }
    }

    async fn anthropic_chat_sync(
        &self,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let url = Self::build_anthropic_url(base_url);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        if let Some(key) = api_key {
            if let Ok(val) = HeaderValue::from_str(key) {
                headers.insert("x-api-key", val);
            }
        }

        let (system_prompt, filtered_messages) = extract_system_for_anthropic(messages);

        let mut body = serde_json::json!({
            "model": model_name,
            "messages": filtered_messages,
            "max_tokens": max_tokens.unwrap_or(2048),
            "temperature": 0.2,
            "stream": false,
        });

        if let Some(sys) = system_prompt {
            body["system"] = serde_json::Value::String(sys);
        }

        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .timeout(SYNC_REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| request_error(&url, e))?;

        if !resp.status().is_success() {
            return Err(http_error("Anthropic", resp, api_key).await);
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response JSON: {}", e.without_url()))?;

        let mut text = String::new();
        if let Some(contents) = json["content"].as_array() {
            for item in contents {
                if item["type"].as_str() == Some("text") {
                    if let Some(t) = item["text"].as_str() {
                        text.push_str(t);
                    }
                }
            }
        }

        Ok(strip_code_fences(&text))
    }

    async fn stream_anthropic<F>(
        &self,
        base_url: &str,
        model_name: &str,
        api_key: Option<&str>,
        messages: &[ChatMessage],
        on_chunk: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str, bool) -> Result<(), String> + Send,
    {
        let url = Self::build_anthropic_url(base_url);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        if let Some(key) = api_key {
            if let Ok(val) = HeaderValue::from_str(key) {
                headers.insert("x-api-key", val);
            }
        }

        let (system_prompt, filtered_messages) = extract_system_for_anthropic(messages);

        let mut body = serde_json::json!({
            "model": model_name,
            "messages": filtered_messages,
            "max_tokens": 2048,
            "temperature": 0.2,
            "stream": true,
        });

        if let Some(sys) = system_prompt {
            body["system"] = serde_json::Value::String(sys);
        }

        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| request_error(&url, e))?;

        if !resp.status().is_success() {
            return Err(http_error("Anthropic", resp, api_key).await);
        }

        let parser = AnthropicSse { api_key: api_key.map(str::to_string) };
        drive_sse(resp, parser, on_chunk).await
    }
}

/// True when the URL path (not the host) has a `/v<digit>…` segment.
fn has_version_segment(url: &str) -> bool {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let path = rest.find('/').map_or("", |i| &rest[i..]);
    path.split('/').any(|seg| {
        let mut chars = seg.chars();
        matches!(chars.next(), Some('v' | 'V')) && chars.next().is_some_and(|c| c.is_ascii_digit())
    })
}

/// Anthropic requires system prompt to be passed in top-level `system` field rather than inside `messages`.
fn extract_system_for_anthropic(messages: &[ChatMessage]) -> (Option<String>, Vec<serde_json::Value>) {
    let mut system_prompt = None;
    let mut filtered = Vec::new();

    for m in messages {
        if m.role == "system" {
            system_prompt = Some(m.content.clone());
        } else {
            filtered.push(serde_json::json!({
                "role": m.role,
                "content": m.content,
            }));
        }
    }

    (system_prompt, filtered)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds `chunks` through a driver; returns (result, emitted chunks).
    fn run<P: SseParser>(parser: P, chunks: &[&str]) -> (Result<String, String>, Vec<(String, bool)>) {
        let mut emitted = Vec::new();
        let mut on_chunk = |c: &str, done: bool| {
            emitted.push((c.to_string(), done));
            Ok(())
        };
        let mut driver = SseDriver::new(parser);
        let mut result = None;
        for c in chunks {
            match driver.feed(c.as_bytes(), &mut on_chunk) {
                Ok(true) => break,
                Ok(false) => {}
                Err(e) => {
                    result = Some(Err(e));
                    break;
                }
            }
        }
        let result = result.unwrap_or_else(|| driver.finish(&mut on_chunk));
        (result, emitted)
    }

    fn openai() -> OpenAiSse {
        OpenAiSse::default()
    }

    fn anthropic() -> AnthropicSse {
        AnthropicSse::default()
    }

    #[test]
    fn openai_done_marker_completes() {
        let (r, emitted) = run(openai(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n",
        ]);
        assert_eq!(r.unwrap(), "Hello");
        assert_eq!(emitted.last(), Some(&(String::new(), true)));
    }

    #[test]
    fn openai_finish_reason_stop_completes_without_done() {
        let (r, _) = run(openai(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n",
        ]);
        assert_eq!(r.unwrap(), "ok");
    }

    #[test]
    fn openai_trailing_line_without_newline() {
        let (r, _) = run(openai(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n",
            "data: [DONE]",
        ]);
        assert_eq!(r.unwrap(), "a");
    }

    #[test]
    fn openai_eof_without_terminal_event_is_error() {
        let (r, emitted) = run(openai(), &["data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n"]);
        assert_eq!(r.unwrap_err(), STREAM_ENDED);
        assert!(emitted.iter().all(|(_, done)| !done), "no done signal on error");
    }

    #[test]
    fn openai_length_is_truncation_error() {
        let (r, _) = run(openai(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":\"length\"}]}\ndata: [DONE]\n",
        ]);
        assert_eq!(r.unwrap_err(), STREAM_TRUNCATED);
    }

    #[test]
    fn openai_mid_stream_error_event() {
        let (r, _) = run(openai(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n",
            "data: {\"error\":{\"message\":\"rate limited\"}}\n",
        ]);
        let e = r.unwrap_err();
        assert!(e.contains("rate limited"), "{e}");
    }

    #[test]
    fn utf8_split_across_chunks() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"héllo\"},\"finish_reason\":\"stop\"}]}\n";
        let bytes = line.as_bytes();
        let split = line.find('é').unwrap() + 1; // inside the 2-byte char
        let mut driver = SseDriver::new(openai());
        let mut out = String::new();
        let mut on_chunk = |c: &str, _| {
            out.push_str(c);
            Ok(())
        };
        driver.feed(&bytes[..split], &mut on_chunk).unwrap();
        driver.feed(&bytes[split..], &mut on_chunk).unwrap();
        assert_eq!(driver.finish(&mut on_chunk).unwrap(), "héllo");
    }

    #[test]
    fn anthropic_message_stop_completes() {
        let (r, emitted) = run(anthropic(), &[
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}",
        ]);
        assert_eq!(r.unwrap(), "Hi");
        assert_eq!(emitted.last(), Some(&(String::new(), true)));
    }

    #[test]
    fn anthropic_eof_without_message_stop_is_error() {
        let (r, _) = run(anthropic(), &[
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"Hi\"}}\n",
        ]);
        assert_eq!(r.unwrap_err(), STREAM_ENDED);
    }

    #[test]
    fn anthropic_error_event() {
        let (r, _) = run(anthropic(), &[
            "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n",
        ]);
        assert!(r.unwrap_err().contains("Overloaded"));
    }

    #[test]
    fn anthropic_max_tokens_is_truncation_error() {
        let (r, _) = run(anthropic(), &[
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\ndata: {\"type\":\"message_stop\"}\n",
        ]);
        assert_eq!(r.unwrap_err(), STREAM_TRUNCATED);
    }

    #[tokio::test]
    async fn no_chunks_emitted_after_cancel() {
        let flag = Arc::new(AtomicBool::new(false));
        let f2 = flag.clone();
        let (r, emitted) = CANCEL_FLAG
            .scope(flag, async move {
                let mut emitted = Vec::new();
                let mut on_chunk = |c: &str, done: bool| {
                    emitted.push((c.to_string(), done));
                    Ok(())
                };
                let mut driver = SseDriver::new(OpenAiSse::default());
                driver
                    .feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n", &mut on_chunk)
                    .unwrap();
                f2.store(true, Ordering::SeqCst);
                let r = driver.feed(
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\ndata: [DONE]\n",
                    &mut on_chunk,
                );
                (r.map(|_| String::new()), emitted)
            })
            .await;
        assert_eq!(r.unwrap_err(), AI_CANCELLED);
        assert_eq!(emitted, vec![("a".to_string(), false)]);
    }

    #[test]
    fn openai_url_respects_existing_version_segment() {
        let u = AiClient::build_openai_url;
        assert_eq!(u("https://api.openai.com"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(u("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(
            u("https://generativelanguage.googleapis.com/v1beta/openai"),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        );
        assert_eq!(
            u("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        assert_eq!(u("https://ark.example.com/api/v3"), "https://ark.example.com/api/v3/chat/completions");
        assert_eq!(u("http://localhost:11434"), "http://localhost:11434/v1/chat/completions");
        // A "v1" host is not a path segment.
        assert_eq!(u("https://v1.example.com"), "https://v1.example.com/v1/chat/completions");
        // Words starting with v are not versions.
        assert_eq!(u("https://x.com/vendor"), "https://x.com/vendor/v1/chat/completions");
        assert_eq!(u("https://x.com/v1/chat/completions"), "https://x.com/v1/chat/completions");
    }

    #[test]
    fn error_messages_are_redacted() {
        assert_eq!(redact_url("https://user:pw@api.x.com/v1/chat?key=abc"), "https://api.x.com/v1/chat");
        assert_eq!(redact_url("http://localhost:11434"), "http://localhost:11434");

        let long = "x".repeat(2000);
        assert!(redact_error_body(&long, None).chars().count() <= ERROR_BODY_MAX_CHARS + 1);

        let body = r#"{"error":"invalid key sk-abcdefghijklmnopqrstuvwxyz123 for MYKEY123"}"#;
        let out = redact_error_body(body, Some("MYKEY123"));
        assert!(!out.contains("sk-abcdefghijklmnopqrstuvwxyz123"));
        assert!(!out.contains("MYKEY123"));
    }
}
