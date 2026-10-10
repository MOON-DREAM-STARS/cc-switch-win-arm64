# Checklist 实际状态

对应交接包 `CHECKLIST.md` v2.0。状态只记录本轮真实证据；没有把旧 PR 数字当作本轮结果。

| 区域 | 状态 | 证据 |
|---|---|---|
| G0 基线、工作树和禁止真实服务操作 | PASS | 起点 HEAD=`c7a4daf14795a13d07ca297f2a40b6933d202b9d`，当前分支与工作树范围已核对；本轮无 commit/push/PR/生产请求。 |
| F01–F05 P1 | PASS | 40 项 activation/DAO/HTTP 测试；Provider serde、模型对象、revision barrier、freshness、boundary rollback 旧实现红灯后修复通过。 |
| B01–B08 选择、精度、窗口结构和阻断 | PASS | 27 条 `decision_cases.json` 经过真实 parser/selector；严格 0/0.001/0.1、5h 优先、weekly 耗尽和坏窗口覆盖。 |
| C01–C06 查询与精度 | PASS | 同一次 usage GET 返回显示 DTO + 私有 snapshot；queriedAt 以请求观察语义排序；普通只读命令不进入 sender。 |
| D01–D14 状态生命周期/DB | PASS / 局部 | Bootstrap/Tracking/Eligible/Spent/AwaitingBaseline、schema v22 revision、条件 claim/finish、reserved→unknown、坏行隔离、Sync/FullRestore 测试通过；跨进程崩溃演练未运行。 |
| E01–E12 并发、HTTP、SSE | PASS / 局部 | 同账号并发、fake barrier、no retry/redirect、bounded body、矛盾终态、HTTP 200 脱敏和 loopback 计数通过；真实服务端兼容性 UNVERIFIED。 |
| F01–F06 根轮询生命周期 | PASS / 局部 | 根 hook 账号 timer、间隔 0 暂停、footer 接管和 cache 排序已实现；系统休眠/唤醒、实际 WebView timer 未运行。 |
| F07–F10 UI、警示、状态可见性 | PASS / 局部 | 统一 query key/mutation、失败状态可见、固定模型/Low/hello 红色文案、四语言、Switch aria-label；未做 WebView 截图和多分辨率验收。 |
| F11–F13 集成修复 | PASS / 局部 | timer/cache 乱序、Sync/FullRestore、坏账号隔离已覆盖；真实 WebView/系统级生命周期 NOT RUN。 |
| G01–G06 交付边界 | PASS | 命令、测试数、未运行边界和职责写入 `ACCEPTANCE_REPORT.md`；无依赖升级、无 commit/push/PR/deploy。 |

## NOT RUN / UNVERIFIED

- 真实 OAuth、额度、模型、生成请求：`NOT RUN`。
- Luna 线上权限、实际 Responses 兼容性、真实消耗量化、reset 生命周期和 exactly-once：`UNVERIFIED`。
- 生产安装/签名、Windows WebView 截图、多分辨率视觉验收、系统休眠/唤醒：`NOT RUN`。
