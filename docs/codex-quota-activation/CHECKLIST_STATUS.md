# 第三轮审计修复清单

审计对象：`77767e28ecccc6934960540e3001651f5920f633`

当前工作树：未提交的局部修复；真实 OAuth、token、quota、models、generation 均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| R01 FullRestore 缺行 ABA | FIXED | SQL/二进制真实临时 DB restore 写入 tombstone；旧 revision save/claim/submit/finish 拒绝，fake sender=0。 |
| R02 cache invalidate 原子性 | FIXED | quota 与 generation 共用账号 entry lock；single/all 失效与旧 publisher 测试通过。 |
| R03 时间一致性范围 | FIXED | 移除绝对时间量级豁免；T-301/T-100/T+30/T+18000 参数化回归通过。 |
| R04 lastPoll UI 可见性 | FIXED | completed 历史 attempt 与新的 model preflight failure/reason 同时出现在真实组件 DOM。 |
| R05 测试入口 cache/lifecycle | FIXED | UsageScriptModal 真实按钮、QueryClient、deferred test GET 与自动 quota 排序、revision 失效测试通过。 |
| 上轮 N02 submitted 派发点 | 保留 | 未修改；关闭前后 barrier 和 superseded finish 仍通过。 |
| 真实服务请求与生产状态 | NOT RUN | 用户明确禁止真实 OAuth、额度、模型、生成及生产数据库操作。 |
| 服务端协议、扣费、周期与 exactly-once | UNVERIFIED | 没有 live probe 或真实服务验证。 |
| WebView、系统休眠、跨进程崩溃 | NOT RUN | 超出本轮隔离测试边界。 |
