# Provider 组合路由设计

## 背景

cc-switch 当前已经具备本地代理与本地路由能力，但整体心智仍然偏向：

- 一个 provider 对应一套上游配置
- 一个 provider 对应一套认证信息
- 当前 app 只有一个激活 provider
- failover 主要是 provider 级别的顺序切换

这套模型足以覆盖“在多个 provider 之间切换”，但不足以覆盖更细粒度的“同一次本地代理接管下，按模型把请求分发到不同 provider 或不同 API Key”的需求。

典型场景：

- `opus` 请求走 Kiro 渠道的 `Claude Opus 4.8`
- `sonnet` 请求走 GPT 渠道的 `gpt-5.4`
- `haiku` 请求走另一个 provider 的 `gpt-5.4 mini`
- 同一域名下，不同渠道的 API Key 完全独立

因此，需要在现有本地代理能力之上，新增一个“模型级路由层”。

---

## 目标

新增一个可在 cc-switch 中管理的 **组合 Provider（Router Provider）**，在开启本地路由后：

1. 根据请求模型或角色模型进行路由
2. 将请求分发到不同真实 provider
3. 支持同一 base URL 下不同 API Key 的目标拆分
4. 支持每条模型路由配置自己的 fallback 链
5. 复用现有本地代理、格式转换、认证注入、熔断和统计能力

---

## 非目标

V1 暂不覆盖以下内容：

1. 不直接重构全量 app 的路由体系，优先围绕 Claude Code / Claude 生态设计
2. 不在 V1 内引入通配符或正则级模型匹配
3. 不在 V1 内把多个 API Key 直接塞进单个普通 provider 表单
4. 不改变现有客户端 live config 的接管机制
5. 不替换现有 provider 级 failover 队列的通用逻辑

---

## V1 范围

V1 推荐聚焦：

- Claude Code / Claude 本地路由
- 角色模型路由：`opus` / `sonnet` / `haiku` / `default`
- 精确模型名匹配
- 模型级 fallback 链
- 组合 provider 引用已有真实 provider

V1 中，同一 `base_url` 下不同 API Key 的需求，建议通过“创建多个真实 provider”表达，例如：

- `ai98pro-kiro`
- `ai98pro-gpt-plus`
- `another-provider-mini`

组合 provider 只负责引用它们，而不直接保存多套认证。

---

## 用户心智模型

推荐将该能力设计为新的 provider 形态：

- 普通 provider：真实上游，持有 base URL、API Key、模型配置
- 组合 provider：虚拟 provider，不直接请求上游，只负责模型路由

用户在 UI 中切换到组合 provider 后：

- 客户端仍只知道“当前激活的是一个 provider”
- live config 仍然指向本地代理
- 真正转发时，由本地代理根据模型规则选择真实 provider

这比“在代理设置页维护一套全局路由表”更贴近当前 cc-switch 的 provider 管理心智，也更容易和现有切换逻辑兼容。

---

## 示例

### 示例 1：Claude Code 混合路由

真实 provider：

- `ai98pro-kiro`
  - 上游模型：`claude-opus-4.8`
  - 认证：Kiro 渠道 API Key
- `ai98pro-gpt-plus`
  - 上游模型：`gpt-5.4` / `gpt-5.5`
  - 认证：GPT 渠道 API Key
- `mini-provider`
  - 上游模型：`gpt-5.4-mini`
  - 认证：另一家 provider 的 API Key

组合 provider：`claude-code-router`

路由规则：

- `opus` -> `ai98pro-kiro` / `claude-opus-4.8`
- `sonnet` -> `ai98pro-gpt-plus` / `gpt-5.4`
- `haiku` -> `mini-provider` / `gpt-5.4-mini`
- `default` -> `ai98pro-gpt-plus` / `gpt-5.4`

---

## 为什么不优先做“单 provider 多 keyPool”

虽然“一个 provider 里挂多套 key”看起来更直接，但它会显著扩大改造范围：

- 前端 `ProviderForm` 目前是单 key 表单状态
- `providerConfigUtils` 默认按单 key 读写
- 模型抓取逻辑默认 `baseUrl + apiKey` 一对一
- Rust adapter 的认证提取逻辑默认一个 provider 解析一套认证
- 用量查询、导入导出、复制 provider、测速和健康检查都基于单 provider 假设

因此，V1 更稳妥的方案是：

**真实 provider 继续保持“一 provider 一套认证”，组合 provider 只做路由编排。**

这能减少对现有 provider 生态的侵入，也更便于逐步演进。

---

## 数据模型草案

### 1. 组合 Provider 标识

在 `ProviderMeta` 中新增标识，例如：

- `providerType: "model_router"`

用于表示该 provider 是虚拟路由 provider，而非真实上游 provider。

### 2. 路由目标

组合 provider 需要一组目标定义，每个目标通常引用一个已有 provider。

建议结构：

- `targets[]`
  - `id`
  - `providerId`
  - `label`

说明：

- `providerId` 指向现有真实 provider
- `label` 仅用于 UI 展示和调试
- V1 不建议在 target 中直接保存明文 API Key

### 3. 路由规则

建议结构：

- `routes[]`
  - `matchType`
    - `role`
    - `exact`
    - `default`
  - `matchValue`
    - `opus` / `sonnet` / `haiku`
    - 或完整模型名
  - `targetId`
  - `upstreamModel`
  - `fallbacks[]`

其中：

- `targetId` 指向一个 target
- `upstreamModel` 表示发往该 target 时真正使用的模型名
- `fallbacks[]` 表示该规则失败后的后续目标链

### 4. default 规则

必须允许存在一条 `default` 规则，用于兜底未命中的请求。

---

## 路由匹配优先级

推荐优先级：

1. 精确模型名匹配
2. 角色模型匹配：`opus` / `sonnet` / `haiku`
3. `default`
4. 若仍未命中，则返回明确错误

说明：

- 精确模型名适合覆盖特殊别名或特定路由
- 角色模型匹配最贴近 Claude Code 的典型使用方式
- `default` 用作安全兜底

---

## 运行时方案

### 总体原则

组合 provider 的核心路由决策必须发生在 Rust 本地代理层，而不是前端。

原因：

- 真正的请求转发发生在 Rust
- 认证注入、格式转换、熔断和重试也在 Rust
- 前端只适合编辑配置，不适合承载运行时路由逻辑

### 推荐执行顺序

1. 请求进入本地代理
2. 提取请求中的 `model`
3. 判断当前激活 provider 是否是组合 provider
4. 若不是，走现有逻辑
5. 若是，执行模型路由匹配
6. 生成目标 provider 链
7. 对每个目标：
   - 找到真实 provider
   - 将请求模型改写为对应 `upstreamModel`
   - 复用现有 adapter 做 base URL / auth / format 转换
8. 若 primary 失败，按该规则自己的 fallback 链重试

---

## 与现有 failover 的关系

建议将两者分层：

### 模型级 fallback

- 属于组合 provider 内部语义
- 每条路由规则可独立配置 fallback 链
- 例如：
  - `sonnet: gpt-5.4 -> gpt-5.5`

### provider 级 failover

- 属于现有通用能力
- 继续服务普通 provider 场景
- V1 中不建议默认把两者混合成一套规则

### 推荐策略

V1 先定义为：

- 组合 provider 命中后，优先只走该模型规则自己的目标链
- 普通 provider 继续使用现有 failover 队列

这样行为最可预测。

---

## 安全边界

### 1. 真实认证仍留在真实 provider 中

组合 provider 不直接持有多套 API Key，避免：

- 导入导出复杂化
- UI 表单暴露过多敏感信息
- 本地持久化安全边界变模糊

### 2. live config 继续使用本地代理占位认证

现有 `PROXY_MANAGED` 机制保持不变：

- 客户端配置仍只写本地代理地址和占位 token
- 真正请求上游时，再由本地代理注入目标 provider 的真实认证

### 3. 调试信息需注意脱敏

后续若增加命中路由、目标 provider、fallback 链诊断信息：

- 不应直接输出 API Key
- 不应输出完整认证头
- 仅输出 target label / provider name / upstream model

---

## UI 设计建议

### V1 最小可用方案

新增一种 provider 创建方式：

- 普通 provider
- 组合 provider

组合 provider 编辑器建议包含：

1. 基本信息
   - 名称
   - 备注
2. 路由目标列表
   - 选择已有 provider
   - 为目标设置展示标签
3. 路由规则表
   - 匹配类型
   - 匹配值
   - 目标 provider
   - 上游模型
   - fallback 链
4. 默认规则
5. 路由测试 / 预览能力

### 为什么不放侧栏新入口

建议先沿用 provider 管理入口，不新增额外顶层导航。这样：

- 不打断当前信息架构
- 不扩大用户理解成本
- 更容易和现有 provider 增删改查流程融合

---

## 可复用现有实现的部分

当前仓库里可以直接借鉴的能力：

1. `claude_desktop_model_routes`
   - 已有显式路由表模式
   - 适合借鉴“用户维护多条 route”的编辑体验
2. `model_mapper`
   - 已有 `haiku` / `sonnet` / `opus` 角色识别逻辑
3. `provider_router`
   - 已有 provider 链选择、熔断和 failover 框架
4. `forwarder`
   - 已有 per-provider 尝试、统计、错误处理、格式转换、认证注入

需要注意的是：

- 现有 `model_mapper` 偏“在单 provider 内改写模型名”
- 新方案需要先决定“用哪个 provider”，再改写上游模型名
- 顺序上不能简单套用旧逻辑

---

## 兼容性要求

1. 老 provider 数据必须继续可用
2. 没有组合 provider 时，系统行为不能变化
3. 导入导出时，新增字段必须保真
4. 同步、复制、排序、备注、图标等通用 provider 能力应继续工作
5. takeover 开关与当前 provider 切换逻辑应保持兼容

---

## 观察与诊断

建议后续增加以下调试能力：

1. 当前命中的路由规则
2. 实际命中的目标 provider
3. 实际使用的上游模型
4. 是否发生 fallback
5. fallback 成功或失败原因

这对排查“为什么 sonnet 走到了 gpt-5.4 而不是 opus provider”非常关键。

---

## 后续实施建议

### Phase 0：先文档

先完成：

- 本设计文档
- checklist 文档

### Phase 1：数据结构

扩展：

- Rust `ProviderMeta`
- 前端 `ProviderMeta`
- 导入导出与同步保真

### Phase 2：运行时路由

新增模型级路由器，并接入现有代理转发链。

### Phase 3：前端配置 UI

提供组合 provider 编辑器。

### Phase 4：验证与文档补充

补测试、诊断、用户手册与发布说明。

---

## 需确认事项

以下事项在正式编码前建议再次确认：

1. V1 是否仅聚焦 Claude Code / Claude
2. target 是否必须引用已有 provider
3. V1 是否允许 inline credentials
4. V1 是否需要支持通配符匹配
5. 模型级 fallback 是否完全独立于现有 failover
6. UI 是否先做最小版本，不追求一次性覆盖所有 app

---

## 结论

推荐路线是：

- 新增 **组合 Provider**，而不是重写普通 provider 结构
- 让本地代理承担模型级路由决策
- 让真实 provider 继续保持“单 provider 单认证”
- 先支持 Claude Code 最典型的 `opus / sonnet / haiku / default` 分流
- 先把模型级 fallback 做清楚，再考虑更泛化的匹配能力

这个方案与当前 cc-switch 的架构最贴合，风险最可控，也最适合分阶段落地。
