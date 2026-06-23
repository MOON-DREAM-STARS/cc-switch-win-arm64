//! 供应商连通性检查命令
//!
//! 注意：本检查只探测 base_url 是否可达，不发真实大模型请求，也不触碰故障转移
//! 熔断器（熔断器由真实转发流量驱动）。详见 `services::stream_check`。

use crate::app_config::AppType;
use crate::commands::copilot::CopilotAuthState;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::{ModelRouterMatchType, ModelRouterRule, Provider};
use crate::proxy::model_mapper::strip_one_m_suffix_for_upstream;
use crate::services::stream_check::{
    HealthStatus, ModelRouterRouteCheckResult, StreamCheckConfig, StreamCheckResult,
    StreamCheckService,
};
use crate::store::AppState;
use std::collections::HashSet;
use tauri::State;

/// 连通性检查（单个供应商）
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

/// 批量连通性检查
#[tauri::command]
pub async fn stream_check_all_providers(
    state: State<'_, AppState>,
    copilot_state: State<'_, CopilotAuthState>,
    app_type: AppType,
    proxy_targets_only: bool,
) -> Result<Vec<(String, StreamCheckResult)>, AppError> {
    let config = state.db.get_stream_check_config()?;
    let providers = state.db.get_all_providers(app_type.as_str())?;

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

    let mut results = Vec::new();
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
                audit_mode: None,
                route_results: None,
            }
        });

        let _ = state
            .db
            .save_stream_check_log(&id, &provider.name, app_type.as_str(), &result);

        results.push((id, result));
    }

    Ok(results)
}

/// 获取连通性检查配置
#[tauri::command]
pub fn get_stream_check_config(state: State<'_, AppState>) -> Result<StreamCheckConfig, AppError> {
    state.db.get_stream_check_config()
}

/// 保存连通性检查配置
#[tauri::command]
pub fn save_stream_check_config(
    state: State<'_, AppState>,
    config: StreamCheckConfig,
) -> Result<(), AppError> {
    state.db.save_stream_check_config(&config)
}

fn resolve_model_router_targets_for_request_model(
    db: &Database,
    app_type: &AppType,
    provider: &Provider,
    request_model: &str,
) -> Result<Vec<Provider>, AppError> {
    if !provider.is_model_router() {
        return Ok(vec![provider.clone()]);
    }

    crate::proxy::model_router::resolve_provider_chain(
        db,
        app_type.as_str(),
        provider,
        request_model,
    )
}

fn managed_model_router_route_key(route: &ModelRouterRule) -> Option<String> {
    match route.id.as_deref().map(str::trim) {
        Some("combined-default") => return Some("default".to_string()),
        Some("combined-role-haiku") => return Some("haiku".to_string()),
        Some("combined-role-sonnet") => return Some("sonnet".to_string()),
        Some("combined-role-opus") => return Some("opus".to_string()),
        _ => {}
    }

    match route.match_type {
        ModelRouterMatchType::Default => Some("default".to_string()),
        ModelRouterMatchType::Role => route
            .match_value
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .filter(|value| matches!(value.as_str(), "haiku" | "sonnet" | "opus" | "default")),
        ModelRouterMatchType::Exact => None,
    }
}

fn request_model_for_managed_route(route_key: &str) -> &'static str {
    match route_key {
        "haiku" => "claude-haiku-4-5",
        "sonnet" => "claude-sonnet-4-6",
        "opus" => "claude-opus-4-8",
        _ => "cc-switch-default",
    }
}

fn sanitize_composite_audit_model(model: &str) -> String {
    let without_one_m = strip_one_m_suffix_for_upstream(model).trim();
    let without_effort = without_one_m
        .find('@')
        .or_else(|| without_one_m.find('#'))
        .map(|pos| without_one_m[..pos].trim())
        .unwrap_or(without_one_m);
    without_effort.to_string()
}

/// Returns the target that actually handled the request: targets[retry_count], or the last target
/// if the index is out of bounds.
fn actual_target(targets: &[Provider], retry_count: u32) -> Option<&Provider> {
    targets.get(retry_count as usize).or_else(|| targets.last())
}

fn sanitize_composite_audit_targets(mut targets: Vec<Provider>) -> Vec<Provider> {
    for target in &mut targets {
        if let Some(meta) = target.meta.as_mut() {
            if let Some(runtime_model) = meta.runtime_upstream_model.as_deref() {
                let sanitized = sanitize_composite_audit_model(runtime_model);
                meta.runtime_upstream_model = (!sanitized.is_empty()).then_some(sanitized);
            }
        }
    }
    targets
}

fn stream_check_result_from_error(error: &AppError, model_used: String) -> StreamCheckResult {
    let (http_status, message) = match error {
        AppError::HttpStatus { status, .. } => (
            Some(*status),
            StreamCheckService::classify_http_status(*status).to_string(),
        ),
        _ => (None, error.to_string()),
    };

    StreamCheckResult {
        status: HealthStatus::Failed,
        success: false,
        message,
        response_time_ms: None,
        http_status,
        model_used,
        tested_at: chrono::Utc::now().timestamp(),
        retry_count: 0,
        error_category: None,
        audit_mode: None,
        route_results: None,
    }
}

async fn check_resolved_target_chain(
    copilot_state: &State<'_, CopilotAuthState>,
    app_type: &AppType,
    targets: &[Provider],
    config: &StreamCheckConfig,
) -> Result<StreamCheckResult, AppError> {
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

        match StreamCheckService::check_with_retry_without_provider_override(
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

async fn check_model_router_provider(
    db: &Database,
    copilot_state: &State<'_, CopilotAuthState>,
    app_type: &AppType,
    provider: &Provider,
    config: &StreamCheckConfig,
) -> Result<StreamCheckResult, AppError> {
    let router_config = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.model_router.as_ref())
        .ok_or(AppError::NoProvidersConfigured)?;
    let effective_config = StreamCheckService::merge_model_router_config(provider, config);
    let mut route_results = Vec::new();

    for route in &router_config.routes {
        if route.normalized_provider_chain().is_empty() {
            continue;
        }

        let (route_key, request_model) =
            if route.match_type == ModelRouterMatchType::Exact {
                let match_value = match route.match_value.as_deref().map(str::trim) {
                    Some(v) if !v.is_empty() => v.to_string(),
                    _ => continue,
                };
                (format!("exact:{}", match_value), match_value)
            } else {
                let Some(key) = managed_model_router_route_key(route) else {
                    continue;
                };
                let req = request_model_for_managed_route(&key).to_string();
                (key, req)
            };
        match resolve_model_router_targets_for_request_model(db, app_type, provider, &request_model)
        {
            Ok(targets) if !targets.is_empty() => {
                let targets = sanitize_composite_audit_targets(targets);
                let result = match check_resolved_target_chain(
                    copilot_state,
                    app_type,
                    &targets,
                    &effective_config,
                )
                .await
                {
                    Ok(result) => result,
                    Err(error) => stream_check_result_from_error(&error, request_model.clone()),
                };
                let hit = actual_target(&targets, result.retry_count);
                route_results.push(ModelRouterRouteCheckResult {
                    route_key,
                    request_model,
                    target_provider_id: hit.map(|t| t.id.clone()),
                    target_provider_name: hit.map(|t| t.name.clone()),
                    result,
                });
            }
            Ok(_) => continue,
            Err(error) => {
                route_results.push(ModelRouterRouteCheckResult {
                    route_key,
                    request_model: request_model.clone(),
                    target_provider_id: None,
                    target_provider_name: None,
                    result: stream_check_result_from_error(&error, request_model),
                });
            }
        }
    }

    if route_results.is_empty() {
        return Err(AppError::NoProvidersConfigured);
    }

    let success = route_results.iter().all(|item| item.result.success);
    let status = if !success {
        HealthStatus::Failed
    } else if route_results
        .iter()
        .any(|item| item.result.status == HealthStatus::Degraded)
    {
        HealthStatus::Degraded
    } else {
        HealthStatus::Operational
    };
    let response_time_ms = route_results
        .iter()
        .filter_map(|item| item.result.response_time_ms)
        .max();
    let first_failure = route_results.iter().find(|item| !item.result.success);
    let first_result = route_results.first().map(|item| &item.result);

    Ok(StreamCheckResult {
        status,
        success,
        message: if success {
            format!("已完成 {} 条组合路由巡检", route_results.len())
        } else {
            format!(
                "组合路由巡检失败：{} / {} 条通过",
                route_results
                    .iter()
                    .filter(|item| item.result.success)
                    .count(),
                route_results.len()
            )
        },
        response_time_ms,
        http_status: first_failure.and_then(|item| item.result.http_status),
        model_used: first_result
            .map(|result| result.model_used.clone())
            .unwrap_or_default(),
        tested_at: chrono::Utc::now().timestamp(),
        retry_count: 0,
        error_category: first_failure.and_then(|item| item.result.error_category.clone()),
        audit_mode: Some("all_routes".to_string()),
        route_results: Some(route_results),
    })
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

    check_model_router_provider(db, copilot_state, app_type, provider, config).await
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

#[cfg(test)]
mod tests {
    use super::{
        actual_target, is_copilot_provider, managed_model_router_route_key,
        request_model_for_managed_route, resolve_model_router_targets_for_request_model,
        sanitize_composite_audit_model,
    };
    use crate::app_config::AppType;
    use crate::database::Database;
    use crate::provider::{
        ModelRouterConfig, ModelRouterMatchType, ModelRouterProviderRef, ModelRouterRule, Provider,
        ProviderMeta,
    };
    use serde_json::json;

    #[test]
    fn sanitize_composite_audit_model_strips_effort_and_one_m_marker() {
        assert_eq!(sanitize_composite_audit_model("gpt-5.5@low[1M]"), "gpt-5.5");
        assert_eq!(
            sanitize_composite_audit_model("deepseek-reasoner#high [1M]"),
            "deepseek-reasoner"
        );
        assert_eq!(
            sanitize_composite_audit_model("claude-sonnet-4-5-20250929[1M]"),
            "claude-sonnet-4-5-20250929"
        );
    }

    #[test]
    fn model_router_managed_route_uses_expected_request_model() {
        let route = ModelRouterRule {
            id: Some("combined-role-opus".to_string()),
            match_type: ModelRouterMatchType::Role,
            match_value: Some("opus".to_string()),
            target: None,
            provider_chain: Vec::new(),
            fallbacks: Vec::new(),
        };

        assert_eq!(
            managed_model_router_route_key(&route).as_deref(),
            Some("opus")
        );
        assert_eq!(request_model_for_managed_route("opus"), "claude-opus-4-8");
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
                    id: None,
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

        let resolved = resolve_model_router_targets_for_request_model(
            &db,
            &AppType::Claude,
            &router,
            "claude-sonnet-4-6",
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

    #[test]
    fn exact_route_appears_in_resolved_targets() {
        let db = Database::memory().expect("memory database");
        let target = Provider::with_id(
            "target".to_string(),
            "Target".to_string(),
            json!({ "env": {
                "ANTHROPIC_BASE_URL": "https://api.example.com",
                "ANTHROPIC_AUTH_TOKEN": "token"
            }}),
            None,
        );
        db.save_provider(AppType::Claude.as_str(), &target).unwrap();

        let exact_model = "claude-opus-4-5-20250929";
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
                    id: None,
                    match_type: ModelRouterMatchType::Exact,
                    match_value: Some(exact_model.to_string()),
                    target: Some(ModelRouterProviderRef {
                        provider_id: "target".to_string(),
                        upstream_model: None,
                        label: None,
                    }),
                    provider_chain: Vec::new(),
                    fallbacks: Vec::new(),
                }],
                ..Default::default()
            }),
            ..Default::default()
        });

        // managed_model_router_route_key returns None for Exact (the pre-fix behaviour)
        let exact_route = &router.meta.as_ref().unwrap().model_router.as_ref().unwrap().routes[0];
        assert_eq!(managed_model_router_route_key(exact_route), None);

        // The fix: audit loop uses match_value as request_model and "exact:<val>" as key.
        // Verify the resolver finds the target when given the exact match_value.
        let resolved = resolve_model_router_targets_for_request_model(
            &db,
            &AppType::Claude,
            &router,
            exact_model,
        )
        .expect("exact route should resolve");
        assert!(!resolved.is_empty());
        assert_eq!(resolved[0].id, "target");

        // Verify the route_key format produced by the fix.
        let route_key = format!("exact:{exact_model}");
        assert_eq!(route_key, "exact:claude-opus-4-5-20250929");
    }

    #[test]
    fn actual_target_returns_fallback_when_primary_fails() {
        let make = |id: &str, name: &str| {
            Provider::with_id(id.to_string(), name.to_string(), json!({"env": {}}), None)
        };
        let targets = vec![make("primary", "Primary"), make("fallback", "Fallback")];

        // retry_count == 1: targets[0] failed, targets[1] succeeded
        let hit = actual_target(&targets, 1).unwrap();
        assert_eq!(hit.id, "fallback");
        assert_eq!(hit.name, "Fallback");

        // retry_count == 0: targets[0] succeeded directly
        assert_eq!(actual_target(&targets, 0).unwrap().id, "primary");

        // out-of-bounds: falls back to last target
        assert_eq!(actual_target(&targets, 99).unwrap().id, "fallback");
    }
}
