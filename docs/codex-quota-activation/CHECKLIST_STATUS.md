# 第七轮审计修复清单

审计对象：`07a6a14762dbc555db9e2f0593a353ccdf4570c0`

当前 HEAD：同上；本轮保持未提交。真实 OAuth、token、quota、models、generation 和生产数据库均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| V01：所有建立 TrackingUsage 的入口遵守有效非零窗口规则 | **FIXED** | 先有旧实现红灯的 shape-change、missing-countdown 和真实 FullRestore 原生反例；修复后统一谓词，`v01_` 三项通过，`codex_quota_activation` 61 项通过。 |
| U01：过期非零窗口不得重武装 Spent | **FIXED（保留）** | 第六轮状态负例、T01 正例、未来边界正例和真实 dispatch/loopback 测试保留并通过。 |
| U02：SSE 完整帧增量终态 | **FIXED（保留）** | 第六轮 13 项 HTTP 回归保留并通过；半帧 EOF 仍 Unknown。 |
| T01/T02、R01–R05、S01–S04、Provider 提交许可、submitted、tombstone/revision、同锁缓存、Luna/Low/hello、5h 优先、weekly 阻断、one-shot/no-retry | **保留** | 本轮不撤回；相关 Rust 过滤测试通过，未把历史结果冒充新的 provider-live 证据。 |
| T03 pending 摘要结转 | **DEFERRED** | 本轮没有建立新 pending 协议或协调器。 |
| V02 诊断摘要建议 | **DEFERRED** | 不影响 V01 产品行为，本轮不扩展范围。 |
| 前端 Vitest/typecheck/format、全量 cargo/clippy、打包、真实应用/WebView/休眠、provider-live | **NOT RUN / UNVERIFIED** | 用户明确禁止真实 OAuth、额度、模型、生成和生产数据库操作；本轮也没有前端差异。 |

## 交付边界

- 本轮只修改 `codex_quota_activation.rs` 和 `backup.rs` 及对应验收文档。
- 测试使用真实临时 DB、生产 parser/state/DAO/restore/dispatch helper 和 loopback sender；离线探针及未编译草稿不计入 PASS。
- 没有 commit、push、创建 PR、Issue、部署或生产操作。
