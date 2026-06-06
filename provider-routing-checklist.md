# Provider 组合路由 Checklist

## 一、范围确认

- [ ] 明确 V1 目标客户端范围
  - [ ] 仅 Claude Code / Claude
  - [ ] 还是同时覆盖 Codex / Gemini
- [ ] 明确该功能在产品中的表现形式
  - [ ] 组合 Provider
  - [ ] 不是独立的全局代理规则页
- [ ] 明确 V1 非目标
  - [ ] 不做通配符/正则
  - [ ] 不做单 provider 内多 keyPool 重构
  - [ ] 不改现有 live config 接管机制

## 二、核心设计确认

- [ ] 组合 provider 是否通过 `providerType = "model_router"` 识别
- [ ] 组合 provider 是否只引用已有真实 provider
- [ ] 同 base URL 不同 API Key 是否通过“多个真实 provider”表达
- [ ] 是否要求必须存在 `default` 路由
- [ ] 是否支持两类规则
  - [ ] `exact`
  - [ ] `role`
- [ ] 角色匹配是否至少包含
  - [ ] `opus`
  - [ ] `sonnet`
  - [ ] `haiku`

## 三、数据结构 Checklist

- [ ] Rust `ProviderMeta` 设计完成
- [ ] 前端 `ProviderMeta` 设计完成
- [ ] route target 结构已定义
- [ ] route rule 结构已定义
- [ ] fallback 链结构已定义
- [ ] 老数据兼容策略已定义
- [ ] import/export 序列化策略已定义
- [ ] sync 保真策略已定义

## 四、运行时路由 Checklist

- [ ] 请求进入本地代理后能提取原始 `model`
- [ ] 在模型改写前先判断当前 provider 是否为组合 provider
- [ ] 已定义路由匹配优先级
  - [ ] exact
  - [ ] role
  - [ ] default
- [ ] 命中规则后能解析 target provider
- [ ] 能将请求模型改写为 `upstreamModel`
- [ ] 能继续复用现有 adapter
  - [ ] `base_url` 解析
  - [ ] `auth` 注入
  - [ ] `apiFormat` 转换
- [ ] 当 primary 失败时，按该规则的 fallback 链重试
- [ ] 未命中任何规则时有明确错误信息

## 五、与现有能力的边界 Checklist

- [ ] 组合 provider 与普通 provider 的切换语义已明确
- [ ] 模型级 fallback 与现有 provider failover 的关系已明确
- [ ] 熔断统计是否按真实 provider 维持
- [ ] 当前 provider 状态展示是否保留组合 provider 视角
- [ ] active target 展示是否需要显示真实 provider
- [ ] 不影响非组合 provider 的既有行为

## 六、安全与持久化 Checklist

- [ ] 组合 provider 本身不直接持有多套明文 API Key
- [ ] 真实认证仍保存在真实 provider 中
- [ ] live config 继续使用本地代理占位认证
- [ ] 日志和调试输出已做脱敏设计
- [ ] 导入导出不会泄漏额外认证信息

## 七、前端 UI Checklist

- [ ] Provider 创建流程支持“组合 Provider”类型
- [ ] 组合 provider 表单支持基本信息编辑
- [ ] 支持选择多个真实 provider 作为 target
- [ ] 支持为 target 设置 label
- [ ] 支持编辑 route 规则表
- [ ] 支持编辑 fallback 链
- [ ] 支持 default 规则
- [ ] 支持规则冲突校验
- [ ] 支持缺失 target / provider 的校验
- [ ] 支持最小化的路由预览或测试能力

## 八、测试 Checklist

### Rust
- [ ] 组合 provider 元数据解析测试
- [ ] exact 匹配测试
- [ ] role 匹配测试
- [ ] default 命中测试
- [ ] fallback 链成功测试
- [ ] fallback 全失败测试
- [ ] 普通 provider 回归测试
- [ ] import/export 回归测试

### 前端
- [ ] 组合 provider 创建测试
- [ ] 组合 provider 编辑测试
- [ ] target 选择与校验测试
- [ ] route 表单测试
- [ ] fallback 表单测试
- [ ] proxy takeover 下配置读取测试
- [ ] 普通 provider 编辑回归测试

## 九、文档 Checklist

- [ ] 根目录设计文档已完成
- [ ] 本 checklist 文档已完成
- [ ] 用户手册是否需要新增章节已评估
- [ ] 发布说明需要补充的条目已列出
- [ ] 示例配置已准备

## 十、正式开始编码前最后确认

- [ ] 路由目标是否只允许引用真实 provider
- [ ] 是否接受 V1 只覆盖 Claude Code / Claude
- [ ] 是否接受 V1 不支持通配符/正则
- [ ] 是否接受 V1 先不做 inline credentials
- [ ] 是否接受模型级 fallback 先独立于全局 failover
- [ ] 是否接受 UI 先做最小可用版本

## 建议的开工门槛

建议在以下条件都满足后再开始实现：

- [ ] 设计文档已确认
- [ ] checklist 关键项无重大分歧
- [ ] V1 范围明确
- [ ] 数据结构方案明确
- [ ] 运行时优先级明确
- [ ] fallback 语义明确
- [ ] UI 最小方案明确
