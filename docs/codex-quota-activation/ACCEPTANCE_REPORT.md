# Codex 额度自动激活：第五轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）
第五轮审计包：`C:\Users\admin\Downloads\ccswitch-quota-audit-a79aa59.zip`
审计对象与本轮起点：`a79aa598ae0854489088f3973d004c5b5c5dfc0f`
分支：`codex/codex-quota-activation`

## 基线与边界

实际 HEAD 与第五轮审计对象一致，开始时工作树和暂存区为空。本轮没有覆盖已有修改、reset、checkout、stash、commit、push、PR 或部署。修改集中在 Spent 状态转换、自动 quota publication 结果传播、自动回调防御和回归测试。

真实 OAuth、token refresh、quota/model GET、generation POST、生产凭据、生产 Provider 和生产数据库均 `NOT RUN`。测试使用临时内存 SQLite、假 token/workspace、loopback 或 mock IPC、真实项目 parser/state/DAO、生产 publication/dispatch helper 和 QueryClient。

## 第五轮逐项结论

| 项目 | 结论 | 证据与边界 |
|---|---|---|
| T01 Spent 丢失本窗口非零基线 | **FIXED** | `ActivationState::observe` 的 Spent 分支现在只要求可信非零观测发生在前次 attempt 之后，并要求当前/未来 `reset_at >=` 旧 event boundary；不再要求服务端 Date 已越过旧边界。候选仍只由 TrackingUsage 越过可信边界后的原始 `used_percent == 0.0` 触发。`t01_post_attempt_nonzero_before_old_boundary_rearms_five_hour`、`t01_post_attempt_exhaustion_before_old_boundary_rearms_five_hour`、`t01_post_attempt_nonzero_before_old_boundary_rearms_weekly_only` 均通过。 |
| T02 自动入口 publication 失效传播 | **FIXED** | `UsageCache` 新增 `Published/Superseded/Stale/Unavailable` 结果；自动 poll 在 writer 拒绝后立即返回无 quota 的 `superseded` 或 `stale_result`，不再继续走 `quota_unavailable`、`stale_snapshot`、模型准备或其他提前返回。生产 publication helper 提供 GET 后、writer 前 barrier；`t02_automatic_publication_barrier_returns_superseded_without_quota` 使用真实临时 DB、授权 revision、cache invalidate 和该 helper 验证关闭后旧结果不可发布。前端故意保留旧 revision 的真实 QueryClient/root hook 测试也保持 quota@20，不接收 superseded quota。 |
| T03 pending 摘要结转建议 | **DEFERRED** | 本轮保留旧 `finish` 的 revision/enabled 隔离、Spent/attempt 去重和 submitted 事实，没有把 pending 状态改写成 superseded/unknown。该项不阻断 T01/T02；后续若实施需单独覆盖关闭前/提交后两条摘要语义，不能放宽旧 finish 条件。 |

## 保留项

已修复的 Provider 提交许可、同一 SQLite 临界区的 `reserved -> submitted`、FullRestore tombstone/revision 下界、同锁 quota/generation、固定 `gpt-6-luna`/`low`/`hello`、手动只读查询、one-shot POST/no-retry、lastPoll/lastAttempt 分离均未修改。T01 没有清空 Spent，也没有增加额外 hello 或模型检查；T02 没有新增 generation 系统、Coordinator、ledger、scheduler 或后台 daemon。

## 实际测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：50 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml t01_parser_state_dao_preserves_current_window_nonzero_before_recovery --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml t01_ --lib -- --nocapture`：3 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml commands::codex_oauth --lib -- --nocapture`：7 passed，含 R01/N02/S01 派发回归和 T02 publication barrier。
- `cargo test --manifest-path src-tauri/Cargo.toml t02_ --lib -- --nocapture`：1 passed。
- `pnpm test:unit -- --run tests/hooks/useCodexQuotaAutoPolling.test.ts tests/components/UsageScriptModal.codexQuotaCache.test.tsx tests/components/CodexOAuthSection.test.tsx tests/components/CodexQuotaActivationCorrupt.test.tsx`：31 passed。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS；仅有既有 dead-code warnings。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm format:check`：PASS。
- `git diff --check`：PASS。

审计包中的 `OFFLINE_PROBES.py` 和 `PROBE_RESULTS.json` 只用于理解反例，没有当作产品测试证据。全仓库 `cargo test`、完整 Vitest、clippy、打包、应用启动、WebView/休眠唤醒仍未运行。

## 产品差异、未验证边界与回滚

- T01 的 post-attempt 顺序使用持久化的本机 request-start/attempt wall-clock 同域；HTTP `Date` 继续只负责服务端窗口字段校验，不用新 offset 重新解释旧 attempt。跨设备时钟、系统 suspend 和平台级 Instant 语义仍为 `UNVERIFIED`。
- T02 自动结果现在以 status/no-quota 传播失效；同代次旧 quota 也不再由自动 callback 回填。真实 Tauri/AppHandle 调用和真实服务返回仍为 `NOT RUN`。
- Luna 线上权限、Responses 兼容性、实际扣费、服务端 reset 生命周期和 exactly-once：`UNVERIFIED`。
- 回滚只需回滚本轮源码和测试差异；保留 activation 状态、claim、Spent、tombstone 和 revision 行，不删除状态来重新获得资格。

本轮没有 commit、push、PR、Issue、部署或生产操作。
