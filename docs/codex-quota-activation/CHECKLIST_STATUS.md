# 第二轮审计修复清单

审计对象：`85647d116cb10fcaabb0994d8185d521fbd54d60`

当前工作树：未提交的局部修复；真实 OAuth/额度/模型/生成请求均 `NOT RUN`。

| 项目 | 状态 | 核查依据 |
|---|---|---|
| N01 Sync revision / FullRestore ABA | FIXED | 真实 sync import + old save/claim/finish gate；低 revision restore 后重新开启不复用旧 revision。 |
| N02 dispatch linearization | FIXED | 生产 dispatch helper + loopback sender；关闭先提交为 0 POST，派发点后允许 1 个在途且 finish stale。 |
| N03 timing consistency | FIXED | 真实 epoch 矛盾 timing、Bootstrap、weekly exhausted、Tracking/Spent 回归。 |
| N04 permission conflict | FIXED | parser/selector conflict marker、invalid alias、nested/top-level conflict。 |
| N05 poll vs attempt | FIXED | QueryClient、自动 timer、invalidate/refetch 后 model_unavailable 可见；non-attempt 不覆盖 lastAttempt。 |
| N06 late GET/finish | FIXED | UsageCache generation、superseded finish、FullRestore/close DAO 回归；真实服务端竞态 `NOT RUN`。 |
| N07 all quota writers ordering | FIXED | 两个 deferred promise 的真实 QueryClient M<A/A<M。 |
| N08 corrupt account disable | FIXED | `CodexOAuthSection` 实际 UI 点击坏账号开关调用 false；不重建 Bootstrap。 |
| 真实 OAuth / token refresh / quota / model catalog / generation | NOT RUN | 用户明确禁止，只有 fake token 与 127.0.0.1 loopback。 |
| Luna 线上协议、扣费与 exactly-once | UNVERIFIED | 源码/fixture 证据不足，未执行 live probe。 |
| WebView、系统休眠、跨进程崩溃 | NOT RUN | 需要生产运行时，超出本轮隔离测试。 |
