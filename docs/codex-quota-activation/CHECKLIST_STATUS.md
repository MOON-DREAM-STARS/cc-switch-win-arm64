# 第五轮审计修复清单

审计对象：`a79aa598ae0854489088f3973d004c5b5c5dfc0f`
当前 HEAD：未提交的局部修复；真实 OAuth、token、quota、models、generation 均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| T01 Spent 本窗口非零基线 | FIXED | 5h 正常、5h 耗尽、weekly-only 的 parser/state 连续窗口回归通过；旧边界前非零进入 Tracking，边界后零才 Candidate。 |
| T02 自动 publication 失效传播 | FIXED | cache writer 结果枚举、生产自动 publication barrier、临时 DB invalidate、无 quota superseded 返回、旧前端 revision QueryClient/root hook 回归均通过。 |
| T03 pending 摘要结转 | DEFERRED | 保留 revision/enabled finish 隔离和去重事实；未改变 pending 显示语义，避免把非阻断 P3 扩大为新状态协议。 |
| S01–S04、R01–R05、submitted、Luna/Low/hello、one-shot | 保留 | 第四轮已修复结构未撤回；本轮 `codex_quota_activation` 50 tests、commands 7 tests 通过。 |
| 真实服务、生产状态和完整 Tauri/WebView 验证 | NOT RUN / UNVERIFIED | 用户明确禁止真实 OAuth、额度、模型、生成及生产数据库操作。 |
