# Checklist 实际状态

对应交接包 `CHECKLIST.md` v2.0。状态只记录本轮真实证据；没有把旧 PR 数字当作本轮结果。

| 区域 | 状态 | 证据 |
|---|---|---|
| G0 基线、工作树和禁止真实服务操作 | PASS | 当前 HEAD/分支/工作树已核对；无 commit、push、PR、生产请求 |
| B01–B07 选择、精度、窗口结构和阻断 | PASS | `decision_cases.json` 真实解析器/选择器测试；Rust 16 tests |
| B08 后端重新检查账号、开关和间隔 | PASS | 自动 IPC 重新派生绑定间隔并检查本地 enabled；前端 interval 不授权 |
| C01–C06 查询复用和只读路径 | PASS | `query_codex_quota_with_snapshot` 与旧 wrapper 共用一次 usage GET；缓存只写 quota |
| D01–D06 状态生命周期 | PASS | Bootstrap/Tracking/Eligible/Spent/AwaitingBaseline 单元测试；严格零值和边界检查 |
| D07–D14 本地表、claim、重启、同步、恢复 | PASS / 局部 | 本地表、条件 claim、reserved→unknown、sync skip/preserve、full restore pause 已实现并有 DAO 测试；跨进程数据库损坏恢复仍未做平台演练 |
| E01–E12 并发、请求和失败 | PASS / 局部 | 账号锁、无 retry/redirect、SSE 终态、脱敏和 fake server 已测；真实 HTTP 兼容性 UNVERIFIED |
| F01–F06 根轮询生命周期 | PASS / 局部 | 根 hook、账号级 interval、0 暂停、StrictMode 清理路径已实现；系统休眠/唤醒 NOT RUN |
| F07–F10 UI、警示、四语言、可访问性 | PASS / 局部 | 账号开关、红色警示、四语言、Switch aria-label；未做 WebView 截图验收 |
| G01–G06 交付边界 | PASS | 本报告记录实际命令；真实请求 NOT RUN；diff 无无关依赖升级；无外部发布 |

## NOT RUN / UNVERIFIED

- 真实 OAuth、额度、模型、生成请求：`NOT RUN`。
- 服务端实际模型权限、消耗量化、reset 生命周期和 exactly-once：`UNVERIFIED`。
- 生产安装、签名、系统休眠和多分辨率视觉验收：`NOT RUN`。
