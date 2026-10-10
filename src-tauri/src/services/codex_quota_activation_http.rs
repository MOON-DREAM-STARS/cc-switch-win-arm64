//! Isolated, single dispatch transport for the automatic activation request.
//!
//! The caller supplies a client and endpoint so tests can use a loopback fake
//! server. Production wiring can reuse the application's proxy configured
//! client, while this module itself never touches OAuth files or providers.

use crate::proxy::providers::codex_oauth_auth::{
    CODEX_OAUTH_CLIENT_VERSION, CODEX_OAUTH_ORIGINATOR,
};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) const ACTIVATION_MODEL: &str = "gpt-6-luna";
pub(crate) const ACTIVATION_REASONING_EFFORT: &str = "low";
pub(crate) const ACTIVATION_INPUT: &str = "hello";
pub(crate) const ACTIVATION_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/responses";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivationHttpStatus {
    Completed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActivationHttpResult {
    pub status: ActivationHttpStatus,
    pub actual_model: Option<String>,
    pub error: Option<String>,
}

pub(crate) fn build_activation_request(
    client: &Client,
    endpoint: &str,
    token: &str,
    workspace: &str,
) -> RequestBuilder {
    let body = json!({
        "model": ACTIVATION_MODEL,
        "input": [{
            "role": "user",
            "content": [{"type": "input_text", "text": ACTIVATION_INPUT}]
        }],
        "instructions": "",
        "tools": [],
        "parallel_tool_calls": true,
        "include": ["reasoning.encrypted_content"],
        "store": false,
        "stream": true,
        "reasoning": {"effort": ACTIVATION_REASONING_EFFORT}
    });
    client
        .post(endpoint)
        .query(&[("client_version", CODEX_OAUTH_CLIENT_VERSION)])
        .header("Authorization", format!("Bearer {token}"))
        .header("ChatGPT-Account-Id", workspace)
        .header("originator", CODEX_OAUTH_ORIGINATOR)
        .header("version", CODEX_OAUTH_CLIENT_VERSION)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .header("Accept-Encoding", "identity")
        .json(&body)
}

/// Send exactly one POST. The supplied client should have redirects and retry
/// policies disabled by its factory; this function has no application retry.
pub(crate) async fn send_activation_once(
    client: &Client,
    endpoint: &str,
    token: &str,
    workspace: &str,
) -> ActivationHttpResult {
    let result = tokio::time::timeout(
        ACTIVATION_TIMEOUT,
        send_activation_inner(client, endpoint, token, workspace),
    )
    .await;
    match result {
        Ok(result) => result,
        Err(_) => unknown("activation response timed out", &[token, workspace]),
    }
}

async fn send_activation_inner(
    client: &Client,
    endpoint: &str,
    token: &str,
    workspace: &str,
) -> ActivationHttpResult {
    let response = match build_activation_request(client, endpoint, token, workspace)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return unknown(&format!("transport error: {error}"), &[token, workspace]),
    };
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return failed(&format!("HTTP {status}"), &[token, workspace]);
    }
    if !status.is_success() {
        let body = read_bounded(response).await.unwrap_or_default();
        let message = format!("HTTP {status}: {body}");
        return if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
            unknown(&message, &[token, workspace])
        } else {
            failed(&message, &[token, workspace])
        };
    }
    let body = match read_bounded_stream(response).await {
        Ok(body) => body,
        Err(error) => return unknown(&error, &[token, workspace]),
    };
    classify_sse(&body)
}

async fn read_bounded(response: reqwest::Response) -> Result<String, String> {
    read_bounded_stream(response).await
}

async fn read_bounded_stream(mut response: reqwest::Response) -> Result<String, String> {
    let mut output = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if output.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("response exceeded size limit".to_string());
        }
        output.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&output).into_owned())
}

pub(crate) fn classify_sse(body: &str) -> ActivationHttpResult {
    let mut completed: Option<String> = None;
    let mut failure: Option<String> = None;
    let normalized = body.replace("\r\n", "\n");
    for block in normalized.split("\n\n") {
        let mut event = None;
        let mut data = String::new();
        for line in block.lines() {
            if let Some(value) = line.strip_prefix("event:") {
                event = Some(value.trim());
            } else if let Some(value) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(value.trim_start());
            }
        }
        let parsed = serde_json::from_str::<Value>(&data).ok();
        let event_name = event.or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("type").and_then(Value::as_str))
        });
        match event_name {
            Some("response.completed") => {
                completed = parsed.as_ref().and_then(|value| {
                    value
                        .pointer("/response/model")
                        .or_else(|| value.get("model"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                });
            }
            Some("response.failed" | "response.cancelled" | "response.incomplete" | "error") => {
                failure = Some(
                    parsed
                        .as_ref()
                        .and_then(|value| value.get("error").or_else(|| value.get("message")))
                        .and_then(Value::as_str)
                        .unwrap_or("activation failed")
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    if let (Some(_), Some(error)) = (completed.as_ref(), failure.as_ref()) {
        return failed(&format!("conflicting terminal events: {error}"), &[]);
    }
    if let Some(actual_model) = completed {
        if actual_model != ACTIVATION_MODEL {
            return failed("server returned an unexpected model", &[]);
        }
        return ActivationHttpResult {
            status: ActivationHttpStatus::Completed,
            actual_model: Some(actual_model),
            error: None,
        };
    }
    if let Some(error) = failure {
        return failed(&error, &[]);
    }
    unknown("response ended without a terminal event", &[])
}

fn failed(error: &str, secrets: &[&str]) -> ActivationHttpResult {
    ActivationHttpResult {
        status: ActivationHttpStatus::Failed,
        actual_model: None,
        error: Some(sanitize(error, secrets)),
    }
}

fn unknown(error: &str, secrets: &[&str]) -> ActivationHttpResult {
    ActivationHttpResult {
        status: ActivationHttpStatus::Unknown,
        actual_model: None,
        error: Some(sanitize(error, secrets)),
    }
}

fn sanitize(error: &str, secrets: &[&str]) -> String {
    let mut output = error.to_string();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        output = output.replace(secret, "[REDACTED]");
    }
    output.chars().take(512).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, http::header, response::IntoResponse, routing::post, Router};
    use reqwest::redirect::Policy;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn request_is_fixed_to_luna_low_hello_and_stateless() {
        let client = Client::builder().redirect(Policy::none()).build().unwrap();
        let request = build_activation_request(
            &client,
            "http://127.0.0.1:1",
            "fake-token",
            "fake-workspace",
        )
        .build()
        .unwrap();
        let body: Value =
            serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], ACTIVATION_MODEL);
        assert_eq!(body["reasoning"]["effort"], ACTIVATION_REASONING_EFFORT);
        assert_eq!(body["input"][0]["content"][0]["text"], ACTIVATION_INPUT);
        assert_eq!(body["tools"], json!([]));
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(
            request.headers().get("ChatGPT-Account-Id").unwrap(),
            "fake-workspace"
        );
    }

    #[test]
    fn only_completed_terminal_event_is_success() {
        let completed = classify_sse("event: response.output_text.done\ndata: {}\n\nevent: response.completed\ndata: {\"response\":{\"model\":\"gpt-6-luna\"}}\n\n");
        assert_eq!(completed.status, ActivationHttpStatus::Completed);
        assert_eq!(
            classify_sse(
                "event: response.completed\ndata: {\"response\":{\"model\":\"other\"}}\n\n"
            )
            .status,
            ActivationHttpStatus::Failed
        );
        assert_eq!(
            classify_sse("data: [DONE]\n\n").status,
            ActivationHttpStatus::Unknown
        );
        assert_eq!(
            classify_sse("event: response.failed\ndata: {\"error\":{}}\n\n").status,
            ActivationHttpStatus::Failed
        );
    }

    #[test]
    fn errors_redact_tokens_and_are_bounded() {
        let result = failed("token=secret-token", &["secret-token"]);
        assert!(!result.error.unwrap().contains("secret-token"));
        assert_eq!(sanitize(&"x".repeat(600), &[]).len(), 512);
    }

    #[tokio::test]
    async fn fake_server_proves_redirect_and_server_error_never_replay_post() {
        async fn redirect(count: State<Arc<AtomicUsize>>) -> axum::response::Response {
            count.fetch_add(1, Ordering::SeqCst);
            (
                StatusCode::TEMPORARY_REDIRECT,
                [(header::LOCATION, "/target")],
            )
                .into_response()
        }
        async fn target(count: State<Arc<AtomicUsize>>) -> axum::response::Response {
            count.fetch_add(100, Ordering::SeqCst);
            StatusCode::OK.into_response()
        }
        async fn server_error(count: State<Arc<AtomicUsize>>) -> axum::response::Response {
            count.fetch_add(1, Ordering::SeqCst);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }

        let count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/redirect", post(redirect))
            .route("/target", post(target))
            .route("/server-error", post(server_error))
            .with_state(count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Client::builder().redirect(Policy::none()).build().unwrap();

        let redirect_result = send_activation_once(
            &client,
            &format!("http://{address}/redirect"),
            "fake-token",
            "fake-workspace",
        )
        .await;
        assert_eq!(redirect_result.status, ActivationHttpStatus::Failed);
        assert_eq!(
            count.load(Ordering::SeqCst),
            1,
            "redirect target received no replay"
        );

        let failure_result = send_activation_once(
            &client,
            &format!("http://{address}/server-error"),
            "fake-token",
            "fake-workspace",
        )
        .await;
        assert_eq!(failure_result.status, ActivationHttpStatus::Unknown);
        assert_eq!(
            count.load(Ordering::SeqCst),
            2,
            "5xx produced one POST and no retry"
        );
        server.abort();
    }
}
