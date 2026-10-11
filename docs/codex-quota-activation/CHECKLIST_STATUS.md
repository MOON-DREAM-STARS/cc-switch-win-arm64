# 第四轮审计修复清单

审计对象：`c202b4fc879d8265ee4e6970104f0572946d1470`
当前 HEAD：未提交的局部修复；真实 OAuth、token、quota、models、generation 均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| S01 Provider 配置与 submitted 原子边界 | FIXED | 同一 SQLite transaction 重新解析真实 ProviderMeta/UsageScript；真实 save_provider + barrier + loopback sender 测试通过。 |
| S02 可信额度耗尽观测 | FIXED | 有效 exhaustion 只记录非零历史并保持 Blocked；冲突/非法响应不改变状态；Spent rearm 回归通过。 |
| S03 Date/本机/单调时间一致性 | FIXED | HTTP Date 校验窗口，单调 age，缺 Date 保守拒绝；±60 秒、8 秒延迟、T-301/T+30 回归通过。 |
| S04 后端 superseded 结果 | FIXED | generation 拒绝返回 `lifecycle=superseded`；QueryClient、自动 query 和官方测试入口不发布该结果；UI 回归通过。 |
| R01–R05、submitted、Luna/Low/hello、one-shot | 保留 | 第三轮已修复结构未撤回；本轮 `codex_quota_activation` 全部 46 tests 通过。 |
| 真实服务、生产状态和完整 Tauri 端到端 | NOT RUN / UNVERIFIED | 用户明确禁止真实 OAuth、额度、模型、生成及生产数据库操作。 |
