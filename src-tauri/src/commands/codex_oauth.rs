//! Codex OAuth Tauri Commands
//!
//! 提供 OpenAI ChatGPT Plus/Pro OAuth 认证相关的 Tauri 命令。
//!
//! 大部分认证命令通过通用 `auth_*` 命令（参见 `commands::auth`）暴露给前端，
//! 此处定义 State wrapper 以及 Codex OAuth 专属的订阅额度和模型列表查询命令。

use crate::database::CodexQuotaActivationRecord;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::services::codex_quota_activation::{try_lock_account, ActivationDecision};
use crate::services::codex_quota_activation_http::{
    send_activation_once, ActivationHttpStatus, ACTIVATION_ENDPOINT,
};
use crate::services::model_fetch::FetchedModel;
use crate::services::subscription::{query_codex_quota, CredentialStatus, SubscriptionQuota};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

/// Codex OAuth 认证状态
///
/// `CodexOAuthManager` 内部已使用细粒度锁且所有方法均为 `&self`，因此这里
/// 直接持有 `Arc`，不再包一层 `RwLock`——避免任一命令持有粗粒度锁跨网络刷新
/// 时阻塞其他命令（切换 / 认证中心操作 / token 读取）。
pub struct CodexOAuthState(pub Arc<CodexOAuthManager>);

/// 查询 Codex OAuth (ChatGPT Plus/Pro) 订阅额度
///
/// - `account_id` 未指定时回退到 `CodexOAuthManager` 的默认账号
/// - 没有任何账号时返回 `not_found`，前端 `SubscriptionQuotaView` 会静默不渲染
/// - 复用 `services::subscription::query_codex_quota`，因此 wham/usage 端点协议
///   与 Codex CLI 路径完全一致
#[tauri::command(rename_all = "camelCase")]
pub async fn get_codex_oauth_quota(
    app: tauri::AppHandle,
    app_state: State<'_, crate::store::AppState>,
    account_id: Option<String>,
    state: State<'_, CodexOAuthState>,
) -> Result<SubscriptionQuota, String> {
    let manager = &state.0;

    // 解析最终使用的账号 ID：显式 > 默认账号 > 无账号 (not_found)
    let resolved = match account_id {
        Some(id) => Some(id.trim().to_string()),
        None => manager.default_account_id().await,
    };
    let Some(id) = resolved else {
        return Ok(SubscriptionQuota::not_found("codex_oauth"));
    };

    let result = query_codex_oauth_quota_for(manager, &id).await;
    // Cache by the resolved account, even if the default/binding changes while
    // the request is in flight. Transport errors retain the last good snapshot;
    // authentication/HTTP failures replace it so the tray hides invalid quotas.
    if let Ok(quota) = &result {
        app_state.usage_cache.put_codex_oauth(id, quota.clone());
        crate::tray::schedule_tray_refresh(&app);
    }
    result
}

async fn query_codex_oauth_quota_for(
    manager: &CodexOAuthManager,
    id: &str,
) -> Result<SubscriptionQuota, String> {
    // 获取（必要时自动刷新）access_token
    let token = match manager.get_valid_token_for_account(id).await {
        Ok(t) => t,
        Err(e) => {
            return Ok(SubscriptionQuota::error(
                "codex_oauth",
                CredentialStatus::Expired,
                format!("Codex OAuth token unavailable: {e}"),
            ));
        }
    };
    let chatgpt_account_id = manager
        .chatgpt_account_id_for_account(id)
        .await
        .map_err(|e| e.to_string())?;

    // 瞬时传输失败以 Err 传播（前端 reject → retry + 保留上次成功值）。
    query_codex_quota(
        &token,
        Some(&chatgpt_account_id),
        "codex_oauth",
        "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
    )
    .await
}

/// 获取 Codex OAuth (ChatGPT Plus/Pro) 可用模型列表
///
/// ChatGPT Codex 反代使用 `chatgpt.com/backend-api/codex/*`，不是 OpenAI 兼容
/// `/v1/models`。这里复用托管 OAuth 账号的 access_token，直接读取 Codex 后端
/// 暴露的模型列表端点。
#[tauri::command(rename_all = "camelCase")]
pub async fn get_codex_oauth_models(
    account_id: Option<String>,
    state: State<'_, CodexOAuthState>,
) -> Result<Vec<FetchedModel>, String> {
    let manager = &state.0;
    let resolved = match account_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(id) => Some(id.to_string()),
        None => manager.default_account_id().await,
    };
    let Some(id) = resolved else {
        return Err("No ChatGPT account available".to_string());
    };

    let token = manager
        .get_valid_token_for_account(&id)
        .await
        .map_err(|e| format!("Codex OAuth token unavailable: {e}"))?;
    let chatgpt_account_id = manager
        .chatgpt_account_id_for_account(&id)
        .await
        .map_err(|e| e.to_string())?;

    crate::services::codex_oauth_models::fetch_models_with_token(&token, &chatgpt_account_id).await
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaActivationPollResult {
    pub account_id: String,
    pub polled: bool,
    pub attempted: bool,
    pub target: Option<String>,
    pub status: String,
    pub reason: Option<String>,
    pub quota: Option<SubscriptionQuota>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_codex_quota_activation_state(
    account_id: String,
    app_state: State<'_, crate::store::AppState>,
    oauth_state: State<'_, CodexOAuthState>,
) -> Result<Option<CodexQuotaActivationRecord>, String> {
    let mut record = app_state
        .db
        .get_codex_quota_activation_state(account_id.trim())
        .map_err(|error| error.to_string())?;
    if let Some(record) = &mut record {
        record.effective_interval_minutes =
            derive_activation_interval(&app_state.db, &oauth_state.0, &record.account_id).await?;
    }
    Ok(record)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_codex_quota_activation_states(
    app_state: State<'_, crate::store::AppState>,
    oauth_state: State<'_, CodexOAuthState>,
) -> Result<Vec<CodexQuotaActivationRecord>, String> {
    let states = app_state
        .db
        .list_codex_quota_activation_states()
        .map_err(|error| error.to_string())?;
    let mut refreshed = Vec::with_capacity(states.len());
    for mut state in states {
        let interval =
            derive_activation_interval(&app_state.db, &oauth_state.0, &state.account_id).await?;
        state.effective_interval_minutes = interval;
        refreshed.push(state);
    }
    Ok(refreshed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_codex_quota_activation_enabled(
    account_id: String,
    enabled: bool,
    effective_interval_minutes: Option<u64>,
    app_state: State<'_, crate::store::AppState>,
    oauth_state: State<'_, CodexOAuthState>,
) -> Result<CodexQuotaActivationRecord, String> {
    let account_id = account_id.trim();
    if account_id.is_empty() {
        return Err("A specific ChatGPT account is required".to_string());
    }
    let _frontend_interval_is_untrusted = effective_interval_minutes;
    let effective_interval_minutes =
        derive_activation_interval(&app_state.db, &oauth_state.0, account_id).await?;
    if enabled && !effective_interval_minutes.is_some_and(|interval| interval > 0) {
        return Err(
            "No enabled official Codex quota interval is available for this account".to_string(),
        );
    }
    app_state
        .db
        .set_codex_quota_activation_enabled(
            account_id,
            enabled,
            effective_interval_minutes,
            chrono::Utc::now().timestamp_millis(),
        )
        .map_err(|error| error.to_string())
}

/// Explicit automatic polling entry. The frontend timer only requests this
/// command; the backend rechecks the account, enabled state and interval.
/// Manual quota commands never call it.
#[tauri::command(rename_all = "camelCase")]
pub async fn poll_codex_oauth_quota_for_activation(
    app: tauri::AppHandle,
    account_id: String,
    effective_interval_minutes: Option<u64>,
    app_state: State<'_, crate::store::AppState>,
    state: State<'_, CodexOAuthState>,
) -> Result<CodexQuotaActivationPollResult, String> {
    let account_id = account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("A specific ChatGPT account is required".to_string());
    }
    let Some(_account_guard) = try_lock_account(&account_id) else {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: false,
            attempted: false,
            target: None,
            status: "busy".to_string(),
            reason: Some("another account poll is still running".to_string()),
            quota: None,
        });
    };
    let now = chrono::Utc::now().timestamp_millis();
    let _frontend_interval_is_untrusted = effective_interval_minutes;
    let effective_interval_minutes =
        derive_activation_interval(&app_state.db, &state.0, &account_id).await?;
    if !app_state
        .db
        .try_begin_codex_quota_activation_poll(&account_id, effective_interval_minutes, now)
        .map_err(|error| error.to_string())?
    {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: false,
            attempted: false,
            target: None,
            status: "not_due".to_string(),
            reason: None,
            quota: None,
        });
    }
    let Some((enabled, authorization_revision)) = app_state
        .db
        .codex_quota_activation_revision(&account_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: false,
            attempted: false,
            target: None,
            status: "disabled".to_string(),
            reason: Some("activation_not_enabled".to_string()),
            quota: None,
        });
    };
    if !enabled {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: false,
            attempted: false,
            target: None,
            status: "disabled".to_string(),
            reason: Some("activation_not_enabled".to_string()),
            quota: None,
        });
    }

    let token = match state.0.get_valid_token_for_account(&account_id).await {
        Ok(token) => token,
        Err(_) => {
            return Ok(failed_poll(
                account_id,
                "token_unavailable",
                "指定账号 token 不可用".to_string(),
            ));
        }
    };
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let workspace = match state.0.chatgpt_account_id_for_account(&account_id).await {
        Ok(workspace) => workspace,
        Err(_) => {
            return Ok(failed_poll(
                account_id,
                "workspace_unavailable",
                "指定账号 workspace 不可用".to_string(),
            ))
        }
    };
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let (quota, snapshot) = crate::services::subscription::query_codex_quota_with_snapshot(
        &token,
        Some(&workspace),
        "codex_oauth",
        "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
    )
    .await?;
    app_state
        .usage_cache
        .put_codex_oauth(account_id.clone(), quota.clone());
    crate::tray::schedule_tray_refresh(&app);
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let Some(snapshot) = snapshot else {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: None,
            status: "quota_unavailable".to_string(),
            reason: Some("quota_snapshot_unavailable".to_string()),
            quota: Some(quota),
        });
    };
    if let Some(reason) =
        crate::services::codex_quota_activation::snapshot_freshness_reason(&snapshot, now_millis())
    {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: None,
            status: "stale_snapshot".to_string(),
            reason: Some(reason.to_string()),
            quota: Some(quota),
        });
    }
    let Some(mut record) = app_state
        .db
        .get_codex_quota_activation_state(&account_id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: None,
            status: "disabled".to_string(),
            reason: Some("activation_not_enabled".to_string()),
            quota: Some(quota),
        });
    };
    if !record.enabled || record.authorization_revision != authorization_revision {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: None,
            status: "disabled".to_string(),
            reason: Some("activation_not_enabled".to_string()),
            quota: Some(quota),
        });
    }
    let prior_state = record.state.clone();
    let decision = record.state.observe(&snapshot, now_millis());
    if record.state != prior_state {
        if !app_state
            .db
            .save_codex_quota_activation_state_if_revision(
                &account_id,
                authorization_revision,
                &record.state,
                now_millis(),
            )
            .map_err(|error| error.to_string())?
        {
            return Ok(disabled_poll(account_id, "authorization_changed"));
        }
    }
    let decision_for_result = decision.clone();
    let ActivationDecision::Candidate(target) = decision else {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: None,
            status: match decision_for_result {
                ActivationDecision::Blocked(_) => "blocked".to_string(),
                ActivationDecision::Unsupported(_) => "unsupported".to_string(),
                ActivationDecision::Observe => "observed".to_string(),
                ActivationDecision::Candidate(_) => unreachable!(),
            },
            reason: Some(match decision_for_result {
                ActivationDecision::Blocked(reason) | ActivationDecision::Unsupported(reason) => {
                    reason.to_string()
                }
                ActivationDecision::Observe => "target_not_zero".to_string(),
                ActivationDecision::Candidate(_) => unreachable!(),
            }),
            quota: Some(quota),
        });
    };
    let model_capability =
        crate::services::codex_oauth_models::activation_model_capability_with_token(
            &token, &workspace,
        )
        .await;
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let model_reason: Option<(&str, String)> = match model_capability {
        Ok(crate::services::codex_oauth_models::ActivationModelCapability::Supported) => None,
        Ok(crate::services::codex_oauth_models::ActivationModelCapability::ModelUnavailable) => {
            Some(("model_unavailable", "gpt-6-luna_not_in_catalog".to_string()))
        }
        Ok(crate::services::codex_oauth_models::ActivationModelCapability::LowUnavailable) => {
            Some((
                "model_unavailable",
                "gpt-6-luna_low_unavailable".to_string(),
            ))
        }
        Ok(crate::services::codex_oauth_models::ActivationModelCapability::CatalogInvalid) => {
            Some((
                "protocol_unknown",
                "model_catalog_capability_invalid".to_string(),
            ))
        }
        Err(reason) => Some(("model_preflight_failed", reason)),
    };
    if let Some((status, reason)) = model_reason {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: Some(target.as_str().to_string()),
            status: status.to_string(),
            reason: Some(reason),
            quota: Some(quota),
        });
    }
    let now_after_model = now_millis();
    if crate::services::codex_quota_activation::snapshot_freshness_reason(
        &snapshot,
        now_after_model,
    )
    .is_some()
    {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: Some(target.as_str().to_string()),
            status: "stale_snapshot".to_string(),
            reason: Some("quota_snapshot_aged_during_model_preflight".to_string()),
            quota: Some(quota),
        });
    }
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let current_interval = derive_activation_interval(&app_state.db, &state.0, &account_id).await?;
    if current_interval != effective_interval_minutes
        || !current_interval.is_some_and(|interval| interval > 0)
    {
        app_state
            .db
            .refresh_codex_quota_activation_interval(&account_id, current_interval, now_millis())
            .map_err(|error| error.to_string())?;
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: Some(target.as_str().to_string()),
            status: "interval_changed".to_string(),
            reason: Some("effective_interval_changed_during_tick".to_string()),
            quota: Some(quota),
        });
    }
    let attempt_id = Uuid::new_v4().to_string();
    let claim_time = now_millis();
    if app_state
        .db
        .claim_codex_quota_activation_if_revision(
            &account_id,
            authorization_revision,
            &attempt_id,
            claim_time,
        )
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Ok(CodexQuotaActivationPollResult {
            account_id,
            polled: true,
            attempted: false,
            target: Some(target.as_str().to_string()),
            status: "claim_lost".to_string(),
            reason: Some("another automatic tick claimed the event".to_string()),
            quota: Some(quota),
        });
    }
    if !activation_revision_is_current(&app_state.db, &account_id, authorization_revision)? {
        return Ok(disabled_poll(account_id, "authorization_changed"));
    }
    let client = match crate::proxy::http_client::get_for_single_post() {
        Ok(client) => client,
        Err(error) => {
            let _ = app_state
                .db
                .finish_codex_quota_activation_attempt_if_revision(
                    &account_id,
                    authorization_revision,
                    &attempt_id,
                    "unknown",
                    Some(&error),
                    now_millis(),
                );
            return Ok(failed_poll(account_id, "transport_unavailable", error));
        }
    };
    let result = send_activation_once(&client, ACTIVATION_ENDPOINT, &token, &workspace).await;
    let status = match result.status {
        ActivationHttpStatus::Completed => "completed",
        ActivationHttpStatus::Failed => "failed",
        ActivationHttpStatus::Unknown => "unknown",
    };
    app_state
        .db
        .finish_codex_quota_activation_attempt_if_revision(
            &account_id,
            authorization_revision,
            &attempt_id,
            status,
            result.error.as_deref(),
            chrono::Utc::now().timestamp_millis(),
        )
        .map_err(|error| error.to_string())?;
    Ok(CodexQuotaActivationPollResult {
        account_id,
        polled: true,
        attempted: true,
        target: Some(target.as_str().to_string()),
        status: status.to_string(),
        reason: result.error,
        quota: Some(quota),
    })
}

fn failed_poll(account_id: String, status: &str, reason: String) -> CodexQuotaActivationPollResult {
    CodexQuotaActivationPollResult {
        account_id,
        polled: true,
        attempted: false,
        target: None,
        status: status.to_string(),
        reason: Some(reason.chars().take(256).collect()),
        quota: None,
    }
}

fn disabled_poll(account_id: String, reason: &str) -> CodexQuotaActivationPollResult {
    CodexQuotaActivationPollResult {
        account_id,
        polled: true,
        attempted: false,
        target: None,
        status: "disabled".to_string(),
        reason: Some(reason.to_string()),
        quota: None,
    }
}

fn activation_revision_is_current(
    db: &crate::database::Database,
    account_id: &str,
    expected_revision: i64,
) -> Result<bool, String> {
    Ok(db
        .codex_quota_activation_revision(account_id)
        .map_err(|error| error.to_string())?
        .is_some_and(|(enabled, revision)| enabled && revision == expected_revision))
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn derive_activation_interval(
    db: &crate::database::Database,
    manager: &CodexOAuthManager,
    account_id: &str,
) -> Result<Option<u64>, String> {
    let _ = manager;
    db.derive_codex_quota_activation_interval(account_id, None)
        .map_err(|error| error.to_string())
}
