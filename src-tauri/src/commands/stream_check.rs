//! 流式健康检查命令

use crate::app_config::AppType;
use crate::commands::copilot::CopilotAuthState;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::stream_check::{
    HealthStatus, StreamCheckConfig, StreamCheckResult, StreamCheckService,
};
use crate::store::AppState;
use std::collections::HashSet;
use tauri::State;

/// 流式健康检查（单个供应商）
#[tauri::command]
pub async fn stream_check_provider(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    provider_id: String,
) -> Result<StreamCheckResult, AppError> {
    let config = state.db.get_stream_check_config()?;

    let providers = state.db.get_all_providers(app_type.as_str())?;
    let provider = providers
        .get(&provider_id)
        .ok_or_else(|| AppError::Message(format!("供应商 {provider_id} 不存在")))?;

    let result = check_provider_with_model_router_targets(
        state.db.as_ref(),
        &copilot_state,
        &app_type,
        provider,
        &config,
    )
    .await?;

    // 记录日志
    let _ =
        state
            .db
            .save_stream_check_log(&provider_id, &provider.name, app_type.as_str(), &result);

    Ok(result)
}

/// 批量流式健康检查
#[tauri::command]
pub async fn stream_check_all_providers(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    proxy_targets_only: bool,
) -> Result<Vec<(String, StreamCheckResult)>, AppError> {
    let config = state.db.get_stream_check_config()?;
    let providers = state.db.get_all_providers(app_type.as_str())?;

    let mut results = Vec::new();
    let allowed_ids: Option<HashSet<String>> = if proxy_targets_only {
        let mut ids = HashSet::new();
        if let Ok(Some(current_id)) = state.db.get_current_provider(app_type.as_str()) {
            ids.insert(current_id);
        }
        if let Ok(queue) = state.db.get_failover_queue(app_type.as_str()) {
            for item in queue {
                ids.insert(item.provider_id);
            }
        }
        Some(ids)
    } else {
        None
    };

    for (id, provider) in providers {
        if let Some(ids) = &allowed_ids {
            if !ids.contains(&id) {
                continue;
            }
        }

        let result = check_provider_with_model_router_targets(
            state.db.as_ref(),
            &copilot_state,
            &app_type,
            &provider,
            &config,
        )
        .await
        .unwrap_or_else(|e| {
            let (http_status, message) = match &e {
                crate::error::AppError::HttpStatus { status, .. } => (
                    Some(*status),
                    StreamCheckService::classify_http_status(*status).to_string(),
                ),
                _ => (None, e.to_string()),
            };
            StreamCheckResult {
                status: HealthStatus::Failed,
                success: false,
                message,
                response_time_ms: None,
                http_status,
                model_used: String::new(),
                tested_at: chrono::Utc::now().timestamp(),
                retry_count: 0,
                error_category: None,
            }
        });

        let _ = state
            .db
            .save_stream_check_log(&id, &provider.name, app_type.as_str(), &result);

        results.push((id, result));
    }

    Ok(results)
}

/// 获取流式检查配置
#[tauri::command]
pub fn get_stream_check_config(state: State<'_, AppState>) -> Result<StreamCheckConfig, AppError> {
    state.db.get_stream_check_config()
}

/// 保存流式检查配置
#[tauri::command]
pub fn save_stream_check_config(
    state: State<'_, AppState>,
    config: StreamCheckConfig,
) -> Result<(), AppError> {
    state.db.save_stream_check_config(&config)
}

fn resolve_model_router_targets_for_check(
    db: &Database,
    app_type: &AppType,
    provider: &Provider,
    config: &StreamCheckConfig,
) -> Result<Vec<Provider>, AppError> {
    if !provider.is_model_router() {
        return Ok(vec![provider.clone()]);
    }

    let request_model = resolve_model_router_test_model(provider)
        .unwrap_or_else(|| StreamCheckService::resolve_effective_test_model(app_type, provider, config));
    crate::proxy::model_router::resolve_provider_chain(
        db,
        app_type.as_str(),
        provider,
        &request_model,
    )
}

fn resolve_model_router_test_model(provider: &Provider) -> Option<String> {
    let config = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.model_router.as_ref())?;

    for route in &config.routes {
        match route.match_type {
            crate::provider::ModelRouterMatchType::Exact => {
                if let Some(match_value) = route.match_value.as_deref() {
                    let match_value = match_value.trim();
                    if !match_value.is_empty() {
                        return Some(match_value.to_string());
                    }
                }
            }
            crate::provider::ModelRouterMatchType::Role => match route
                .match_value
                .as_deref()
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("haiku") => return Some("claude-haiku-4-5".to_string()),
                Some("sonnet") => return Some("claude-sonnet-4-6".to_string()),
                Some("opus") => return Some("claude-opus-4-8".to_string()),
                _ => {}
            },
            crate::provider::ModelRouterMatchType::Default => {
                return Some("cc-switch-default".to_string());
            }
        }
    }

    None
}

async fn check_provider_with_model_router_targets(
    db: &Database,
    copilot_state: &State<'_, CopilotAuthState>,
    app_type: &AppType,
    provider: &Provider,
    config: &StreamCheckConfig,
) -> Result<StreamCheckResult, AppError> {
    if !provider.is_model_router() {
        let auth_override = resolve_copilot_auth_override(provider, copilot_state).await?;
        let base_url_override = resolve_copilot_base_url_override(provider, copilot_state).await?;
        let claude_api_format_override = resolve_claude_api_format_override(
            app_type,
            provider,
            config,
            copilot_state,
            auth_override.as_ref(),
        )
        .await?;

        return StreamCheckService::check_with_retry(
            app_type,
            provider,
            config,
            auth_override,
            base_url_override,
            claude_api_format_override,
        )
        .await;
    }

    let targets = resolve_model_router_targets_for_check(db, app_type, provider, config)?;
    let max_targets = targets.len().saturating_sub(1) as u32;
    let mut last_error: Option<AppError> = None;
    let mut last_result: Option<StreamCheckResult> = None;

    for (index, target) in targets.iter().enumerate() {
        let auth_override = resolve_copilot_auth_override(target, copilot_state).await?;
        let base_url_override = resolve_copilot_base_url_override(target, copilot_state).await?;
        let claude_api_format_override = resolve_claude_api_format_override(
            app_type,
            target,
            config,
            copilot_state,
            auth_override.as_ref(),
        )
        .await?;

        match StreamCheckService::check_with_retry(
            app_type,
            target,
            config,
            auth_override,
            base_url_override,
            claude_api_format_override,
        )
        .await
        {
            Ok(result) if result.success => {
                return Ok(StreamCheckResult {
                    retry_count: index as u32,
                    ..result
                });
            }
            Ok(result) => {
                last_result = Some(StreamCheckResult {
                    retry_count: index as u32,
                    ..result
                });
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    if let Some(result) = last_result {
        return Ok(StreamCheckResult {
            retry_count: result.retry_count.min(max_targets),
            ..result
        });
    }

    Err(last_error.unwrap_or_else(|| AppError::NoProvidersConfigured))
}

async fn resolve_copilot_auth_override(
    provider: &crate::provider::Provider,
    copilot_state: &State<'_, CopilotAuthState>,
) -> Result<Option<crate::proxy::providers::AuthInfo>, AppError> {
    let is_copilot = is_copilot_provider(provider);

    if !is_copilot {
        return Ok(None);
    }

    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let token = match account_id.as_deref() {
        Some(id) => auth_manager
            .get_valid_token_for_account(id)
            .await
            .map_err(|e| AppError::Message(format!("GitHub Copilot 认证失败: {e}")))?,
        None => auth_manager
            .get_valid_token()
            .await
            .map_err(|e| AppError::Message(format!("GitHub Copilot 认证失败: {e}")))?,
    };

    Ok(Some(crate::proxy::providers::AuthInfo::new(
        token,
        crate::proxy::providers::AuthStrategy::GitHubCopilot,
    )))
}

async fn resolve_copilot_base_url_override(
    provider: &crate::provider::Provider,
    copilot_state: &State<'_, CopilotAuthState>,
) -> Result<Option<String>, AppError> {
    let is_copilot = is_copilot_provider(provider);
    let is_full_url = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.is_full_url)
        .unwrap_or(false);

    if !is_copilot || is_full_url {
        return Ok(None);
    }

    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let endpoint = match account_id.as_deref() {
        Some(id) => auth_manager.get_api_endpoint(id).await,
        None => auth_manager.get_default_api_endpoint().await,
    };

    Ok(Some(endpoint))
}

fn is_copilot_provider(provider: &crate::provider::Provider) -> bool {
    provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        == Some("github_copilot")
        || provider
            .settings_config
            .pointer("/env/ANTHROPIC_BASE_URL")
            .and_then(|value| value.as_str())
            .map(|url| url.contains("githubcopilot.com"))
            .unwrap_or(false)
}

async fn resolve_claude_api_format_override(
    app_type: &AppType,
    provider: &crate::provider::Provider,
    config: &StreamCheckConfig,
    copilot_state: &State<'_, CopilotAuthState>,
    auth_override: Option<&crate::proxy::providers::AuthInfo>,
) -> Result<Option<String>, AppError> {
    if *app_type != AppType::Claude {
        return Ok(None);
    }

    let is_copilot = auth_override
        .map(|auth| auth.strategy == crate::proxy::providers::AuthStrategy::GitHubCopilot)
        .unwrap_or(false);
    if !is_copilot {
        return Ok(None);
    }

    let model_id = StreamCheckService::resolve_effective_test_model(app_type, provider, config);
    let auth_manager = copilot_state.0.read().await;
    let account_id = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.managed_account_id_for("github_copilot"));

    let vendor_result = match account_id.as_deref() {
        Some(id) => {
            auth_manager
                .get_model_vendor_for_account(id, &model_id)
                .await
        }
        None => auth_manager.get_model_vendor(&model_id).await,
    };

    let api_format = match vendor_result {
        Ok(Some(vendor)) if vendor.eq_ignore_ascii_case("openai") => "openai_responses",
        Ok(Some(_)) | Ok(None) => "openai_chat",
        Err(err) => {
            log::warn!(
                "[StreamCheck] Failed to resolve Copilot model vendor for {model_id}: {err}. Falling back to chat/completions"
            );
            "openai_chat"
        }
    };

    Ok(Some(api_format.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        is_copilot_provider, resolve_model_router_targets_for_check, resolve_model_router_test_model,
    };
    use crate::app_config::AppType;
    use crate::database::Database;
    use crate::provider::{
        ModelRouterConfig, ModelRouterMatchType, ModelRouterProviderRef, ModelRouterRule, Provider,
        ProviderMeta,
    };
    use crate::services::stream_check::StreamCheckConfig;
    use serde_json::json;

    #[test]
    fn model_router_stream_check_uses_client_route_model() {
        let mut provider = Provider::with_id(
            "router".to_string(),
            "Router".to_string(),
            json!({ "env": {} }),
            None,
        );
        provider.meta = Some(ProviderMeta {
            provider_type: Some("model_router".to_string()),
            model_router: Some(ModelRouterConfig {
                routes: vec![ModelRouterRule {
                    match_type: ModelRouterMatchType::Role,
                    match_value: Some("opus".to_string()),
                    target: None,
                    provider_chain: Vec::new(),
                    fallbacks: Vec::new(),
                }],
                ..Default::default()
            }),
            ..Default::default()
        });

        assert_eq!(
            resolve_model_router_test_model(&provider).as_deref(),
            Some("claude-opus-4-8")
        );
    }

    #[test]
    fn model_router_stream_check_resolves_target_provider_with_upstream_model() {
        let db = Database::memory().expect("memory database");
        let target = Provider::with_id(
            "target".to_string(),
            "Target".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.example.com",
                    "ANTHROPIC_AUTH_TOKEN": "token",
                    "ANTHROPIC_MODEL": "configured-model"
                }
            }),
            None,
        );
        db.save_provider(AppType::Claude.as_str(), &target)
            .expect("save target provider");

        let mut router = Provider::with_id(
            "router".to_string(),
            "Router".to_string(),
            json!({ "env": {} }),
            None,
        );
        router.meta = Some(ProviderMeta {
            provider_type: Some("model_router".to_string()),
            model_router: Some(ModelRouterConfig {
                routes: vec![ModelRouterRule {
                    match_type: ModelRouterMatchType::Role,
                    match_value: Some("sonnet".to_string()),
                    target: Some(ModelRouterProviderRef {
                        provider_id: "target".to_string(),
                        upstream_model: Some("target-upstream-model".to_string()),
                        label: None,
                    }),
                    provider_chain: Vec::new(),
                    fallbacks: Vec::new(),
                }],
                ..Default::default()
            }),
            ..Default::default()
        });

        let resolved = resolve_model_router_targets_for_check(
            &db,
            &AppType::Claude,
            &router,
            &StreamCheckConfig::default(),
        )
        .expect("router should resolve to target provider");

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "target");
        assert_eq!(
            resolved[0]
                .meta
                .as_ref()
                .and_then(|meta| meta.runtime_upstream_model.as_deref()),
            Some("target-upstream-model")
        );
    }

    #[test]
    fn copilot_provider_detection_accepts_provider_type_or_base_url() {
        let typed_provider = Provider {
            id: "p1".to_string(),
            name: "typed".to_string(),
            settings_config: json!({}),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                ..Default::default()
            }),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        assert!(is_copilot_provider(&typed_provider));

        let url_provider = Provider {
            id: "p2".to_string(),
            name: "url".to_string(),
            settings_config: json!({
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.githubcopilot.com"
                }
            }),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        assert!(is_copilot_provider(&url_provider));
    }

    #[test]
    fn copilot_full_url_metadata_is_available_for_override_guard() {
        let provider = Provider {
            id: "p3".to_string(),
            name: "relay".to_string(),
            settings_config: json!({}),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: Some(ProviderMeta {
                provider_type: Some("github_copilot".to_string()),
                is_full_url: Some(true),
                ..Default::default()
            }),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };

        assert!(is_copilot_provider(&provider));
        assert_eq!(
            provider.meta.as_ref().and_then(|meta| meta.is_full_url),
            Some(true)
        );
    }
}
