# Codex 额度自动激活：第四轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）
第四轮审计包：`C:\Users\admin\Downloads\ccswitch-quota-audit-c202b4f.zip`
审计对象与本轮起点：`c202b4fc879d8265ee4e6970104f0572946d1470`
分支：`codex/codex-quota-activation`

## 基线与边界

实际 HEAD 与审计对象一致，开始时工作树和暂存区为空。本轮没有覆盖已有修改、reset、checkout、stash、commit、push、PR 或部署。修改仅涉及 Provider 派发临界区、额度状态转换、时间元数据、失效只读结果，以及对应测试和本报告。

真实 OAuth、token refresh、quota/model GET、generation POST、生产凭据、生产 Provider 和生产数据库均 `NOT RUN`。loopback fake sender 使用假 token/workspace；数据库测试使用临时内存 SQLite。

## 第四轮逐项结论

| 项目 | 结论 | 证据与边界 |
|---|---|---|
| S01 Provider 绑定/开关/间隔与 submitted 同临界区 | **FIXED** | `derive_codex_quota_activation_interval_on_conn` 复用真实 `ProviderMeta`/`UsageScript` 解析；`begin_codex_quota_activation_dispatch_if_revision` 在同一 SQLite transaction 内重新读取有效 managed-account 绑定、查询开关和正间隔，再执行 `reserved -> submitted`。`s01_provider_configuration_is_checked_before_loopback_sender` 用真实 `save_provider` 在 barrier 后改为 interval=0，loopback sender=0；`s01_disabled_or_unbound_provider_cannot_submit_reserved_attempt` 覆盖关闭、零间隔、换账号绑定。正间隔的多个 Provider 仍由原有 shortest-positive DAO 测试覆盖。 |
| S02 可信额度耗尽观测保留 | **FIXED** | 选择器只接受字段一致、`allowed=false`、`limit_reached=true`、非零窗口且时间可信的 exhaustion 作为历史观测；决策仍是 `Blocked`，不进入模型 preflight/claim/POST。`s02_trusted_permission_exhaustion_rearms_spent_after_boundary` 覆盖 Spent→耗尽阻断→边界后零→Candidate；`s02_conflicted_exhaustion_does_not_move_trusted_state` 证明冲突响应不改变状态；既有 weekly exhausted/non-zero 观察测试继续通过。 |
| S03 服务端窗口时间时钟域 | **FIXED** | quota snapshot 保存 HTTP `Date` 与单调请求/收包时间；`reset_at/reset_after` 只在可信 Date 时按服务端 epoch 校验，本机 wall-clock 只用于回退，单调时间用于 age/timeout；缺 Date 保守返回 `invalid_window_timing`。`s03_server_date_normalizes_local_clock_skew_and_body_delay` 覆盖本机 +60 秒与 8 秒收包延迟；`s03_missing_date_is_conservative_and_does_not_rearm` 覆盖缺 Date；`n03_all_epoch_offsets_use_the_same_timing_rule` 及冲突回归仍拒绝 T-301/T+30。 |
| S04 后端失效结果不能只靠前端 revision cache 拦截 | **FIXED** | `get_codex_oauth_quota` 现在检查 `put_codex_oauth_if_generation` 结果；后端代次已失效时返回扁平兼容的 `lifecycle: "superseded"`，不触发 tray refresh。共享 QueryClient publisher、普通 Codex queryFn 和 `UsageScriptModal` 测试入口均拒绝该 DTO，保留当前成功缓存。`s04_backend_cache_rejection_is_serialized_as_superseded` 覆盖 generation 拒绝和序列化；`UsageScriptModal.codexQuotaCache.test.tsx` 第三个用例使用真实 QueryClient/UI 验证 superseded 不覆盖 quota@200。完整真实 Tauri/AppHandle 调用未执行。 |

## 保留项

R01–R05 的第三轮结构保持：FullRestore tombstone/revision 失效、cache generation 与 quota 同锁、历史 attempt 与最近 poll 分离、共享 quota publisher、`reserved -> submitted` 派发点、固定 `gpt-6-luna`/`low`/`hello` 和 one-shot no-retry 行为均未撤回。上一轮真实临时 DB restore、dispatch barrier、cache、UI 回归结果保留在本工作树的既有测试中。

## 实际测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：46 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml s01_ --lib -- --nocapture`：2 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml s04_backend_cache_rejection_is_serialized_as_superseded --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml commands::codex_oauth --lib -- --nocapture`：6 passed（含 R01/N02 派发边界）。
- `pnpm test:unit -- --run tests/components/UsageScriptModal.codexQuotaCache.test.tsx tests/hooks/useCodexQuotaAutoPolling.test.ts tests/components/CodexOAuthSection.test.tsx tests/components/CodexQuotaActivationCorrupt.test.tsx`：30 passed。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS；仅有既有 dead-code warnings。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm format:check`：PASS。
- `git diff --check`：PASS。

未运行全仓库 `cargo test`、完整 Vitest、clippy、打包和应用启动；这些检查超出本轮隔离范围。

审计包中的 `OFFLINE_PROBES.py` 仅作为现象参考，没有当作产品测试。

## 产品差异、未验证边界与回滚

- 缺失或不可信 HTTP `Date` 时，自动资格采取保守暂停；没有引入时钟同步服务、Coordinator、ledger、队列或独立调度器。
- Luna 线上权限、Responses 兼容性、实际扣费、服务端 reset 语义、跨进程崩溃和 exactly-once：`UNVERIFIED`。
- WebView 休眠/唤醒、真实网络竞态、完整 Tauri command 端到端 UI：`NOT RUN`。
- 回滚保留现有 activation 状态、claim、tombstone 和 revision 行；只需回滚本轮代码差异，不能删除状态表来“重试”。

本轮没有 commit、push、PR、Issue、部署或生产操作。
