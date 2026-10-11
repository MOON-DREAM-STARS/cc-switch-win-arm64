# Codex 额度自动激活：第七轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）

第七轮审计包：`C:/Users/admin/Downloads/ccswitch-quota-audit-07a6a14.zip`

审计对象与本轮起点：`07a6a14762dbc555db9e2f0593a353ccdf4570c0`

实际 HEAD：`07a6a14762dbc555db9e2f0593a353ccdf4570c0`

分支：`codex/codex-quota-activation`

## 基线与执行边界

开始时实际 HEAD 与第七轮审计对象一致，工作树和暂存区为空；本轮没有 reset、checkout、stash、clean 或覆盖已有修改。当前未提交差异包括两个源码文件和两份验收文档。没有 commit、push、PR、Issue、部署或生产写入。

本轮只处理 V01。真实 OAuth、token refresh、quota/model GET、generation POST、生产凭据、生产 Provider 和生产数据库均 `NOT RUN`。测试使用临时内存 SQLite、真实 parser/state/DAO/restore/dispatch helper、假 token/workspace 和 `127.0.0.1` loopback fake server；审计包的 `OFFLINE_STATE_TRACE.py`、`SUGGESTED_V01_TEST.rs` 未计入 PASS。

## 本轮逐项结论

| 项目 | 结论 | 证据与边界 |
|---|---|---|
| V01 AwaitingBaseline 等 TrackingUsage 入口必须满足有效非零窗口规则 | **FIXED** | 先加入并运行原生反例：`v01_shape_change_awaiting_baseline_rejects_expired_nonzero`、`v01_awaiting_baseline_rejects_expired_nonzero_with_missing_countdown` 和真实 FullRestore 反例 `v01_full_restore_awaiting_baseline_rejects_expired_nonzero`。在旧实现上三者均红灯：AwaitingBaseline 会被过期非零样本改成 TrackingUsage。修复后统一复用 `current_nonzero_window_is_valid`，覆盖 BootstrapPending、TrackingUsage、Eligible、AwaitingBaseline 和 Spent 的非零入口；三项反例均绿灯，过期非零随后归零不会 Candidate/claim。真实临时 DB export/import restore、parser、state、DAO claim 也已穿过。 |
| U01 过期非零窗口不能重新武装已消费资格 | **FIXED（保留）** | 第六轮的 Spent 可信窗口门槛、T01 当前窗口正向轨迹和真实 dispatch/loopback 证据保留；本轮未撤回。 |
| U02 SSE 完整帧增量终态 | **FIXED（保留）** | 第六轮的完整帧即时终态、EOF 半帧 Unknown、UTF-8/混合分隔符、one-shot、大小限制、脱敏和 no-retry 证据保留；本轮未撤回。 |
| T03 pending 摘要结转建议 | **DEFERRED** | 未改变旧 finish 的 revision/enabled 隔离，也未新增 pending 协议。 |

此前已修复并保留的 T01/T02、R01–R05、S01–S04、Provider 提交许可、submitted 提交点、tombstone/revision、同锁缓存、固定 `gpt-6-luna`/`low`/`hello`、5h 优先、weekly 耗尽不发送、只读手动查询和 one-shot POST/no-retry 结构均未重新打开。本轮没有新增 coordinator、ledger、schema、队列或调度器。

## V01 修复范围

`current_nonzero_window_is_valid` 现在是所有进入或更新 `TrackingUsage` 的共同谓词。它要求可信服务端 Date、正的 `reset_after_seconds`、仍在服务端 Date 之后的 `reset_at` 以及通过既有窗口时序校验；无效非零样本保持 `AwaitingBaseline`/原状态，不能借由结构变化、FullRestore 或缺失倒计时建立新的可信边界。有效的“本窗口边界前非零 → 越过边界后归零”仍可按 T01 获得下一次资格；首次零值策略、5h 优先和 weekly 阻断行为没有改变。

## 实际测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml v01_ --lib -- --nocapture`：3 passed（两个状态反例和一个真实 FullRestore 反例）。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：61 passed，覆盖 state/parser/DAO、V01/U01/T01/T02、HTTP 相关回归和真实 dispatch 轨迹。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation_http --lib -- --nocapture`：13 passed，保留 U02 完整帧增量与 no-retry/脱敏覆盖。
- `cargo test --manifest-path src-tauri/Cargo.toml commands::codex_oauth --lib -- --nocapture`：8 passed，含 `u01_expired_window_uses_real_dispatch_once_and_never_reclaims`、R01/N02/S01/T02 回归。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS；仅有当前模块既有/测试辅助路径的 dead-code warnings，没有编译错误。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `git diff --check`：PASS。

本轮未修改前端，因此没有重复运行 Vitest、`pnpm typecheck` 或 `pnpm format:check`，记为 `NOT RUN`；也未运行全量 cargo test、clippy、打包、真实应用启动、WebView/休眠唤醒或 provider-live 检查。上一轮前端和后端证据只作为已保留历史，不冒充本轮新增验证。

## 修改文件与回滚

- [`src-tauri/src/services/codex_quota_activation.rs`](../../src-tauri/src/services/codex_quota_activation.rs)：集中复用有效非零窗口谓词，并新增跨窗口结构变化反例，阻止 AwaitingBaseline/其他入口用过期或无倒计时非零样本建立 TrackingUsage。
- [`src-tauri/src/database/backup.rs`](../../src-tauri/src/database/backup.rs)：新增真实内存 DB FullRestore → AwaitingBaseline → parser/state/claim 反例，验证恢复后的状态也不被坏非零样本推进。

回滚只需撤销上述本轮源码和测试差异；不删除 activation 状态、claim、Spent、tombstone 或 revision 行来重新获得资格。服务端 Luna 权限、Responses 兼容性、真实扣费、reset 生命周期、跨设备时钟、系统 suspend、exactly-once 和完整 Tauri/AppHandle 仍为 `UNVERIFIED`/`NOT RUN`。

本轮没有 commit、push、PR、Issue、部署或生产操作。
