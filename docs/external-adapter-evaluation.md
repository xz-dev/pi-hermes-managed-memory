# 外部记忆适配器评估

## 决定

用户在本轮评估后选择：**首版只保留设计评估，不实现可执行适配器框架。** 内置画像/全局/项目/session 记忆必须独立完整可用。这里的候选契约不是已发布 API，不是实现任务；未来另立变更选择真实后端验证。

## 它与当前插件分别做什么

当前插件负责：确定用户/项目/session 作用域，挑选可发送的信息，触发审查，验证提案，控制注入预算、费用和写权限。后端不能绕过这些责任。

| 外接能力 | 输入 | 输出 | 可能有价值的需求 |
| --- | --- | --- | --- |
| 存储/检索 | 已批准条目及明确 scope | 可定位的条目/命中片段 | 多设备同步、共享团队知识、独立搜索设施 |
| 远端提炼 | 获准的有限对话片段 | 服务端生成的候选事实/画像 | 明确需要远端建模且接受隐私、质量及费用权衡 |

同一个产品可能同时提供两种能力，不能按品牌将其简单归为“纯存储”或“黑盒模型”。本地 Markdown + Pi session 检索已能实现本次核心目标，但没有做任务覆盖率测试，不能声称满足某个百分比。

## Hermes 的接口启发

固定基线 `234badf4012af380d23c91eae55d045a69c69ffb`：

- [MemoryProvider 接口](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/memory_provider.py#L103-L206) 区分静态 `system_prompt_block`、本轮 `prefetch`、后台 `queue_prefetch`、完成轮次 `sync_turn` 和成功内置写入后的 `on_memory_write`。
- `prefetch` 文档要求快速消费缓存；`on_session_end`、`on_pre_compress` 等是可选钩子，不是所有 provider 都具备的保证。
- [MemoryManager](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/memory_manager.py#L337-L391) 限制最多一个外部 provider，反映工具冲突、作用域与生命周期管理的复杂度；这不证明需要在 Pi 首版原样复制整个接口。
- 外部召回加入本轮上下文不等于必然破坏前面的静态缓存；网络/模型费用与延迟需实际测量，不能从有接口推断固定成本。

## 候选最小契约（非实现承诺）

1. `recall(query, scope, budget, signal)`：返回结构化 hits、来源/版本、截断标记及本次用量/unknown；由宿主渲染，不直接返回任意系统指令。
2. `upsert(entries, operationId, expectedVersion, signal)`：只接收通过本地验证的条目；幂等、冲突和部分成功语义明确。
3. `forget(ids, operationId, signal)`：返回删除/不可删除/仍在保留期的结果；本地立即停止注入并维护 tombstone，远端失败不能静默重新召回已遗忘条目。
4. 可选 `ingestTurn(evidence, scope, consent, operationId, signal)`：**与 upsert 分开**。这意味着传输原始对话和允许服务端提炼，必须另行启用；默认不存在完整 session 上传。
5. 生命周期仅按真实后端需要增加 initialize/close/health；不提前复制 Hermes 每个 on_* 钩子。

Scope 至少区分 profile/user、project、session/branch，并说明哪个字段用于隔离、哪个只是标签。接口同时返回源记录标识、耗时、已知费用或 unknown；不支持的能力应显式拒绝，不能空实现冒充成功。

## 上线前必须回答的问题

- 谁是事实权威：本地文件还是远端？第一版只允许一个明确权威，禁止无冲突规则的双向同步。
- 重复提炼：本地 review 与远端 ingest 是否对同一证据收费两次？按 operation/source ID 去重，分开显示费用。
- 冲突与遗忘：版本冲突、离线删除、重试和旧召回怎样处理？必须有 tombstone 和可见未决状态。
- 隐私：发送哪些内容、保存多久、由谁可见、是否含第三方/秘密？没有 consent 不发 raw transcript。
- 成本：后端是否执行自己的 LLM/embedding？无法知道时显示 unknown，不把本地请求用量当作全部账单。
- 故障：有限队列和显式背压/暂停；丢弃证据必须可见，不以“成功同步”掩盖超限丢弃；取消不保证服务端停止计费。
- 注入：始终受本地结果预算、来源和权限规则约束，不让 provider 改写 skill 或权限配置。

## 何时值得单独立项

- 用户确实需要多个设备或团队共享，而文件同步/只读项目规范不足。
- 测试集证明关键词检索遗漏重要语义，且规模/延迟数据支持换检索后端。
- 用户明确需要远端画像提炼并接受数据处理与费用条件。

届时选择一个真实后端做最小垂直验证：已批准事实写入 → 限定 scope 查询 → 显示来源/费用 → 删除 → 断网/重试/重启。不要仅凭一个万能 interface 或 fake adapter 通过就宣称真实互操作已完成。
