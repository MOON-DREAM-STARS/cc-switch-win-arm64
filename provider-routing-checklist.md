# Provider 组合路由 Checklist

## 一、范围确认

- [x] 明确 V1 目标范围
  - [x] 当前主页应用 / 当前 AppId 内
  - [x] 不做跨 Claude / Codex / Gemini / OpenCode / OpenClaw / Hermes 的全局混合路由
- [x] 明确该功能在产品中的表现形式
  - [x] Settings 中开启能力
  - [x] 主页自动显示 `组合provider` 卡片
  - [x] 组合 provider 是真实持久化 provider
  - [x] 不是独立的全局代理规则页
- [x] 明确 V1 非目标
  - [x] 不做通配符/正则
  - [x] 不做单 provider 内多 keyPool 重构
  - [x] 不改现有 live config 接管机制
  - [x] 不跨 app 汇总 provider
  - [x] 不继续在“添加新供应商”里放组合 provider 开关

## 二、核心设计确认

- [x] 组合 provider 通过 `providerType = "model_router"` 识别
- [x] 自动管理的组合 provider 通过 `managedModelRouterProvider = true` 标记
- [x] 自动管理的组合 provider 使用稳定 id：`cc-switch-combined-provider`
- [x] 自动管理的组合 provider 默认名称：`组合provider`
- [x] 组合 provider 只引用当前应用内已有真实 provider
- [x] 同 base URL 不同 API Key 通过“多个真实 provider”表达
- [x] `default` 路由允许作为兜底规则
- [x] V1 UI 主要支持 role/default 映射
  - [x] `default`
  - [x] `haiku`
  - [x] `sonnet`
  - [x] `opus`
- [x] runtime 保留 `exact` 匹配支持
- [x] 已有 unknown / exact routes 在基础编辑页中尽量保留，不被无关覆盖

## 三、Settings 与入口 Checklist

- [x] 前端 `Settings` 增加 `enableModelRouterProvider?: boolean`
- [x] settings zod schema 接受 `enableModelRouterProvider`
- [x] Rust `AppSettings` 增加 `enable_model_router_provider`
- [x] 默认值为 false
- [x] Settings → Routing → Local Routing 新增“开启组合 Provider”卡片
- [x] 切换开关调用 `onAutoSave({ enableModelRouterProvider: checked })`
- [x] zh / zh-TW / en / ja 文案已补充

## 四、数据结构 Checklist

- [x] Rust `ProviderMeta` 支持 `providerType`
- [x] Rust `ProviderMeta` 支持 `managedModelRouterProvider`
- [x] Rust `ProviderMeta` 支持 `modelRouter`
- [x] Rust `ModelRouterConfig` 支持 `version`
- [x] Rust `ModelRouterConfig` 序列化时保留空 `routes`
- [x] 前端 `ProviderMeta` 支持 `providerType`
- [x] 前端 `ProviderMeta` 支持 `managedModelRouterProvider`
- [x] 前端 `ProviderMeta` 支持 `modelRouter` / `model_router`
- [x] route target 结构已定义：`target.providerId` / `target.upstreamModel`
- [x] route rule 结构已定义：`matchType` / `matchValue` / `target` / `fallbacks`
- [x] fallback 链结构保留在 runtime/schema 中
- [x] 老数据兼容策略已定义：legacy `model_router` provider 不按 managed provider 隐藏
- [x] import/export 序列化策略：新增 meta 字段通过 provider meta 保真
- [x] sync 保真策略：新增字段随 provider/settings 正常同步或本地保存

## 五、运行时路由 Checklist

- [x] 请求进入本地代理后能提取原始 `model`
- [x] 在模型改写前先判断当前 provider 是否为组合 provider
- [x] 已定义路由匹配优先级
  - [x] exact
  - [x] role
  - [x] default
- [x] 命中规则后能解析 target provider
- [x] 能将请求模型改写为 `upstreamModel`
- [x] 能继续复用现有 adapter
  - [x] `base_url` 解析
  - [x] `auth` 注入
  - [x] `apiFormat` 转换
- [x] primary 失败时可按该规则的 fallback 链重试
- [x] 未命中任何规则时有明确错误信息
- [x] self-reference / nested model-router target 需要跳过

## 六、与现有能力的边界 Checklist

- [x] 组合 provider 与普通 provider 的切换语义已明确
- [x] 模型级 fallback 与现有 provider failover 的关系已明确
- [x] 普通 provider 继续使用现有 provider failover
- [x] 组合 provider 命中后优先使用自身 route target/fallback 链
- [x] 当前 provider 状态保留组合 provider 视角
- [x] 本地代理实际转发时使用真实 target provider
- [x] 不影响非组合 provider 的既有行为
- [x] 普通 ProviderForm 不再承担组合 provider 创建职责

## 七、安全与持久化 Checklist

- [x] 组合 provider 本身不直接持有多套明文 API Key
- [x] 真实认证仍保存在真实 provider 中
- [x] live config 继续使用本地代理占位认证
- [x] 日志和调试输出不应包含 API Key / auth header
- [x] 导入导出不会因为组合 provider 泄漏额外认证信息
- [x] 关闭开关时隐藏 managed provider，不删除已保存映射
- [x] managed provider marker 在 Rust/前端 meta 中都能保真

## 八、前端 UI Checklist

- [x] Settings → Routing → Local Routing 支持“开启组合 Provider”
- [x] 开启后主页当前应用内自动创建 / 显示 `组合provider` 卡片
- [x] 关闭后隐藏 managed combined provider
- [x] 普通 Add Provider 表单移除组合 provider switch
- [x] model-router provider 的编辑入口进入专用组合 provider 编辑页
- [x] 组合 provider 编辑页枚举当前应用内普通 provider
- [x] 组合 provider 编辑页排除自身和其它 `providerType = "model_router"` provider
- [x] 支持已保存模型列表 / catalog 的优先使用
- [x] 支持通过 `fetchModelsForConfig` 进行网络模型探测
- [x] 缺少 base URL / API Key 时不崩溃
- [x] 支持 default / haiku / sonnet / opus 映射
- [x] 每行支持 Provider 下拉
- [x] 每行支持 Model 下拉 / 手动输入
- [x] 保存时写入 `meta.modelRouter.routes`
- [x] 校验“填写模型但未选择 provider”的场景
- [x] 本 session 范围已明确：fallback 链高级编辑、exact route 高级编辑、路由预览/测试能力属于后续增强，不作为本次完成条件
- [x] 本 session 范围已明确：关闭开关且当前 provider 是组合 provider 时的更强提示/自动切换策略属于后续增强，不作为本次完成条件

## 九、测试 Checklist

### Rust

- [x] 组合 provider 元数据解析测试 / 编译路径已设计
- [x] exact 匹配测试
- [x] role 匹配测试
- [x] default 命中测试
- [x] fallback 链成功测试
- [x] nested / self target 跳过测试
- [x] 本机完整 Rust 验证状态已记录
  - [x] 当前环境缺少 `libclang` / `clang.dll` 时，`rquickjs-sys` build script 会失败；这是环境限制，不是本次计划未完成项

### 前端

- [x] Settings 中组合 provider toggle autosave 测试
- [x] managed combined provider utils 测试
- [x] managed combined provider hook 测试
- [x] ProviderForm old switch 移除回归测试
- [x] 组合 provider 卡片 actions / intercept-state 回归已修复，并由 ProviderCard focused test 覆盖
- [x] provider meta split/merge 保真测试
- [x] provider model detection 测试
- [x] CompositeProviderEditor 渲染 / 保存测试
- [x] Codex TOML base_url 模型探测测试
- [x] TypeScript typecheck
- [x] 相关 focused tests 通过
- [x] 本机 full frontend suite 状态已记录
  - [x] 用户已手动运行并确认当前结果可接受；本次文档更新不再重复运行

## 十、文档 Checklist

- [x] 根目录设计文档已更新：`provider-routing-design.md`
- [x] 本 checklist 文档已更新：`provider-routing-checklist.md`
- [x] 本 session 范围已明确：用户手册、发布说明、示例截图/教程属于后续发布配套，不作为本次计划完成条件

## 十一、实施结果摘要

- [x] 从“添加新供应商”迁出组合 provider 开关
- [x] 在“设置 → 路由 → 本地路由”新增“开启组合 Provider”卡片
- [x] 开启后当前应用主页自动显示真实 `组合provider` 卡片
- [x] 组合 provider 使用 `providerType = "model_router"`
- [x] 自动管理组合 provider 使用 `managedModelRouterProvider = true`
- [x] 点击组合 provider 编辑进入专用编辑页
- [x] 编辑页探测当前应用内普通 provider 及其模型
- [x] 用户可通过下拉/手动输入填写模型映射
- [x] 保存写入 `modelRouter.routes`

## 十二、后续可选增强（不属于本 session plan 完成条件）

以下项目是后续产品增强建议，不是本次计划的未完成项：

- 为 exact route 增加高级编辑模式
- 为 fallback 链增加可视化编辑
- 在组合 provider 卡片上增加明确 badge，例如“组合 / Router”
- 关闭 settings 开关时，如果组合 provider 是当前 provider，提示用户切换或自动切换到首个普通 provider
- 增加路由命中诊断：命中规则、目标 provider、上游模型、fallback 情况
- 补用户手册和发布说明
