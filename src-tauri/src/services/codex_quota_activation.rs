//! Pure, account-scoped rules for Codex quota activation.
//!
//! This module intentionally has no OAuth or provider side effects.  A fresh
//! read-only `/wham/usage` response is converted into a private snapshot,
//! evaluated here, and only an explicit automatic caller may claim an event.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

pub(crate) const FIVE_HOUR_SECONDS: i64 = 18_000;
pub(crate) const WEEKLY_SECONDS: i64 = 604_800;

fn account_locks() -> &'static Mutex<HashMap<String, Arc<AsyncMutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn account_lock(account_id: &str) -> Arc<AsyncMutex<()>> {
    account_locks()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .entry(account_id.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

pub(crate) fn try_lock_account(account_id: &str) -> Option<OwnedMutexGuard<()>> {
    account_lock(account_id).try_lock_owned().ok()
}

pub(crate) async fn lock_account(account_id: &str) -> OwnedMutexGuard<()> {
    account_lock(account_id).lock_owned().await
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotaWindowSnapshot {
    pub limit_id: String,
    pub is_additional: bool,
    pub used_percent: Option<f64>,
    pub limit_window_seconds: Option<i64>,
    pub reset_at: Option<i64>,
    pub reset_after_seconds: Option<i64>,
    pub allowed: Option<bool>,
    pub limit_reached: Option<bool>,
    pub rate_limit_reached_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct CodexQuotaSnapshot {
    pub allowed: Option<bool>,
    pub limit_reached: Option<bool>,
    pub rate_limit_reached_type: Option<String>,
    pub windows: Vec<QuotaWindowSnapshot>,
    pub request_started_at_ms: i64,
    pub observed_at_ms: i64,
    pub server_date_at_ms: Option<i64>,
    pub cache_age_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowKind {
    FiveHour,
    Weekly,
}

impl WindowKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::FiveHour => "five_hour",
            Self::Weekly => "weekly",
        }
    }

    const fn seconds(self) -> i64 {
        match self {
            Self::FiveHour => FIVE_HOUR_SECONDS,
            Self::Weekly => WEEKLY_SECONDS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ActivationDecision {
    Candidate(WindowKind),
    Observe,
    Blocked(&'static str),
    Unsupported(&'static str),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActivationState {
    BootstrapPending,
    TrackingUsage {
        target: WindowKind,
        boundary_reset_at: i64,
    },
    Eligible {
        target: WindowKind,
        event_key: String,
    },
    Spent {
        target: WindowKind,
        event_key: String,
        attempt_id: String,
        attempted_at_ms: i64,
    },
    AwaitingBaseline,
}

impl Default for ActivationState {
    fn default() -> Self {
        Self::BootstrapPending
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedAttempt {
    pub attempt_id: String,
    pub target: WindowKind,
}

/// Parse a raw `wham/usage` JSON value without changing the numeric precision.
/// Unknown additional buckets are retained and therefore can be rejected by
/// selection when they collide with a supported duration.
pub(crate) fn snapshot_from_value(
    value: &Value,
    request_started_at_ms: i64,
    observed_at_ms: i64,
) -> Option<CodexQuotaSnapshot> {
    let rate_limit = value
        .get("rate_limit")
        .or_else(|| value.get("rateLimit"))?
        .as_object()?;
    let allowed = value
        .get("allowed")
        .and_then(Value::as_bool)
        .or_else(|| rate_limit.get("allowed").and_then(Value::as_bool));
    let limit_reached = value
        .get("limit_reached")
        .or_else(|| value.get("limitReached"))
        .and_then(Value::as_bool)
        .or_else(|| {
            rate_limit
                .get("limit_reached")
                .or_else(|| rate_limit.get("limitReached"))
                .and_then(Value::as_bool)
        });
    let rate_limit_reached_type = value
        .get("rate_limit_reached_type")
        .or_else(|| value.get("rateLimitReachedType"))
        .or_else(|| rate_limit.get("rate_limit_reached_type"))
        .or_else(|| rate_limit.get("rateLimitReachedType"))
        .and_then(parse_reached_type);

    let mut windows = Vec::new();
    for (key, additional) in [("primary_window", false), ("secondary_window", false)] {
        if let Some(raw) = rate_limit
            .get(key)
            .or_else(|| {
                rate_limit.get(match key {
                    "primary_window" => "primaryWindow",
                    _ => "secondaryWindow",
                })
            })
            .filter(|raw| !raw.is_null())
        {
            windows.push(parse_window(key, raw, additional));
        }
    }
    if let Some(additional) = rate_limit
        .get("additional_rate_limits")
        .or_else(|| rate_limit.get("additionalRateLimits"))
    {
        collect_additional_windows(additional, &mut windows);
    }
    if let Some(additional) = value
        .get("additional_rate_limits")
        .or_else(|| value.get("additionalRateLimits"))
    {
        collect_additional_windows(additional, &mut windows);
    }
    if windows.is_empty() {
        return None;
    }
    Some(CodexQuotaSnapshot {
        allowed,
        limit_reached,
        rate_limit_reached_type,
        windows,
        request_started_at_ms,
        observed_at_ms,
        server_date_at_ms: None,
        cache_age_seconds: None,
    })
}

fn parse_reached_type(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| Some("unknown".to_string())),
        _ => Some("unknown".to_string()),
    }
}

fn number(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        match value {
            Value::Number(n) => n.as_f64(),
            _ => None,
        }
    })
}

fn integer(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| value.get(*key)?.as_i64())
}

fn parse_window(limit_id: &str, value: &Value, is_additional: bool) -> QuotaWindowSnapshot {
    QuotaWindowSnapshot {
        limit_id: value
            .get("limit_id")
            .or_else(|| value.get("limitId"))
            .and_then(Value::as_str)
            .unwrap_or(limit_id)
            .to_string(),
        is_additional,
        used_percent: number(value, &["used_percent", "usedPercent", "percent"]),
        limit_window_seconds: integer(value, &["limit_window_seconds", "limitWindowSeconds"]),
        reset_at: integer(value, &["reset_at", "resetAt"]),
        reset_after_seconds: integer(value, &["reset_after_seconds", "resetAfterSeconds"]),
        allowed: value.get("allowed").and_then(Value::as_bool),
        limit_reached: value
            .get("limit_reached")
            .or_else(|| value.get("limitReached"))
            .and_then(Value::as_bool),
        rate_limit_reached_type: value
            .get("rate_limit_reached_type")
            .or_else(|| value.get("rateLimitReachedType"))
            .and_then(parse_reached_type),
    }
}

fn collect_additional_windows(value: &Value, output: &mut Vec<QuotaWindowSnapshot>) {
    match value {
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_additional_windows(item, output)),
        Value::Object(map) => {
            let has_window_fields = [
                "used_percent",
                "usedPercent",
                "percent",
                "limit_window_seconds",
                "limitWindowSeconds",
            ]
            .iter()
            .any(|key| map.contains_key(*key));
            if has_window_fields {
                output.push(parse_window("additional", value, true));
            } else {
                for (name, item) in map {
                    let before = output.len();
                    collect_additional_windows(item, output);
                    for window in &mut output[before..] {
                        if window.limit_id == "additional" {
                            window.limit_id = name.clone();
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn valid_used(value: Option<f64>) -> bool {
    value.is_some_and(|value| value.is_finite() && (0.0..=100.0).contains(&value))
}

fn blocking_type(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|value| !matches!(value.to_ascii_lowercase().as_str(), "none" | "not_reached"))
}

/// Select the unique target before lifecycle/claim checks. This is deliberately
/// fail-closed for malformed or incomplete window structures.
pub(crate) fn select_target(snapshot: &CodexQuotaSnapshot) -> ActivationDecision {
    if snapshot.cache_age_seconds.is_some_and(|age| age > 0)
        || snapshot
            .observed_at_ms
            .saturating_sub(snapshot.request_started_at_ms)
            > 30_000
    {
        return ActivationDecision::Blocked("stale_snapshot");
    }
    let five = snapshot
        .windows
        .iter()
        .filter(|window| window.limit_window_seconds == Some(FIVE_HOUR_SECONDS))
        .collect::<Vec<_>>();
    let weekly = snapshot
        .windows
        .iter()
        .filter(|window| window.limit_window_seconds == Some(WEEKLY_SECONDS))
        .collect::<Vec<_>>();

    if snapshot.windows.iter().any(|window| {
        !window.is_additional
            && !matches!(
                window.limit_window_seconds,
                Some(FIVE_HOUR_SECONDS | WEEKLY_SECONDS)
            )
    }) || five.len() > 1
        || weekly.len() > 1
        || five.iter().any(|w| w.is_additional)
        || weekly.iter().any(|w| w.is_additional)
    {
        return ActivationDecision::Unsupported("ambiguous_window");
    }
    let five = five.first().copied();
    let weekly = weekly.first().copied();

    // A present but damaged 5h object is not equivalent to no 5h object.
    if five.is_some_and(|window| !valid_used(window.used_percent)) {
        return ActivationDecision::Unsupported("invalid_five_hour");
    }
    if weekly.is_some_and(|window| !valid_used(window.used_percent)) {
        return ActivationDecision::Unsupported("invalid_weekly");
    }

    let (target, target_window, weekly_window): (
        WindowKind,
        &QuotaWindowSnapshot,
        Option<&QuotaWindowSnapshot>,
    ) = if let Some(five) = five {
        let Some(weekly) = weekly else {
            return ActivationDecision::Unsupported("weekly_missing");
        };
        (WindowKind::FiveHour, five, Some(weekly))
    } else {
        let Some(weekly) = weekly else {
            return ActivationDecision::Unsupported("unsupported_window_shape");
        };
        (WindowKind::Weekly, weekly, Some(weekly))
    };

    let weekly_window = weekly_window.expect("weekly window always selected");
    if weekly_window.used_percent == Some(100.0) {
        return ActivationDecision::Blocked("weekly_exhausted");
    }

    let mut allowed_values = vec![snapshot.allowed, target_window.allowed];
    let mut limit_values = vec![snapshot.limit_reached, target_window.limit_reached];
    if target == WindowKind::FiveHour {
        allowed_values.push(weekly_window.allowed);
        limit_values.push(weekly_window.limit_reached);
    }
    if consistent_bool(&allowed_values) != Some(true)
        || consistent_bool(&limit_values) != Some(false)
    {
        return ActivationDecision::Blocked("permission_or_limit");
    }
    if blocking_type(snapshot.rate_limit_reached_type.as_deref())
        || blocking_type(target_window.rate_limit_reached_type.as_deref())
        || (target == WindowKind::FiveHour
            && blocking_type(weekly_window.rate_limit_reached_type.as_deref()))
    {
        return ActivationDecision::Blocked("rate_limit_reached");
    }
    if !valid_timing(target_window, target)
        || (target == WindowKind::FiveHour && !valid_timing(weekly_window, WindowKind::Weekly))
    {
        return ActivationDecision::Unsupported("invalid_window_timing");
    }
    if target_window.used_percent == Some(0.0) {
        ActivationDecision::Candidate(target)
    } else {
        ActivationDecision::Observe
    }
}

fn valid_timing(window: &QuotaWindowSnapshot, kind: WindowKind) -> bool {
    let Some(reset_at) = window.reset_at else {
        return false;
    };
    if reset_at < 0 {
        return false;
    }
    if window
        .reset_after_seconds
        .is_some_and(|after| after < 0 || after > kind.seconds().saturating_add(300))
    {
        return false;
    }
    true
}

fn consistent_bool(values: &[Option<bool>]) -> Option<bool> {
    let mut result = None;
    for value in values.iter().flatten().copied() {
        if result.is_some_and(|previous| previous != value) {
            return None;
        }
        result = Some(value);
    }
    result
}

impl ActivationState {
    pub(crate) fn observe(
        &mut self,
        snapshot: &CodexQuotaSnapshot,
        _now_ms: i64,
    ) -> ActivationDecision {
        let decision = select_target(snapshot);
        let Some(target) = structurally_selected_target(snapshot) else {
            if matches!(self, Self::BootstrapPending) {
                *self = Self::AwaitingBaseline;
            }
            return decision;
        };
        let Some(window) = find_window(snapshot, target) else {
            return ActivationDecision::Unsupported("target_missing");
        };
        let previous_target = match self {
            Self::TrackingUsage { target, .. } | Self::Eligible { target, .. } => Some(*target),
            Self::Spent { .. } => None,
            Self::BootstrapPending | Self::AwaitingBaseline => None,
        };
        if previous_target.is_some_and(|previous| previous != target) {
            *self = Self::AwaitingBaseline;
            return ActivationDecision::Unsupported("window_structure_changed");
        }
        if !valid_used(window.used_percent) {
            return ActivationDecision::Unsupported("invalid_target");
        }
        let can_qualify = matches!(decision, ActivationDecision::Candidate(_));
        let event_key = format!(
            "{}:{}",
            target.as_str(),
            window.reset_at.unwrap_or_default()
        );
        match self {
            Self::BootstrapPending => {
                if window.used_percent == Some(0.0) && can_qualify {
                    *self = Self::Eligible { target, event_key };
                    decision
                } else if let Some(boundary_reset_at) = window.reset_at {
                    *self = Self::TrackingUsage {
                        target,
                        boundary_reset_at,
                    };
                    decision
                } else {
                    *self = Self::AwaitingBaseline;
                    ActivationDecision::Unsupported("missing_window_boundary")
                }
            }
            Self::TrackingUsage {
                target: previous,
                boundary_reset_at,
            } => {
                if window.used_percent.is_some_and(|value| value > 0.0) {
                    if let Some(reset_at) = window.reset_at {
                        *boundary_reset_at = reset_at;
                    }
                    decision
                } else if can_qualify
                    && *previous == target
                    && snapshot.request_started_at_ms / 1000 > *boundary_reset_at
                    && window
                        .reset_at
                        .is_some_and(|reset| reset >= *boundary_reset_at)
                {
                    *self = Self::Eligible { target, event_key };
                    decision
                } else {
                    ActivationDecision::Observe
                }
            }
            Self::Eligible {
                target: previous, ..
            } => {
                if *previous != target {
                    *self = Self::AwaitingBaseline;
                    ActivationDecision::Unsupported("window_structure_changed")
                } else if window.used_percent.is_some_and(|value| value > 0.0) {
                    if let Some(reset_at) = window.reset_at {
                        *self = Self::TrackingUsage {
                            target,
                            boundary_reset_at: reset_at,
                        };
                    } else {
                        *self = Self::AwaitingBaseline;
                    }
                    decision
                } else {
                    decision
                }
            }
            Self::Spent {
                target: previous,
                attempted_at_ms,
                ..
            } => {
                if *previous != target {
                    *self = Self::AwaitingBaseline;
                    return ActivationDecision::Unsupported("window_structure_changed");
                }
                if *previous == target
                    && window.used_percent.is_some_and(|value| value > 0.0)
                    && snapshot.request_started_at_ms > *attempted_at_ms
                    && window
                        .reset_at
                        .is_some_and(|reset| reset * 1000 > *attempted_at_ms)
                {
                    *self = Self::TrackingUsage {
                        target,
                        boundary_reset_at: window.reset_at.unwrap_or_default(),
                    };
                }
                ActivationDecision::Observe
            }
            Self::AwaitingBaseline => {
                if window.used_percent.is_some_and(|value| value > 0.0) {
                    if let Some(reset_at) = window.reset_at {
                        *self = Self::TrackingUsage {
                            target,
                            boundary_reset_at: reset_at,
                        };
                    }
                }
                decision
            }
        }
    }

    pub(crate) fn claim(
        &mut self,
        attempt_id: impl Into<String>,
        attempted_at_ms: i64,
    ) -> Option<ClaimedAttempt> {
        let (target, event_key) = match self {
            Self::Eligible { target, event_key } => (*target, event_key.clone()),
            _ => return None,
        };
        let attempt_id = attempt_id.into();
        *self = Self::Spent {
            target,
            event_key,
            attempt_id: attempt_id.clone(),
            attempted_at_ms,
        };
        Some(ClaimedAttempt { attempt_id, target })
    }
}

fn structurally_selected_target(snapshot: &CodexQuotaSnapshot) -> Option<WindowKind> {
    let five = snapshot
        .windows
        .iter()
        .filter(|window| {
            !window.is_additional && window.limit_window_seconds == Some(FIVE_HOUR_SECONDS)
        })
        .collect::<Vec<_>>();
    let weekly = snapshot
        .windows
        .iter()
        .filter(|window| {
            !window.is_additional && window.limit_window_seconds == Some(WEEKLY_SECONDS)
        })
        .collect::<Vec<_>>();
    if five.len() == 1
        && weekly.len() == 1
        && valid_used(five[0].used_percent)
        && valid_used(weekly[0].used_percent)
    {
        Some(WindowKind::FiveHour)
    } else if five.is_empty() && weekly.len() == 1 && valid_used(weekly[0].used_percent) {
        Some(WindowKind::Weekly)
    } else {
        None
    }
}

fn find_window(snapshot: &CodexQuotaSnapshot, kind: WindowKind) -> Option<&QuotaWindowSnapshot> {
    snapshot
        .windows
        .iter()
        .find(|window| !window.is_additional && window.limit_window_seconds == Some(kind.seconds()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response(five: Option<f64>, weekly: Option<f64>) -> Value {
        let window = |used: Option<f64>, seconds: i64| {
            used.map(|used| json!({"used_percent": used, "limit_window_seconds": seconds, "reset_at": 1_800_018_000, "reset_after_seconds": seconds}))
                .unwrap_or_else(|| json!({"limit_window_seconds": seconds, "reset_at": 1_800_018_000, "reset_after_seconds": seconds}))
        };
        json!({"rate_limit": {"allowed": true, "limit_reached": false, "primary_window": five.map(|_| window(five, FIVE_HOUR_SECONDS)), "secondary_window": weekly.map(|_| window(weekly, WEEKLY_SECONDS))}})
    }

    fn snapshot(five: Option<f64>, weekly: Option<f64>) -> CodexQuotaSnapshot {
        snapshot_from_value(
            &response(five, weekly),
            1_799_999_999_000,
            1_800_000_000_000,
        )
        .unwrap()
    }

    #[test]
    fn strict_zero_preserves_small_nonzero_values() {
        assert_eq!(
            select_target(&snapshot(Some(0.0), Some(50.0))),
            ActivationDecision::Candidate(WindowKind::FiveHour)
        );
        assert_eq!(
            select_target(&snapshot(Some(0.001), Some(0.0))),
            ActivationDecision::Observe
        );
        assert_eq!(
            select_target(&snapshot(Some(0.1), Some(0.0))),
            ActivationDecision::Observe
        );
    }

    #[test]
    fn five_hour_wins_and_weekly_exhaustion_blocks() {
        assert_eq!(
            select_target(&snapshot(Some(0.0), Some(0.0))),
            ActivationDecision::Candidate(WindowKind::FiveHour)
        );
        assert_eq!(
            select_target(&snapshot(Some(0.0), Some(100.0))),
            ActivationDecision::Blocked("weekly_exhausted")
        );
    }

    #[test]
    fn damaged_five_hour_does_not_fallback_to_weekly() {
        let value = json!({"rate_limit": {"allowed": true, "limit_reached": false, "primary_window": {"limit_window_seconds": FIVE_HOUR_SECONDS}, "secondary_window": {"used_percent": 0, "limit_window_seconds": WEEKLY_SECONDS}}});
        let parsed = snapshot_from_value(&value, 1, 1).unwrap();
        assert_eq!(
            select_target(&parsed),
            ActivationDecision::Unsupported("invalid_five_hour")
        );
    }

    #[test]
    fn weekly_only_can_be_selected() {
        assert_eq!(
            select_target(&snapshot(None, Some(0.0))),
            ActivationDecision::Candidate(WindowKind::Weekly)
        );
    }

    #[test]
    fn claim_is_at_most_once_for_repeated_zero() {
        let mut state = ActivationState::default();
        let snap = snapshot(Some(0.0), Some(50.0));
        assert!(matches!(
            state.observe(&snap, 1),
            ActivationDecision::Candidate(WindowKind::FiveHour)
        ));
        assert!(state.claim("attempt-1", 1).is_some());
        assert_eq!(state.observe(&snap, 2), ActivationDecision::Observe);
        assert!(state.claim("attempt-2", 2).is_none());
    }

    #[test]
    fn weekly_exhaustion_never_creates_a_claim() {
        let mut state = ActivationState::default();
        let exhausted = snapshot(Some(0.0), Some(100.0));
        assert_eq!(
            state.observe(&exhausted, 1),
            ActivationDecision::Blocked("weekly_exhausted")
        );
        assert!(state.claim("attempt", 1).is_none());
    }

    #[test]
    fn spent_requires_a_later_nonzero_observation_before_rearming() {
        let mut state = ActivationState::default();
        let zero = snapshot(Some(0.0), Some(50.0));
        assert!(matches!(
            state.observe(&zero, 1),
            ActivationDecision::Candidate(WindowKind::FiveHour)
        ));
        assert!(state.claim("attempt", 1).is_some());
        assert_eq!(state.observe(&zero, 2), ActivationDecision::Observe);

        let mut used = snapshot(Some(20.0), Some(50.0));
        used.request_started_at_ms = 2_000;
        used.observed_at_ms = 2_000;
        assert_eq!(state.observe(&used, 2_000), ActivationDecision::Observe);

        let mut recovered = snapshot(Some(0.0), Some(50.0));
        recovered.request_started_at_ms = 1_800_018_001_000;
        recovered.observed_at_ms = recovered.request_started_at_ms;
        assert_eq!(
            state.observe(&recovered, recovered.observed_at_ms),
            ActivationDecision::Candidate(WindowKind::FiveHour)
        );
    }

    #[test]
    fn unknown_permission_fails_closed() {
        let value = json!({"rate_limit": {"primary_window": {"used_percent": 0, "limit_window_seconds": FIVE_HOUR_SECONDS}, "secondary_window": {"used_percent": 0, "limit_window_seconds": WEEKLY_SECONDS}}});
        assert_eq!(
            select_target(&snapshot_from_value(&value, 1, 1).unwrap()),
            ActivationDecision::Blocked("permission_or_limit")
        );
    }

    #[test]
    fn handoff_decision_vectors_run_through_the_real_parser_and_selector() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/decision_cases.json")).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(
            cases.len() >= 20,
            "fixture case list should not silently shrink"
        );
        for case in cases {
            let id = case["id"].as_str().unwrap();
            let snapshot =
                snapshot_from_value(&case["raw_response"], 1_799_999_999_000, 1_800_000_000_000);
            let expected_target = case["expected"]["target_by_structure"]
                .as_str()
                .unwrap_or("");
            if expected_target.is_empty() {
                assert!(
                    snapshot.is_none()
                        || structurally_selected_target(snapshot.as_ref().unwrap()).is_none(),
                    "{id}"
                );
                continue;
            }
            let snapshot = snapshot.unwrap_or_else(|| panic!("{id}: expected parseable snapshot"));
            assert_eq!(
                structurally_selected_target(&snapshot).map(WindowKind::as_str),
                Some(expected_target),
                "{id}: target structure"
            );
            let decision = select_target(&snapshot);
            match case["expected"]["decision"].as_str().unwrap() {
                "candidate" => assert_eq!(
                    decision,
                    ActivationDecision::Candidate(structurally_selected_target(&snapshot).unwrap()),
                    "{id}"
                ),
                "observe_only" => assert_eq!(decision, ActivationDecision::Observe, "{id}"),
                "blocked" => assert!(
                    matches!(
                        decision,
                        ActivationDecision::Blocked(_) | ActivationDecision::Unsupported(_)
                    ),
                    "{id}: {decision:?}"
                ),
                other => panic!("{id}: unexpected fixture outcome {other}"),
            }
        }
    }
}
