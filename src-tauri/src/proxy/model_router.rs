//! Model Router runtime for composite providers.
//!
//! V1 only supports referencing existing provider IDs and building a per-request
//! provider chain using `exact > role > default` matching.

use crate::database::Database;
use crate::error::AppError;
use crate::provider::{
    ModelRouterConfig, ModelRouterMatchType, ModelRouterProviderRef, ModelRouterRole, Provider,
    ProviderMeta,
};
use std::collections::HashSet;

pub fn resolve_provider_chain(
    db: &Database,
    app_type: &str,
    router_provider: &Provider,
    request_model: &str,
) -> Result<Vec<Provider>, AppError> {
    if !router_provider.is_model_router() {
        return Ok(vec![router_provider.clone()]);
    }

    let meta = router_provider.meta.as_ref().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "model_router provider '{}' is missing meta",
            router_provider.id
        ))
    })?;
    let mut config = meta.model_router.clone().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "model_router provider '{}' is missing modelRouter config",
            router_provider.id
        ))
    })?;
    config.normalize_managed_routes();

    let rule = select_rule(&config, request_model).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "model_router provider '{}' has no route for model '{}'",
            router_provider.id, request_model
        ))
    })?;

    let mut resolved = Vec::new();
    let mut seen = HashSet::new();

    for provider_ref in rule.normalized_provider_chain() {
        let provider_id = provider_ref.provider_id.trim();
        if provider_id.is_empty() || !seen.insert(provider_id.to_string()) {
            continue;
        }
        if provider_id == router_provider.id {
            continue;
        }

        let Some(mut provider) = db.get_provider_by_id(provider_id, app_type)? else {
            log::warn!(
                "[{app_type}] [MR-001] model_router target provider not found: {}",
                provider_id
            );
            continue;
        };

        if provider.is_model_router() {
            log::warn!(
                "[{app_type}] [MR-002] nested model_router target is not supported in V1: {}",
                provider_id
            );
            continue;
        }

        apply_runtime_upstream_model(&mut provider, &provider_ref);
        resolved.push(provider);
    }

    if resolved.is_empty() {
        return Err(AppError::NoProvidersConfigured);
    }

    Ok(resolved)
}

fn apply_runtime_upstream_model(provider: &mut Provider, provider_ref: &ModelRouterProviderRef) {
    let meta = provider.meta.get_or_insert_with(ProviderMeta::default);
    meta.runtime_upstream_model = provider_ref
        .upstream_model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
}

fn select_rule<'a>(
    config: &'a ModelRouterConfig,
    request_model: &str,
) -> Option<&'a crate::provider::ModelRouterRule> {
    let normalized_model = normalize(request_model);
    let request_role = detect_role(&normalized_model);

    config
        .routes
        .iter()
        .find(|rule| match rule.match_type {
            ModelRouterMatchType::Exact => rule
                .match_value
                .as_deref()
                .map(normalize)
                .is_some_and(|value| value == normalized_model),
            _ => false,
        })
        .or_else(|| {
            config.routes.iter().find(|rule| match rule.match_type {
                ModelRouterMatchType::Role => rule
                    .match_value
                    .as_deref()
                    .map(parse_role)
                    .is_some_and(|role| role == request_role),
                _ => false,
            })
        })
        .or_else(|| {
            config
                .routes
                .iter()
                .find(|rule| matches!(rule.match_type, ModelRouterMatchType::Default))
        })
}

fn normalize(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn parse_role(value: &str) -> ModelRouterRole {
    match normalize(value).as_str() {
        "opus" => ModelRouterRole::Opus,
        "sonnet" => ModelRouterRole::Sonnet,
        "haiku" => ModelRouterRole::Haiku,
        _ => ModelRouterRole::Default,
    }
}

fn detect_role(normalized_model: &str) -> ModelRouterRole {
    if normalized_model.contains("opus") {
        ModelRouterRole::Opus
    } else if normalized_model.contains("sonnet") {
        ModelRouterRole::Sonnet
    } else if normalized_model.contains("haiku") {
        ModelRouterRole::Haiku
    } else {
        ModelRouterRole::Default
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{ModelRouterRule, ProviderMeta};
    use serde_json::json;

    fn provider_with_id(id: &str) -> Provider {
        Provider::with_id(id.to_string(), id.to_string(), json!({ "env": {} }), None)
    }

    fn router_with_routes(routes: Vec<ModelRouterRule>) -> Provider {
        let mut provider = provider_with_id("router");
        provider.meta = Some(ProviderMeta {
            provider_type: Some("model_router".to_string()),
            model_router: Some(ModelRouterConfig {
                routes,
                ..Default::default()
            }),
            ..Default::default()
        });
        provider
    }

    fn target(provider_id: &str, upstream_model: Option<&str>) -> ModelRouterProviderRef {
        ModelRouterProviderRef {
            provider_id: provider_id.to_string(),
            upstream_model: upstream_model.map(|value| value.to_string()),
            label: None,
        }
    }

    #[test]
    fn exact_rule_has_priority_over_role() {
        let config = ModelRouterConfig {
            routes: vec![
                ModelRouterRule {
                    id: None,
                    match_type: ModelRouterMatchType::Role,
                    match_value: Some("sonnet".to_string()),
                    target: Some(target("role", None)),
                    provider_chain: Vec::new(),
                    fallbacks: Vec::new(),
                },
                ModelRouterRule {
                    id: None,
                    match_type: ModelRouterMatchType::Exact,
                    match_value: Some("claude-sonnet-4-6".to_string()),
                    target: Some(target("exact", None)),
                    provider_chain: Vec::new(),
                    fallbacks: Vec::new(),
                },
            ],
            ..Default::default()
        };

        let rule = select_rule(&config, "claude-sonnet-4-6").expect("rule");
        assert!(matches!(rule.match_type, ModelRouterMatchType::Exact));
    }

    #[test]
    fn detects_default_role_when_no_keyword_exists() {
        assert_eq!(detect_role("gpt-5.4"), ModelRouterRole::Default);
        assert_eq!(parse_role("default"), ModelRouterRole::Default);
    }

    #[test]
    fn resolve_provider_chain_applies_runtime_model_and_fallbacks() {
        let db = Database::memory().expect("memory db");
        let provider_a = provider_with_id("a");
        let provider_b = provider_with_id("b");
        db.save_provider("claude", &provider_a).expect("save a");
        db.save_provider("claude", &provider_b).expect("save b");

        let router = router_with_routes(vec![ModelRouterRule {
            id: None,
            match_type: ModelRouterMatchType::Role,
            match_value: Some("sonnet".to_string()),
            target: Some(target("a", Some("gpt-5.4"))),
            provider_chain: Vec::new(),
            fallbacks: vec![target("b", Some("gpt-5.4-mini"))],
        }]);

        let resolved =
            resolve_provider_chain(&db, "claude", &router, "claude-sonnet-4-6").expect("resolved");

        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].id, "a");
        assert_eq!(
            resolved[0]
                .meta
                .as_ref()
                .and_then(|meta| meta.runtime_upstream_model.as_deref()),
            Some("gpt-5.4")
        );
        assert_eq!(resolved[1].id, "b");
        assert_eq!(
            resolved[1]
                .meta
                .as_ref()
                .and_then(|meta| meta.runtime_upstream_model.as_deref()),
            Some("gpt-5.4-mini")
        );
    }

    #[test]
    fn resolve_provider_chain_skips_missing_and_nested_router_targets() {
        let db = Database::memory().expect("memory db");
        let provider_a = provider_with_id("a");
        let mut nested = provider_with_id("nested");
        nested.meta = Some(ProviderMeta {
            provider_type: Some("model_router".to_string()),
            ..Default::default()
        });
        db.save_provider("claude", &provider_a).expect("save a");
        db.save_provider("claude", &nested).expect("save nested");

        let router = router_with_routes(vec![ModelRouterRule {
            id: None,
            match_type: ModelRouterMatchType::Default,
            match_value: None,
            target: Some(target("missing", None)),
            provider_chain: vec![target("nested", None), target("a", None)],
            fallbacks: Vec::new(),
        }]);

        let resolved = resolve_provider_chain(&db, "claude", &router, "unknown").expect("resolved");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "a");
    }
}
