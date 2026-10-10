# Codex 额度自动预激活：本地实施验收报告

日期：2026-10-10（Asia/Singapore）
基线：`main` / `5667b287c6e1a8cc54e527bafc3c72d59f312b99`
范围：本地源代码、临时内存数据库、合成额度向量和 loopback fake server。

## 1. 已实现的行为

- 额度读取在保留 `SubscriptionQuota` 显示 DTO 的同时，保留同一次 `/wham/usage` GET 的私有原始快照；手动额度命令没有进入激活发送路径。
- 选择器严格按窗口秒数识别 5h（18000）和 weekly（604800）。存在有效 5h 时只选择 5h；只有确认没有 5h 时才选择 weekly。损坏的 5h、缺失 weekly、未知窗口和权限字段不明均 fail closed。
- weekly 已用达到 100% 时只返回阻断，不 claim、不做模型准备、不发 POST。候选值严格为原始 `used_percent == 0.0`，`0.001` 和 `0.1` 保留为非零观察。
- 自动请求固定为 `gpt-6-luna`、`reasoning.effort=low`、`hello`，无工具、无历史、`store=false`、`stream=true`，并使用账号对应的 Bearer/workspace header。响应只有明确 `response.completed` 才算完成；EOF、断流、5xx、超时、矛盾终态和重定向均不会重发。
- 新增本地账号状态表和有限状态 JSON。状态在 claim 前写入，按账号 try-lock 和 SQLite 条件更新实现 at-most-once；成功、失败和未知都保留 attempt。进程启动会把遗留 reserved 标为 unknown，恢复/全量导入会关闭授权并要求重新建立基线；同步导出排除该表并在同步导入时保留本机行。
- 根级 React hook 为启用账号建立独立 timer，使用后端重新派生的最短正间隔；间隔为 0、无绑定或全部 usage 关闭时暂停。授权中心显示账号级开关和红色说明，四种语言均有文案。

## 2. 实际验证

| 命令 | 结果 |
|---|---|
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib` | PASS，16 tests |
| `cargo test --manifest-path src-tauri/Cargo.toml migrate_v20_to_v21 --lib` | PASS，1 migration test |
| `cargo test --manifest-path src-tauri/Cargo.toml codex_oauth_models --lib` | PASS，6 tests |
| `pnpm typecheck` | PASS |
| `pnpm format:check` | PASS |
| `pnpm test:unit -- --run tests/components/CodexOAuthSection.test.tsx` | PASS，21 tests |
| `git diff --check` | PASS |

Rust 测试实际覆盖合成 `decision_cases.json` 的 27 个选择向量、精度、5h/weekly 结构、weekly 阻断、损坏窗口、重复零值、重新武装、SQLite claim、间隔为零、启动后未知状态、v20→v21 migration、固定请求体、SSE 终态、错误脱敏，以及 loopback server 的重定向/5xx 单 POST 计数。

## 3. 未运行与证据边界

- 本轮真实 OAuth、真实 token 刷新、真实额度查询、真实模型列表和真实生成请求：**NOT RUN**。
- 生产 endpoint 只作为产品常量存在；fake-server 测试使用 `127.0.0.1`、假 token、假 workspace 和临时内存数据库。
- 服务端实际 Luna 权限、真实 reset 生命周期、真实消耗后的百分比量化和服务端 exactly-once：**UNVERIFIED**。
- Windows WebView 多分辨率视觉验收、系统休眠/唤醒和签名安装：**NOT RUN**。

## 4. 偏离与限制

- 当前实现把最后一次状态摘要放在同一账号状态表中，没有增加历史页面、费用账本、Provider owner 或独立后台 daemon。
- 轮询 hook 使用正常间隔建立 `setInterval`，不回放错过的周期；后端每次仍重新核对绑定和间隔，前端传入的 interval 不作为授权依据。
- 完整的生产服务端兼容性仍需在未来获得单独授权后验证；本轮不得用旧 PR 或旧 live probe 代替该证据。

## 5. 回滚

关闭账号开关即可停止自动入口；保留的本地 claim 不应删除。代码回滚时保留数据库表和状态数据，现有只读额度查询继续可用。未执行 commit、push、PR、部署或生产数据操作。

最终验收句：**有 5h 只看 5h 触发，只有 weekly 才看 weekly；周额度剩余为零不发送；复用同一次新鲜只读额度查询；由单独授权自动入口按账号持久化去重后发送一次 Luna/Low/hello。**
