# Codex 额度自动激活：第三轮本地修复验收报告

日期：2026-10-11（Asia/Singapore）

第三轮审计包：`C:\Users\admin\Downloads\ccswitch-quota-audit-77767e2.zip`

审计对象与本轮起点：`77767e28ecccc6934960540e3001651f5920f633`

分支：`codex/codex-quota-activation`

## 基线与边界

本轮开始时 HEAD 与第三轮审计对象一致，工作树和暂存区没有未提交修改。当前修改均为本轮局部修复；未创建分支，没有覆盖用户改动。保留上一轮 `reserved -> submitted` 派发线性化点，不撤回已提交请求。

## R01–R05 逐项结论

| 项目 | 结论 | 当前证据与边界 |
|---|---|---|
| R01 FullRestore 缺行 ABA | **FIXED** | `ensure_codex_quota_activation_tombstones_on_conn` 在 SQL 与二进制 FullRestore 的 staging 替换前，为 live 有而备份缺失的账号写入关闭 `AwaitingBaseline` tombstone，revision 高于 live 下界；之后统一 pause。`r01_full_restore_missing_row_invalidates_barriered_tick_and_sender` 走真实 SQL restore、旧 GET barrier、生产 dispatch helper 和 loopback sender，旧 save/claim/submit/finish 全拒绝、sender=0；`full_restore_tombstones_live_activation_accounts_missing_from_backup` 与 `binary_restore_tombstones_live_activation_accounts_missing_from_backup` 覆盖两种 restore 入口。 |
| R02 cache invalidate 原子性 | **FIXED** | `UsageCache` 将账号 quota 与 generation 收入同一个 `RwLock` entry；single/all invalidate、generation 注册和 publisher 使用同一临界区，不跨网络 await 持锁。`usage_cache` 测试覆盖旧 generation、`invalidate_all` 仅登记账号和时间排序。 |
| R03 时间组合校验 | **FIXED** | `valid_timing` 不再按 `observed_at_ms` 绝对量级豁免；所有有 `reset_after_seconds` 的输入统一按注入观测时刻校验，正 countdown 使用 5 秒误差容忍，zero countdown 不得指向明显未来。`n03_all_epoch_offsets_use_the_same_timing_rule` 覆盖 T-301、T-100、T+30、T+18000；fixture 已改为真实自洽关系。Tracking/Spent/weekly 阻断回归继续通过。 |
| R04 历史成功遮住检查失败 | **FIXED** | UI 保留 `lastAttemptStatus/lastAttemptAtMs` 的历史事实，新增独立 `check: <status> · <reason>` 展示，title 也包含 `lastPollReason`。`CodexQuotaActivationCorrupt.test.tsx` 预置 completed 后注入 model preflight 失败，断言 DOM 同时显示 completed 和 `model_catalog_http_503`。 |
| R05 官方订阅测试入口绕过 cache/lifecycle | **FIXED** | `publishCodexOauthQuota` 成为普通 queryFn、自动轮询和 `UsageScriptModal` 官方测试按钮共用的发布边界，统一 queriedAt 排序；测试按钮捕获 activation revision，关闭/恢复/删除后不再发布旧 DTO。`UsageScriptModal.codexQuotaCache.test.tsx` 使用真实 QueryClient、deferred test GET 和自动 quota@200，验证旧测试@100不能覆盖；第二个用例验证 revision 变化后旧测试不回填。 |

## 实际测试与检查

- `cargo test --manifest-path src-tauri/Cargo.toml codex_quota_activation --lib -- --nocapture`：42 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml n02_ --lib -- --nocapture`：2 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml r01_full_restore_missing_row --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml full_restore_tombstones_live_activation_accounts_missing_from_backup --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml binary_restore_tombstones_live_activation_accounts_missing_from_backup --lib -- --nocapture`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml usage_cache --lib -- --nocapture`：13 passed。
- `pnpm test:unit -- --run tests/hooks/useCodexQuotaAutoPolling.test.ts tests/components/CodexOAuthSection.test.tsx tests/components/CodexQuotaActivationCorrupt.test.tsx tests/components/UsageScriptModal.codexQuotaCache.test.tsx`：29 passed。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS，仅有既有 dead-code warnings。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `pnpm typecheck`：PASS。
- `pnpm format:check`：PASS。
- `git diff --check`：PASS。

第三轮审计包中的 `OFFLINE_PROBES.py` 没有被当作产品测试依据。没有运行真实 OAuth、token refresh、quota/model GET、generation POST、生产 Provider、生产凭据或生产数据库。

## 产品差异、未验证边界与回滚

- 固定模型仍为 `gpt-6-luna`、`reasoning.effort=low`、`hello`；未切换模型或协议。
- Luna 线上权限、Responses 兼容性、实际扣费、reset 生命周期和 exactly-once：`UNVERIFIED`。
- Windows WebView、系统休眠/唤醒、跨进程崩溃、真实网络竞态：`NOT RUN`。
- R01 以最小 tombstone 复用现有状态表和 revision，不新增 schema、ledger、Coordinator 或调度器。
- 回滚方式是关闭账号授权开关并保留状态/去重行；代码回滚不要删除现有 activation 表或 revision 数据。

本轮没有 commit、push、PR、Issue、部署或生产操作。
