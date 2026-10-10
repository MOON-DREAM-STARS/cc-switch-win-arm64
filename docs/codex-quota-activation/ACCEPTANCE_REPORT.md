# Codex 额度自动预激活：本地修复验收报告

日期：2026-10-11（Asia/Singapore）

审计包：`C:\Users\admin\Downloads\ccswitch-quota-activation-audit-c7a4daf.zip`

审计 HEAD / 本轮起点：`c7a4daf14795a13d07ca297f2a40b6933d202b9d`

功能基线：`5667b287c6e1a8cc54e527bafc3c72d59f312b99`
本轮结束：同一 HEAD，工作树有未提交本地修改；未创建新分支。

## P1 复核结果

| 项目 | 状态 | 证据 |
|---|---|---|
| F01 Provider 间隔读取 | fixed | `derive_codex_quota_activation_interval` 使用真实 `ProviderMeta`/`UsageScript` serde 和 `save_provider`；显式账号、disabled、0、10、模板、多 Provider、多账号测试通过。缺失 `accountId` 不再回退默认账号。 |
| F02 官方模型对象能力 | fixed | 支持 `{effort:"low"}`、字符串兼容、重复/冲突/缺失 effort 原因；模型目录使用流式 2 MiB 上限，loopback 超限测试通过。 |
| F03 关闭与派发边界 | fixed | 自动 tick 保留账号长 guard，开关关闭走短事务；新增 `authorization_revision`（schema v22），每次 await 后、条件 save/claim/finish 和派发前复核；FullRestore/Sync 使旧工作失效；fake barrier/并发 DAO 测试通过。 |
| F04 快照新鲜度 | fixed | freshness 使用观测完成时间和派发前当前时间，检查网络耗时、回退、Date 矛盾；模型等待超过 30 秒、回退和 Date 冲突测试通过。 |
| F05 不可信观察污染状态 | fixed | selector 与 observe 共用可信门；坏 timing、权限冲突、旧边界不能推进 Tracking/Spent；审计 trace 从 TrackingUsage/Spent 和 weekly 阻断专门情况均通过。 |

本轮没有仍确认存在的 P1。命令级完整依赖注入仍较小，实际 fake barrier 主要在 revision/DAO gate 层验证；没有把它扩大成 Coordinator 或测试专用生产路径。

## P2 复核结果

| 项目 | 状态 | 证据 / 限制 |
|---|---|---|
| F06 首次资格 | fixed | weekly 阻断的零值保持 `BootstrapPending`；下一正常 tick 才可成为 Candidate，重复 claim 受限。 |
| F07 权限与额外 bucket | fixed | 顶层/嵌套冲突不再被 `or_else` 遮蔽；未知 additional bucket 保守停止；纯 parser/selector 测试通过。 |
| F08 one-shot HTTP policy | fixed | 锁定 reqwest 0.12.28 的 `retry::never` + no redirect；工厂返回 `Result`，失败不回退默认 client；loopback 重定向/5xx/工厂失败测试通过。普通 GET 未使用该 client。 |
| F09 SSE 与脱敏 | fixed | completed/failed/status 矛盾不算成功；嵌套 error message 提取；HTTP 200 SSE error 在 send→classify 路径脱敏；fake server 测试通过。 |
| F10 Sync / FullRestore | fixed | Sync 保留本机授权/去重并推进 revision；FullRestore 在 staging 可见前暂停并清除旧 attempt 派发资格；SQL/二进制路径和迟到 finish 已覆盖。 |
| F11 单账号 timer / 缓存排序 | fixed / 局部 | 根 hook 为每账号唯一 timer；接管账号的旧 footer 周期查询停止，手动查询保留；`queriedAt` 与 Rust cache 拒绝旧结果。已测缓存排序和现有组件回归；系统休眠、真实 WebView timer 与多分辨率视觉验收未运行。 |
| F12 可见状态 / 单一 cache | fixed / 局部 | 设置区与根 hook 共用 activation query key；保存失败、读取失败、model/quota/poll reason 可见；成功 mutation 立即写 cache。真实 WebView 状态展示未运行。 |
| F13 坏账号隔离 | fixed | 坏 `state_json` 返回 paused/error 行，不阻断其他账号列表；关闭不解码、不重置 Bootstrap；坏账号隔离测试通过。 |

## 实际测试与检查

已执行：

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：40 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_oauth_models --lib -- --nocapture`：10 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml activation_sync_preserves_local_state_but_full_restore_pauses_it --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml migrate_v20_to_v21_adds_local_codex_activation_state --lib -- --nocapture`：1 passed（现 schema v22 迁移链）。
- `cargo test --manifest-path src-tauri/Cargo.toml codex_oauth_cache_rejects_late_older_observation --lib -- --nocapture`：1 passed。
- `pnpm test:unit -- --run tests/hooks/useCodexQuotaAutoPolling.test.ts tests/components/CodexOAuthSection.test.tsx`：23 passed。
- `pnpm typecheck`：PASS。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`pnpm format:check`、`git diff --check`：PASS。

新增/关键测试包含真实 Provider 类型保存→派生 interval→state/claim/fake sender、27 条 `decision_cases.json` 原始解析器/选择器向量、F03 barrier、F04 时钟、F05 boundary rollback、对象模型能力、有界读取、生产 one-shot 工厂、SSE 脱敏、Sync/FullRestore 和坏状态隔离。旧实现失败证据已在本地测试先行阶段记录：F01/F02/F04/F05 与迟到 finish 测试均曾红灯，修复后通过。

## 产品差异、未运行和协议边界

- UI 仍位于认证中心区域，未迁回官方订阅卡片；账号级开关、共享状态和红色警示保持在现有轻量区域。
- 固定请求仍为 `gpt-6-luna` / `reasoning.effort=low` / `hello`。请求构造依据和 fixture 已固定；Luna 线上权限、标准 Responses 兼容性、真实消耗量化、reset 生命周期和 exactly-once：`UNVERIFIED`。
- 本轮真实 OAuth、token 刷新、额度、模型目录、生成请求：`NOT RUN`。测试只使用临时 SQLite、假 token/workspace 和 `127.0.0.1` loopback fake server；未读取或修改生产 token、auth.json、CODEX_HOME、Provider 或生产数据库。
- Windows WebView 截图、系统休眠/唤醒、签名安装和部署：`NOT RUN`。

## 变更职责与回滚

- Rust 状态/解析：`src-tauri/src/services/codex_quota_activation.rs`、`codex_oauth_models.rs`、`codex_quota_activation_http.rs`。
- OAuth 自动入口、revision gate 和账号锁：`src-tauri/src/commands/codex_oauth.rs`、`commands/auth.rs`、`database/dao/codex_quota_activation.rs`、schema v22。
- 备份/同步、缓存和额度时间语义：`database/backup.rs`、`services/subscription.rs`、`services/usage_cache.rs`、`proxy/http_client.rs`。
- 根轮询、单一状态 cache、footer 接管和 UI 文案：`src/hooks/useCodexQuotaAutoPolling.ts`、`CodexOauthQuotaFooter.tsx`、`CodexOAuthSection.tsx`、四语言 locale。

回滚方式：关闭账号开关即可停止自动入口；不要删除本地 claim/state。代码回滚时保留 schema v22 表和行，普通只读额度查询仍可用。没有 commit、push、PR、Issue、部署或生产操作。

最终验收句：**有 5h 只看 5h 触发，只有 weekly 才看 weekly；周额度剩余为零不发送；复用同一次新鲜只读额度查询；由单独授权自动入口按账号持久化去重后发送一次 Luna/Low/hello。**
