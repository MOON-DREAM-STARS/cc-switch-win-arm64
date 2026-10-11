# Codex 额度自动激活：第二轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）

第二轮审计包：`C:\Users\admin\Downloads\ccswitch-quota-audit-85647d1.zip`

审计对象与本轮起点：`85647d116cb10fcaabb0994d8185d521fbd54d60`

分支：`codex/codex-quota-activation`

## 基线与范围

本轮开始时 `git status`、暂存区和 `git diff` 均为空，HEAD 与审计对象一致；没有覆盖既有本地修改。当前改动仍未提交，未创建新分支。代码修复只保留单账号状态表、现有 revision/claim/finish 和 one-shot HTTP 路径，没有引入 Coordinator、ledger、后台 worker 或新依赖。

## N01–N08 逐项结论

| 项目 | 结论 | 当前证据与边界 |
|---|---|---|
| N01 Sync revision 顺序与 FullRestore ABA | **FIXED** | `database/backup.rs::import_sql_string_inner_with_hook` 现在先在主库临界区把本机保留表复制到最终 staging，再 bump revision；FullRestore/二进制 restore 在 staging 可见前以 live 最大 revision 设下界并暂停。`activation_sync_preserves_local_state_but_full_restore_pauses_it` 真实走 sync import，验证 enabled/Spent/attempt 保留、revision 严格增长，以及旧 revision 的 save/claim/finish 全部失败；同一测试覆盖低 revision 备份后立即重新开启不重用旧 revision。未运行跨进程崩溃演练。 |
| N02 最终授权检查与 sender 派发边界 | **FIXED** | `commands/codex_oauth.rs::dispatch_activation_with` 使用 `begin_codex_quota_activation_dispatch_if_revision` 的条件 UPDATE 作为线性化点；关闭/恢复先提交时 sender 不被调用，点之后的请求按已提交在途处理，finish 失败返回 `superseded`。`n02_disable_before_dispatch_commit_calls_real_sender_zero_times` 和 `n02_dispatch_commit_allows_one_inflight_request_but_finish_is_stale` 走生产 helper、真实 `send_activation_once` 与 127.0.0.1 SSE fake server，分别验证 0 次和最多 1 次 POST。 |
| N03 reset_at / countdown 一致性 | **FIXED** | `valid_timing` 对真实 epoch 的近边界过去 `reset_at` 与正 countdown 矛盾 fail closed，并在 weekly exhausted 前执行；远历史边界仍可用于生命周期排序。`n03_reset_boundary_and_countdown_conflict_cannot_create_candidate` 覆盖 Bootstrap 与 weekly 阻断，已有 Tracking/Spent/weekly 非零回归继续通过。 |
| N04 权限冲突不得降级为缺失 | **FIXED** | parser 保留 explicit invalid/conflict 标记，selector 在窗口值前 fail closed；别名冲突和顶层/嵌套冲突不会被目标窗口重新放行。`permission_conflicts_and_nested_rate_limit_are_retained`、`unknown_permission_fails_closed` 与 decision fixture 通过。 |
| N05 lastPoll 与 lastAttempt | **FIXED** | 根轮询使用账号+revision 的 bounded in-memory latest poll summary，查询 refetch 会按同一 revision 合并；`attempted=false` 不再改写 lastAttempt。真实 QueryClient + fake timers + 自动 IPC 的 `keeps a preflight failure visible after the production hook invalidates and refetches state` 验证 model_unavailable 在 list refetch 后仍可见。未做真实 WebView 截图。 |
| N06 迟到 GET/POST 结果归属 | **FIXED** | Rust `UsageCache` 增加账号 generation，关闭/删除/restore 使旧 GET 的发布失效；poll 在 revision 与 generation 均有效后才写 cache；dispatch finish=false 返回 `superseded`，前端不合并其 quota。`codex_oauth_generation_rejects_results_after_account_invalidation`、N02 in-flight 测试和 FullRestore late-finish 测试通过。未执行真实网络关闭竞态。 |
| N07 普通 query 与自动写回排序 | **FIXED** | `useCodexOauthQuotaByAccountId` 的 queryFn 与自动 `setQueryData` 都使用 queriedAt 排序；两个 deferred promise 通过真实 QueryClient 覆盖 M<A 与 A<M。测试名：`orders manual and automatic completions through the real QueryClient queryFn`。 |
| N08 坏 JSON 账号可达关闭 | **FIXED** | 账号 UI 在 `stateError` 下显示可达的“关闭损坏账号的自动激活”开关动作，后端 false 路径不解码、不 Bootstrap；其他账号列表保持独立。`CodexQuotaActivationCorrupt.test.tsx` 的真实 `CodexOAuthSection` wrapper 验证调用 `setCodexQuotaActivationEnabled(account, false, undefined)`。 |

## 实际执行的测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：41 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml n02_ --lib -- --nocapture`：2 passed；真实 one-shot sender loopback。
- `cargo test --manifest-path src-tauri/Cargo.toml activation_sync_preserves_local_state_but_full_restore_pauses_it --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml usage_cache --lib -- --nocapture`：12 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_oauth_models --lib -- --nocapture`：10 passed。
- `pnpm test:unit -- --run tests/hooks/useCodexQuotaAutoPolling.test.ts tests/components/CodexOAuthSection.test.tsx tests/components/CodexQuotaActivationCorrupt.test.tsx`：26 passed。
- `pnpm typecheck`：PASS。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS（仅既有 dead-code warnings）。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS；`pnpm format:check`：PASS；`git diff --check`：PASS。

上轮审计的 `MINIMAL_REPRO.py` 不是产品测试，本轮没有把它的结果当作通过依据。没有运行真实 OAuth、token refresh、额度查询、模型目录、生成请求或生产凭据操作；HTTP fake 仅绑定 loopback。

## 产品差异、协议边界与剩余风险

- UI 仍在认证中心区域；没有迁移页面，也没有增加生产入口。固定请求继续使用 `gpt-6-luna`、`reasoning.effort=low`、`hello`。
- Luna 线上权限、真实 Responses 兼容性、实际扣费、服务端 reset 周期和 exactly-once 仍为 **UNVERIFIED**；没有用 live probe、模型替换或协议切换填补证据缺口。
- 系统休眠/唤醒、真实 WebView timer、跨进程崩溃和生产网络关闭竞态为 **NOT RUN**。
- `effectiveIntervalMinutes` 仍由后端派生；前端入参继续被忽略，未扩大 IPC 合同。

## 变更职责与回滚

- N01：`src-tauri/src/database/backup.rs`、`src-tauri/src/database/dao/codex_quota_activation.rs`。
- N02/N06：`src-tauri/src/commands/codex_oauth.rs`、`src-tauri/src/commands/auth.rs`、`src-tauri/src/services/usage_cache.rs`。
- N03/N04：`src-tauri/src/services/codex_quota_activation.rs`。
- N05/N07：`src/hooks/useCodexQuotaAutoPolling.ts`、`src/lib/query/subscription.ts`、`src/lib/api/subscription.ts`。
- N08：`src/components/providers/forms/CodexOAuthSection.tsx` 与新增 UI 回归测试。

回滚方式是关闭账号授权开关并保留本地 state/claim；代码回滚时不要删除现有激活表或 revision 行。最终确认：本轮无 commit、push、PR、Issue、部署，也没有生产状态修改。
