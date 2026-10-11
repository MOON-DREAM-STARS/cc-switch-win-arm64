# Codex 额度自动激活：第六轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）
第六轮审计包：`C:\Users\admin\Downloads\ccswitch-quota-audit-d786dfc.zip`
审计对象与本轮起点：`d786dfc786da81854038d3c02f00085ca5bf1cfb`
分支：`codex/codex-quota-activation`

## 基线与边界

实际 HEAD 与第六轮审计对象一致，开始时工作树和暂存区为空。本轮保留 T01/T02 的已修复结构和 T03 的延期决定；未执行 reset、checkout、stash、commit、push、PR 或部署。

真实 OAuth、token refresh、quota/model GET、generation POST、生产凭据、生产 Provider 和生产数据库均 `NOT RUN`。测试使用临时内存 SQLite、真实 parser/state/DAO/dispatch helper、假 token/workspace 和 `127.0.0.1` fake server。

## 第六轮逐项结论

| 项目 | 结论 | 证据与边界 |
|---|---|---|
| U01 过期非零窗口不能重新武装已消费资格 | **FIXED** | Spent 的非零基线现在必须满足：发生在前次 attempt 后、拥有可信 HTTP Date、`reset_after_seconds > 0`、`reset_at` 仍在该 Date 之后，并且边界不早于旧 event boundary。过去 reset + `after=0`/缺失 countdown 不再把 Spent 重建为 Tracking。`u01_expired_five_hour_nonzero_cannot_rearm_but_t01_current_window_still_can`、`u01_expired_weekly_only_nonzero_cannot_rearm`、`u01_post_attempt_nonzero_with_a_new_future_boundary_is_valid` 通过；`u01_expired_window_uses_real_dispatch_once_and_never_reclaims` 进一步走真实临时 DB、parser、state/claim、dispatch helper 和 loopback sender，确认只发生一次 POST。上轮“边界前非零→边界后归零”仍由 T01 测试覆盖。 |
| U02 SSE 完整帧增量终态 | **FIXED** | 成功 HTTP 流改为复用 `append_utf8_safe`、`take_sse_block`、`strip_sse_field` 增量解析；完整 `response.completed`/失败帧出现后立即结束读取，不等待 body EOF；EOF 仅对未以空行结束的半帧返回 Unknown。保留 1 MiB 上限、总超时、脱敏、one-shot、no redirect/no retry。fake server 覆盖完整终态后挂起 body、失败帧后挂起 body、UTF-8 跨 chunk、混合 LF/CRLF、完整 JSON 无空行 EOF、同批 completed/failed 矛盾；全部通过。 |
| T03 pending 摘要结转建议 | **DEFERRED** | 保留旧 finish 的 revision/enabled 隔离、Spent/attempt 去重和 submitted 事实；没有改写 pending 摘要或声称撤回服务端请求。 |

## 保留项

Provider 有效绑定/查询开关/正间隔与 `reserved -> submitted` 同事务、FullRestore tombstone/revision 下界、同锁 quota/generation、固定 `gpt-6-luna`/`low`/`hello`、手动只读查询、one-shot POST/no-retry、T01/T02、R01–R05 结构均未撤回。没有新增 coordinator、ledger、调度器、跨设备系统或 schema。

## 实际测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：59 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation_http --lib -- --nocapture`：13 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml commands::codex_oauth --lib -- --nocapture`：8 passed，含 U01 真实 dispatch/loopback、R01/N02/S01/T02 回归。
- `cargo test --manifest-path src-tauri/Cargo.toml u01_ --lib -- --nocapture`：4 passed（2 个状态负例/正例加 1 个未来边界正例和 1 个真实 dispatch 轨迹）。
- `cargo test --manifest-path src-tauri/Cargo.toml production_stream_parser_handles_utf8_split_and_mixed_delimiters --lib -- --nocapture`：1 passed。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS；仅有既有 dead-code warnings。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `git diff --check`：PASS。

本轮 diff 约束：生产代码新增 141 行、删除 76 行（Spent 可信窗口门槛与增量 SSE 读取）；原生测试新增 461 行、删除 1 行（parser/state/DAO/dispatch/loopback/SSE fake-server）；其余差异为两份验收文档。

本轮没有修改前端，因此未重复运行 Vitest、`pnpm typecheck` 或 `pnpm format:check`；上一轮前端回归证据保留但不作为本轮新增测试。全量 cargo test、clippy、打包、应用启动、WebView/休眠唤醒未运行。审计包中的 `OFFLINE_PROBES.py`、`PROBE_RESULTS.json` 和 `SUGGESTED_U01_TEST.rs` 没有计入 PASS。

## 产品差异、未验证边界与回滚

- U01 对非零基线采取保守证据门槛：缺 Date、缺 countdown 或已过期 reset 不会重新武装；这不影响首次零值策略，也不要求先越过旧边界才记录当前有效使用。
- U02 在完整终态帧后停止读取，不代表撤回已经提交的网络请求；超时/断流/无终态仍为 Unknown，claim 不释放且不补发。
- Luna 线上权限、Responses 兼容性、实际扣费、服务端 reset 生命周期、跨设备时钟、系统 suspend、exactly-once 和真实 Tauri/AppHandle：`UNVERIFIED`/`NOT RUN`。
- 回滚只需回滚本轮源码、测试和验收文档差异；保留 activation 状态、claim、Spent、tombstone 和 revision 行，不删除状态来重新获得资格。

本轮没有 commit、push、PR、Issue、部署或生产操作。
