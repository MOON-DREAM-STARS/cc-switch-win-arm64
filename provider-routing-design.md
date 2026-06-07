# Provider 组合路由设计

## 背景

cc-switch 已具备本地代理与本地路由能力，但原有 provider 心智仍偏向：

- 一个 provider 对应一套上游配置
- 一个 provider 对应一套认证信息
- 当前 app 只有一个激活 provider
- failover 主要是 provider 级别的顺序切换

这套模型可以覆盖“在多个 provider 之间切换”，但不足以覆盖“同一次本地代理接管下，按请求模型把流量分发到不同 provider 或不同 API Key 渠道”的需求。

典型场景：

- `opus` 请求走 Kiro 渠道的 `Claude Opus 4.8`
- `sonnet` 请求走 GPT 渠道的 `gpt-5.4`
- `haiku` 请求走另一个 provider 的 `gpt-5.4 mini`
- 同一域名下，不同渠道的 API Key 完全独立

因此，需要在现有本地代理能力之上，新增一个“模型级路由层”。本 session 已将入口方案从“添加新供应商里的开关”调整为“设置驱动的自动组合 Provider”。

---

## 已确认的产品方案

### 入口位置

组合 Provider 不再从“添加新供应商”表单中创建。

新的入口为：

```text
设置 → 路由 → 本地路由 → 开启组合 Provider
```

开启后，当前应用主页自动显示一个名为：

```text
组合provider
```

的 Provider 卡片。

### 范围

“当前 AGENT”在本方案中解释为：

```text
当前主页应用 / 当前 AppId 内
```

也就是说：

- 在 Claude 页面开启时，组合 provider 汇总 Claude 下的普通 provider
- 在 Codex 页面开启时，组合 provider 汇总 Codex 下的普通 provider
- 不做跨 Claude / Codex / Gemini / OpenCode / OpenClaw / Hermes 的全局混合路由

### 卡片形态

组合 provider 是一个真实持久化 provider，而不是纯前端虚拟卡片。

原因：

- `ProviderList` / `ProviderCard` / `ProviderActions` 已围绕真实 provider 工作
- 切换、排序、删除、复制、当前 provider 状态都依赖 provider id
- Rust 本地代理 runtime 也需要在 provider store 中找到当前 provider
- 纯 UI 虚拟卡片会导致 switch/update/sort/runtime 无法可靠工作

### 编辑入口

主页卡片右侧“编辑”按钮对组合 provider 使用专用编辑页，而不是普通 `EditProviderDialog`。

普通 provider 仍保持原有添加/编辑流程。

---

## 目标

新增一个可在 cc-switch 中管理的 **组合 Provider（Router Provider）**，在开启本地路由后：

1. 根据请求模型或角色模型进行路由
2. 将请求分发到当前应用内不同真实 provider
3. 支持同一 base URL 下不同 API Key 的目标拆分
4. 支持通过下拉选择普通 provider 和上游模型完成模型映射
5. 复用现有本地代理、格式转换、认证注入、熔断和统计能力
6. 避免普通 ProviderForm 承担组合 provider 创建职责

---

## 非目标

V1 暂不覆盖以下内容：

1. 不做跨 app 的全局组合 provider
2. 不做通配符或正则级模型匹配
3. 不做单 provider 内多 keyPool 重构
4. 不改变现有客户端 live config 接管机制
5. 不替换现有 provider 级 failover 队列的通用逻辑
6. 不把多套认证直接内联保存在组合 provider 中
7. 不在“添加新供应商”表单继续暴露组合 provider 开关

---

## V1 范围

V1 聚焦：

- 当前应用内 provider 汇总
- 自动管理的组合 provider 卡片
- 角色模型路由：`default` / `haiku` / `sonnet` / `opus`
- 保留 runtime 对 `exact` 规则的支持
- 组合 provider 引用已有真实 provider
- 编辑页自动探测普通 provider 已有模型或可探测模型
- 用户通过 provider 下拉 + model 下拉/手动输入完成模型映射

同一 `base_url` 下不同 API Key 的需求，通过“创建多个真实 provider”表达，例如：

- `ai98pro-kiro`
- `ai98pro-gpt-plus`
- `another-provider-mini`

组合 provider 只负责引用它们，而不直接保存多套认证。

---

## 用户心智模型

用户需要理解两类 provider：

- 普通 provider：真实上游，持有 base URL、API Key、模型配置
- 组合 provider：路由入口，不直接请求上游，只负责按模型选择真实 provider

用户在 UI 中切换到组合 provider 后：

- 客户端仍只知道“当前激活的是一个 provider”
- live config 仍然指向本地代理
- 真正转发时，由本地代理根据模型规则选择真实 provider
- 组合 provider 在主页上表现为普通 provider 卡片
- 组合 provider 的编辑入口进入专用模型映射编辑页

这比“在代理设置页维护一套全局路由表”更贴近当前 cc-switch 的 provider 管理心智，也更容易和现有 provider 切换逻辑兼容。

---

## 示例

### 示例：当前 Claude 应用内混合路由

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

自动管理的组合 provider：

```text
组合provider
```

模型映射：

- `opus` → `ai98pro-kiro` / `claude-opus-4.8`
- `sonnet` → `ai98pro-gpt-plus` / `gpt-5.4`
- `haiku` → `mini-provider` / `gpt-5.4-mini`
- `default` → `ai98pro-gpt-plus` / `gpt-5.4`

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

## 数据模型

### 1. Settings 开关

在本地设备级 settings 中新增：

```ts
enableModelRouterProvider?: boolean
```

语义：

- `false` / 缺省：不在主页展示自动管理的组合 provider
- `true`：当前应用主页自动创建/显示组合 provider 卡片

Rust settings 对应字段：

```rust
enable_model_router_provider: bool
```

通过 serde camelCase 与前端对齐。

### 2. 自动管理的组合 Provider 标识

组合 provider 使用真实 provider 记录，并在 meta 中标识：

```ts
meta: {
  providerType: "model_router",
  managedModelRouterProvider: true,
  modelRouter: {
    version: 1,
    routes: []
  }
}
```

推荐稳定 id：

```text
cc-switch-combined-provider
```

推荐默认名称：

```text
组合provider
```

说明：

- `providerType: "model_router"` 表示该 provider 是模型路由 provider
- `managedModelRouterProvider: true` 表示这是 settings 自动管理的组合 provider
- 稳定 id 用于避免重复创建
- 关闭开关时默认隐藏该 managed provider，而不是删除它，避免丢失用户映射

### 3. 路由规则

V1 实际保存结构为：

```ts
modelRouter: {
  version: 1,
  routes: [
    {
      id: "combined-default",
      enabled: true,
      matchType: "default",
      target: {
        providerId: "provider-id",
        upstreamModel: "actual-model"
      }
    },
    {
      id: "combined-role-sonnet",
      enabled: true,
      matchType: "role",
      matchValue: "sonnet",
      target: {
        providerId: "provider-id",
        upstreamModel: "actual-model"
      }
    }
  ]
}
```

规则类型：

- `default`
- `role`
- `exact`（runtime 支持，V1 UI 主要保留/透传，不作为首批主编辑重点）

角色值：

- `haiku`
- `sonnet`
- `opus`

### 4. default 规则

允许存在一条 `default` 规则，用于兜底未命中的请求。

V1 UI 可以提示缺失 default route，但不强制要求所有角色都填写。

---

## 路由匹配优先级

推荐优先级：

1. 精确模型名匹配：`exact`
2. 角色模型匹配：`role`
3. `default`
4. 若仍未命中，则返回明确错误

说明：

- 精确模型名适合覆盖特殊别名或特定路由
- 角色模型匹配最贴近 Claude Code 的典型使用方式
- `default` 用作安全兜底

---

## 运行时方案

### 总体原则

组合 provider 的核心路由决策发生在 Rust 本地代理层，而不是前端。

原因：

- 真正的请求转发发生在 Rust
- 认证注入、格式转换、熔断和重试也在 Rust
- 前端只适合编辑配置，不适合承载运行时路由逻辑

### 执行顺序

1. 请求进入本地代理
2. 提取请求中的 `model`
3. 判断当前激活 provider 是否是 `providerType = "model_router"`
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
- 例如：`sonnet: gpt-5.4 -> gpt-5.5`

### provider 级 failover

- 属于现有通用能力
- 继续服务普通 provider 场景
- V1 中不建议默认把两者混合成一套规则

### 推荐策略

V1 先定义为：

- 组合 provider 命中后，优先走该模型规则自己的目标链
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

## UI 设计

### 1. Settings 入口

在：

```text
设置 → 路由 → 本地路由
```

内新增卡片：

```text
开启组合 Provider
```

卡片行为：

- 开启后，当前应用主页显示 `组合provider` 卡片
- 关闭后，隐藏自动管理的组合 provider 卡片
- 关闭时不删除已保存的映射

### 2. 主页卡片

组合 provider 卡片：

- 是真实 provider 记录
- 参与普通 provider 列表展示
- 可以像普通 provider 一样被切换为当前 provider
- 编辑按钮进入专用组合 provider 编辑页
- 不应按 Claude 官方 provider 参与 proxy takeover 拦截判断；`providerType = "model_router"` 是路由入口，真实运行时目标 provider 会在本地代理转发时再解析

### 3. 普通 ProviderForm

普通 provider 添加/编辑表单不再显示：

```text
组合 Provider（模型路由）
```

开关。

组合 provider 的创建不再由 Add Provider 表单负责。

### 4. 组合 Provider 编辑页

编辑页主要是模型映射功能的扩展。

页面内容：

1. 当前应用内普通 provider 列表
   - 排除当前组合 provider 自身
   - 排除其它 `providerType = "model_router"` provider
2. 模型探测状态
   - 优先使用 provider 已保存的 model catalog / models
   - 否则用现有 `fetchModelsForConfig` 尝试探测
   - 缺少 base URL / API Key 时不崩溃，显示不可探测状态
3. 模型映射表
   - `默认模型`
   - `Haiku`
   - `Sonnet`
   - `Opus`
4. 每行字段
   - Provider 下拉
   - Model 下拉 / 手动输入
5. 保存后写入 `meta.modelRouter.routes`

### 5. exact / fallback UI

V1 编辑页优先覆盖 default/role 映射。

已有 unknown / exact routes 应尽量保留，不在基础编辑中破坏。

---

## 可复用现有实现的部分

当前仓库里可以直接借鉴或复用的能力：

1. `fetchModelsForConfig`
   - 已有普通 provider 模型探测能力
2. `ModelDropdown` / `ModelInputWithFetch`
   - 可复用模型下拉和输入交互
3. `model_mapper`
   - 已有 `haiku` / `sonnet` / `opus` 角色识别逻辑
4. `provider_router`
   - 已有 provider 链选择、熔断和 failover 框架
5. `forwarder`
   - 已有 per-provider 尝试、统计、错误处理、格式转换、认证注入
6. `providerMetaUtils`
   - 已有 meta split/merge 保真能力

需要注意的是：

- 现有 `model_mapper` 偏“在单 provider 内改写模型名”
- 新方案需要先决定“用哪个 provider”，再改写上游模型名
- 顺序上不能简单套用旧逻辑

---

## 兼容性要求

1. 老 provider 数据必须继续可用
2. 没有开启组合 provider 时，系统行为不能变化
3. 导入导出时，新增字段必须保真
4. 同步、复制、排序、备注、图标等通用 provider 能力应继续工作
5. takeover 开关与当前 provider 切换逻辑应保持兼容
6. 手工已有 `providerType = "model_router"` 的 legacy provider 不应被 settings 开关误删
7. 关闭 settings 开关只隐藏 managed combined provider，不影响普通 provider 和 legacy router provider

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

## 实施方案

### Phase 1：Settings 开关与入口

- 增加 `enableModelRouterProvider`
- Settings → Routing → Local Routing 新增“开启组合 Provider”卡片
- 本地 settings 前后端 schema 保持一致

### Phase 2：自动管理 Provider 卡片

- 新增 `combinedProviderUtils`
- 稳定 id：`cc-switch-combined-provider`
- 自动创建 / 规范化真实 provider
- 关闭开关时隐藏 managed provider，不删除映射

### Phase 3：移除旧 Add Provider 开关

- 删除普通 `ProviderForm` 中的组合 provider switch
- 保留 model-router meta 类型与 runtime 支持
- 保证 legacy meta 不被普通编辑意外清掉

### Phase 4：组合 Provider 编辑页

- 当前应用内普通 provider 枚举
- provider/model 探测
- default/haiku/sonnet/opus 映射
- 保存到 `meta.modelRouter.routes`

### Phase 5：集成与验证

- `App.tsx` 编辑入口拦截 model-router provider
- 普通 provider 仍走 `EditProviderDialog`
- 组合 provider 走 `CompositeProviderEditor`
- 聚焦测试、typecheck、Rust 编译/测试按环境可行性验证

---

## 需注意的风险

1. 模型探测依赖 provider 暴露兼容模型列表接口；失败时必须允许手动输入
2. Codex 等 app 的模型配置结构不同，需要按 app 做提取适配
3. Rust serde 必须保留 `managedModelRouterProvider` 和空 routes，否则 managed provider 无法稳定收敛
4. 自动创建 provider 必须避免重复 mutation 和 toast spam
5. 关闭开关时如果组合 provider 正是当前 provider，需要避免“隐藏当前 provider”的用户困惑
6. full test 可能受本地环境影响，例如 Rust `libclang` 缺失或前端集成测试并发时序问题

---

## 结论

推荐路线已经从“在添加供应商表单里手动创建组合 provider”调整为：

- 在 Settings → Routing → Local Routing 中开启组合 Provider
- 自动创建 / 显示当前应用内真实 `组合provider` 卡片
- 通过专用编辑页完成当前应用内普通 provider 的模型探测和映射
- 让 Rust 本地代理承担模型级路由决策
- 真实 provider 继续保持“单 provider 单认证”

这个方案与当前 cc-switch 的架构更贴合，避免污染普通 provider 表单，也更适合后续逐步扩展。
