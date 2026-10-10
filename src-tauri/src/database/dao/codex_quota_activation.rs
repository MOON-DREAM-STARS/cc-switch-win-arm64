//! SQLite persistence for account-scoped activation authorization.
//!
//! Rows are local only.  The state JSON is a bounded finite state machine, so
//! malformed or unknown data fails closed instead of recreating eligibility.

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::codex_quota_activation::{ActivationState, ClaimedAttempt};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaActivationRecord {
    pub account_id: String,
    pub enabled: bool,
    pub effective_interval_minutes: Option<u64>,
    pub enabled_at_ms: Option<i64>,
    pub last_polled_at_ms: Option<i64>,
    pub last_attempt_at_ms: Option<i64>,
    pub last_attempt_status: Option<String>,
    pub last_reason: Option<String>,
    pub state: ActivationState,
    pub updated_at: i64,
}

fn decode_state(raw: &str) -> Result<ActivationState, AppError> {
    serde_json::from_str(raw).map_err(|error| {
        AppError::Database(format!(
            "invalid Codex activation state; activation paused: {error}"
        ))
    })
}

fn encode_state(state: &ActivationState) -> Result<String, AppError> {
    serde_json::to_string(state)
        .map_err(|error| AppError::Database(format!("serialize Codex activation state: {error}")))
}

impl Database {
    /// Derive the account timer from bound official Codex providers. Explicit
    /// zero and disabled/unbound providers are excluded; the shortest positive
    /// interval wins for one shared account timer.
    pub(crate) fn derive_codex_quota_activation_interval(
        &self,
        account_id: &str,
        default_account_id: Option<&str>,
    ) -> Result<Option<u64>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, category, meta FROM providers
                 WHERE app_type = 'codex'
                   AND json_extract(meta, '$.authBinding.source') = 'managed_account'
                   AND json_extract(meta, '$.authBinding.authProvider') = 'codex_oauth'",
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        let mut intervals = Vec::new();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| AppError::Database(error.to_string()))?;
        for row in rows {
            let (provider_id, category, meta) =
                row.map_err(|error| AppError::Database(error.to_string()))?;
            let value: serde_json::Value = serde_json::from_str(&meta).unwrap_or_default();
            let bound_account_id = value
                .pointer("/authBinding/accountId")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|bound| !bound.is_empty())
                .or(default_account_id);
            if bound_account_id != Some(account_id) {
                continue;
            }
            let official = provider_id == crate::database::CODEX_OFFICIAL_PROVIDER_ID
                || category.as_deref() == Some("official")
                || value
                    .pointer("/providerType")
                    .and_then(serde_json::Value::as_str)
                    == Some("codex_oauth");
            if !official {
                continue;
            }
            let enabled = value
                .pointer("/usageScript/enabled")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            if value
                .pointer("/usageScript/templateType")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|template| template != "official_subscription")
            {
                continue;
            }
            let interval = value
                .pointer("/usageScript/autoQueryInterval")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(5);
            if enabled {
                intervals.push(interval);
            }
        }
        if intervals.is_empty() {
            return Ok(None);
        }
        Ok(intervals
            .iter()
            .copied()
            .filter(|value| *value > 0)
            .min()
            .or(Some(0)))
    }

    pub(crate) fn get_codex_quota_activation_state(
        &self,
        account_id: &str,
    ) -> Result<Option<CodexQuotaActivationRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let row = conn
            .query_row(
                "SELECT account_id, enabled, effective_interval_minutes, enabled_at_ms,
                        last_polled_at_ms, last_attempt_at_ms, last_attempt_status,
                        last_reason, state_json, updated_at
                 FROM codex_quota_activation_state WHERE account_id = ?1",
                params![account_id],
                |row| {
                    let raw: String = row.get(8)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        raw,
                        row.get::<_, i64>(9)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let Some((
            account_id,
            enabled,
            interval,
            enabled_at_ms,
            last_polled_at_ms,
            last_attempt_at_ms,
            last_attempt_status,
            last_reason,
            raw,
            updated_at,
        )) = row
        else {
            return Ok(None);
        };
        let state = decode_state(&raw)?;
        Ok(Some(CodexQuotaActivationRecord {
            account_id,
            enabled,
            effective_interval_minutes: interval.and_then(|value| u64::try_from(value).ok()),
            enabled_at_ms,
            last_polled_at_ms,
            last_attempt_at_ms,
            last_attempt_status,
            last_reason,
            state,
            updated_at,
        }))
    }

    pub(crate) fn list_codex_quota_activation_states(
        &self,
    ) -> Result<Vec<CodexQuotaActivationRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT account_id, enabled, effective_interval_minutes, enabled_at_ms,
                        last_polled_at_ms, last_attempt_at_ms, last_attempt_status,
                        last_reason, state_json, updated_at
                 FROM codex_quota_activation_state ORDER BY account_id",
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                let raw: String = row.get(8)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)? != 0,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    raw,
                    row.get::<_, i64>(9)?,
                ))
            })
            .map_err(|error| AppError::Database(error.to_string()))?;
        rows.map(|row| {
            let (
                account_id,
                enabled,
                interval,
                enabled_at_ms,
                last_polled_at_ms,
                last_attempt_at_ms,
                last_attempt_status,
                last_reason,
                raw,
                updated_at,
            ) = row.map_err(|error| AppError::Database(error.to_string()))?;
            Ok(CodexQuotaActivationRecord {
                account_id,
                enabled,
                effective_interval_minutes: interval.and_then(|value| u64::try_from(value).ok()),
                enabled_at_ms,
                last_polled_at_ms,
                last_attempt_at_ms,
                last_attempt_status,
                last_reason,
                state: decode_state(&raw)?,
                updated_at,
            })
        })
        .collect()
    }

    pub(crate) fn set_codex_quota_activation_enabled(
        &self,
        account_id: &str,
        enabled: bool,
        effective_interval_minutes: Option<u64>,
        now_ms: i64,
    ) -> Result<CodexQuotaActivationRecord, AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let current = tx
            .query_row(
                "SELECT state_json FROM codex_quota_activation_state WHERE account_id = ?1",
                params![account_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let state = match current {
            Some(raw) => decode_state(&raw)?,
            None => ActivationState::BootstrapPending,
        };
        let raw = encode_state(&state)?;
        tx.execute(
            "INSERT INTO codex_quota_activation_state
                (account_id, enabled, effective_interval_minutes, enabled_at_ms, state_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(account_id) DO UPDATE SET
                enabled=excluded.enabled,
                effective_interval_minutes=excluded.effective_interval_minutes,
                enabled_at_ms=excluded.enabled_at_ms,
                updated_at=excluded.updated_at",
            params![
                account_id,
                i64::from(enabled),
                effective_interval_minutes.and_then(|value| i64::try_from(value).ok()),
                now_ms,
                raw,
                now_ms
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        tx.commit()
            .map_err(|error| AppError::Database(error.to_string()))?;
        drop(conn);
        self.get_codex_quota_activation_state(account_id)?
            .ok_or_else(|| {
                AppError::Database("activation state disappeared after update".to_string())
            })
    }

    pub(crate) fn save_codex_quota_activation_state(
        &self,
        account_id: &str,
        state: &ActivationState,
        now_ms: i64,
    ) -> Result<(), AppError> {
        let raw = encode_state(state)?;
        let conn = lock_conn!(self.conn);
        let changed = conn
            .execute(
                "UPDATE codex_quota_activation_state SET state_json = ?1, updated_at = ?2
                 WHERE account_id = ?3",
                params![raw, now_ms, account_id],
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        if changed == 0 {
            return Err(AppError::Database(
                "activation state is not enabled for this account".to_string(),
            ));
        }
        Ok(())
    }

    pub(crate) fn refresh_codex_quota_activation_interval(
        &self,
        account_id: &str,
        interval_minutes: Option<u64>,
        now_ms: i64,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE codex_quota_activation_state
             SET effective_interval_minutes = ?1, updated_at = ?2
             WHERE account_id = ?3",
            params![
                interval_minutes.and_then(|value| i64::try_from(value).ok()),
                now_ms,
                account_id
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    /// Backend due guard for the explicit polling IPC. The first poll is not
    /// due until a complete configured interval after the user enabled it.
    pub(crate) fn try_begin_codex_quota_activation_poll(
        &self,
        account_id: &str,
        effective_interval_minutes: Option<u64>,
        now_ms: i64,
    ) -> Result<bool, AppError> {
        let Some(interval_minutes) = effective_interval_minutes.filter(|value| *value > 0) else {
            self.refresh_codex_quota_activation_interval(
                account_id,
                effective_interval_minutes,
                now_ms,
            )?;
            return Ok(false);
        };
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let row = tx
            .query_row(
                "SELECT enabled, enabled_at_ms, last_polled_at_ms
             FROM codex_quota_activation_state WHERE account_id = ?1",
                params![account_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)? != 0,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let Some((true, Some(enabled_at_ms), last_polled_at_ms)) = row else {
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(false);
        };
        let anchor = last_polled_at_ms.map_or(enabled_at_ms, |last| last.max(enabled_at_ms));
        let interval_ms = i64::try_from(interval_minutes)
            .unwrap_or(i64::MAX)
            .saturating_mul(60_000);
        if now_ms.saturating_sub(anchor) < interval_ms {
            tx.execute(
                "UPDATE codex_quota_activation_state SET effective_interval_minutes = ?1
                 WHERE account_id = ?2",
                params![
                    i64::try_from(interval_minutes).unwrap_or(i64::MAX),
                    account_id
                ],
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(false);
        }
        let changed = tx
            .execute(
                "UPDATE codex_quota_activation_state
             SET effective_interval_minutes = ?1, last_polled_at_ms = ?2, updated_at = ?2
             WHERE account_id = ?3 AND enabled = 1 AND enabled_at_ms = ?4
               AND last_polled_at_ms IS ?5",
                params![
                    i64::try_from(interval_minutes).unwrap_or(i64::MAX),
                    now_ms,
                    account_id,
                    enabled_at_ms,
                    last_polled_at_ms
                ],
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        tx.commit()
            .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(changed == 1)
    }

    pub(crate) fn finish_codex_quota_activation_attempt(
        &self,
        account_id: &str,
        attempt_id: &str,
        status: &str,
        reason: Option<&str>,
        now_ms: i64,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let changed = conn
            .execute(
                "UPDATE codex_quota_activation_state
             SET last_attempt_status = ?1, last_reason = ?2, updated_at = ?3
             WHERE account_id = ?4 AND last_attempt_id = ?5",
                params![status, reason, now_ms, account_id, attempt_id],
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(changed == 1)
    }

    pub(crate) fn mark_codex_quota_activation_inflight_unknown(
        &self,
        now_ms: i64,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE codex_quota_activation_state
             SET last_attempt_status = 'unknown', last_reason = 'previous process ended after reserving the request', updated_at = ?1
             WHERE last_attempt_status = 'reserved'",
            params![now_ms],
        ).map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    /// Atomically reserve the current eligible event. A failed reservation
    /// commits no state and the caller must not issue a POST.
    pub(crate) fn claim_codex_quota_activation(
        &self,
        account_id: &str,
        attempt_id: &str,
        attempted_at_ms: i64,
    ) -> Result<Option<ClaimedAttempt>, AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let row = tx
            .query_row(
                "SELECT enabled, state_json FROM codex_quota_activation_state WHERE account_id = ?1",
                params![account_id],
                |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| AppError::Database(error.to_string()))?;
        let Some((enabled, raw)) = row else {
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(None);
        };
        if !enabled {
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(None);
        }
        let mut state = decode_state(&raw)?;
        let Some(claim) = state.claim(attempt_id.to_string(), attempted_at_ms) else {
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(None);
        };
        let encoded = encode_state(&state)?;
        let changed = tx
            .execute(
                "UPDATE codex_quota_activation_state SET state_json = ?1, updated_at = ?2
                 , last_attempt_at_ms = ?2, last_attempt_id = ?5,
                   last_attempt_status = 'reserved', last_reason = NULL
                 WHERE account_id = ?3 AND enabled = 1 AND state_json = ?4",
                params![encoded, attempted_at_ms, account_id, raw, attempt_id],
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        if changed != 1 {
            tx.commit()
                .map_err(|error| AppError::Database(error.to_string()))?;
            return Ok(None);
        }
        tx.commit()
            .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(Some(claim))
    }

    /// Full restore/import callers use this to stop dispatch and require a
    /// fresh nonzero baseline before eligibility can be rebuilt.
    pub(crate) fn pause_codex_quota_activation_after_restore(
        &self,
        now_ms: i64,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE codex_quota_activation_state
             SET enabled = 0, state_json = ?1, updated_at = ?2",
            params![encode_state(&ActivationState::AwaitingBaseline)?, now_ms],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::services::codex_quota_activation::ActivationState;

    #[test]
    fn state_defaults_off_and_claim_is_atomic() {
        let db = Database::memory().unwrap();
        let row = db
            .set_codex_quota_activation_enabled("a", true, Some(5), 1)
            .unwrap();
        assert!(row.enabled);
        db.save_codex_quota_activation_state(
            "a",
            &ActivationState::Eligible {
                target: crate::services::codex_quota_activation::WindowKind::FiveHour,
                event_key: "e".into(),
            },
            2,
        )
        .unwrap();
        assert!(db
            .claim_codex_quota_activation("a", "attempt", 3)
            .unwrap()
            .is_some());
        assert!(db
            .claim_codex_quota_activation("a", "attempt-2", 4)
            .unwrap()
            .is_none());
    }

    #[test]
    fn malformed_state_fails_closed() -> Result<(), AppError> {
        let db = Database::memory().unwrap();
        db.set_codex_quota_activation_enabled("a", true, Some(5), 1)
            .unwrap();
        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE codex_quota_activation_state SET state_json = '{' WHERE account_id='a'",
                [],
            )
            .unwrap();
        }
        assert!(db.get_codex_quota_activation_state("a").is_err());
        Ok(())
    }

    #[test]
    fn interval_zero_pauses_and_reserved_attempt_becomes_unknown_on_restart() -> Result<(), AppError>
    {
        let db = Database::memory()?;
        db.set_codex_quota_activation_enabled("a", true, Some(5), 0)?;
        assert!(!db.try_begin_codex_quota_activation_poll("a", Some(0), 600_000)?);
        db.save_codex_quota_activation_state(
            "a",
            &ActivationState::Eligible {
                target: crate::services::codex_quota_activation::WindowKind::FiveHour,
                event_key: "event".to_string(),
            },
            600_000,
        )?;
        assert!(db
            .claim_codex_quota_activation("a", "attempt", 600_001)?
            .is_some());
        db.finish_codex_quota_activation_attempt("a", "attempt", "reserved", None, 600_002)?;
        db.mark_codex_quota_activation_inflight_unknown(600_003)?;
        let state = db.get_codex_quota_activation_state("a")?.unwrap();
        assert_eq!(state.last_attempt_status.as_deref(), Some("unknown"));
        assert!(db
            .claim_codex_quota_activation("a", "attempt-2", 600_004)?
            .is_none());
        Ok(())
    }
}
