# 第六轮审计修复清单

审计对象：`d786dfc786da81854038d3c02f00085ca5bf1cfb`
当前 HEAD：未提交的局部修复；真实 OAuth、token、quota、models、generation 均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| U01 过期非零窗口重武装 | FIXED | 过期 5h/weekly-only 负例、未来新边界正例、T01 正常轨迹、parser→临时 DAO→真实 dispatch→loopback sender 均通过。 |
| U02 SSE 完整帧增量终态 | FIXED | 完整成功/失败帧挂起 body、EOF 半帧、UTF-8 跨 chunk、混合分隔符、同批矛盾终态和既有脱敏/one-shot/no-retry 测试通过。 |
| T03 pending 摘要结转 | DEFERRED | 不改变旧 finish revision/enabled 条件，不引入新的 pending 状态协议。 |
| T01/T02、S01–S04、R01–R05、submitted、Luna/Low/hello、one-shot | 保留 | 第五轮已修复结构未撤回；本轮相关 Rust 回归通过。 |
| 真实服务、生产状态和完整 Tauri/WebView 验证 | NOT RUN / UNVERIFIED | 用户明确禁止真实 OAuth、额度、模型、生成及生产数据库操作。 |
