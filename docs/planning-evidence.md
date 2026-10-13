# Memory 插件规划证据索引

此索引连接已核验的上游机制与本插件的明确新增设计，不把子代理报告或 OMD 连线当作实现证明。研究在足够决定首版边界后停止，不宣称穷尽 Hermes。

基线：Hermes `234badf4012af380d23c91eae55d045a69c69ffb`；官方 Pi `a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4` / `@earendil-works/pi-coding-agent` 0.99.2。归档 SHA256：Hermes `cd9ec67319b979fd768e06c2de308cedb786a039c77234006e9b771f0e9e0c79`；Pi `ab7aab534c77e40ad5f36e69f1e4f6858d5ff98862a25c1950025f9518ff9def`。固定提交链接可恢复来源，不依赖临时缓存存活。

## U1 — 已确认的产品决定

仅官方 Pi；内置画像/全局/项目/session 记忆完整规划；默认主模型当前有效上下文快照审查；外接后端仅保留评估。用户特别要求避免旧插件式的巨额 token 消耗与 TUI 不显示失败。用户已允许自动维护受管内容，不需要把每个普通新增都变为审批。

本插件据此新增单一收费入口、持久预算/失败视图、项目存储和联合审查去重。预算数值是保守设计默认，不是账单实测。旧异常费用的唯一根因未经账单核对，不能声称已经确认。

## H1 — 内置短记忆，不等于所有记忆都在文件里

[memory_tool.py:38–41](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool.py#L38-L41) 返回 `get_hermes_home() / "memories"`；[memory_tool_store.py](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool_store.py) 的 `_path_for` 和 target 逻辑对应 USER.md / MEMORY.md，默认容量 1375 / 2200 字符。

内置文件的目标没有本插件定义的 project/session 四分法；不能据此声称 Hermes 整个仓库或所有外部 provider 都没有项目/namespace 概念。Pi 插件新增 PROJECT.md 和当前分支状态，明确记录是适配设计。

## H2 — 自动提炼与写入门禁是不同机制

[turn_context.py:718–727](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/turn_context.py#L718-L727) 的 `_tick_memory_nudge` 在用户轮次序幕累计；审查并非把每次模型工具循环当作用户轮次。

[memory_tool.py:166–205](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool.py#L166-L205) 对 unattended review 的 destructive ops 作 gate，暂存待审批。不能将它扩展为所有前台写入都需弹窗，也不能忽略当前快照已加强后台删除保护。

插件沿用来源/版本/审批分离，但允许明确用户更正证据驱动的非冲突受管更新；这个差异见 design D2，不冒充完全相同策略。

## H3 — 快照审查不是增量，也不是免费

[background_review.py:985–1080](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L985-L1080) 对齐父运行时，隔离会话持久化；[1167–1213](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L1167-L1213) 选择：

```python
conversation_history=_digest_history(messages_snapshot) if _routed else messages_snapshot
```

同模型使用当前 messages_snapshot；异模型用 [代码 digest](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L324-L355)。已压缩主会话不会因此自动恢复完整旧历史。前缀一致提供缓存条件，不证明命中或费用比例。

## H4 — 冻结记忆快照有刷新边界

[system_prompt.py:812–835](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/system_prompt.py#L812-L835) 的 invalidate_system_prompt 会重新 load_from_disk；[conversation_compression.py:3161–3200](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/conversation_compression.py#L3161-L3200) 在压缩提交边界重建。

因此不沿用旧说法“会话内永远不可见，只能下次会话刷新”。Pi 的中途压缩不一定产生新的 before_agent_start，本插件须在请求级投影处理中兑现刷新，不只注册一个用户轮次 hook 就宣称完成。

## P1 — 官方 Pi 的上下文和分支入口

[extensions/types.ts:851–908](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/types.ts#L851-L908) 定义 context、context_with_system 与可变 systemPromptOptions；[session-manager.ts:245–263](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/session-manager.ts#L245-L263) 提供只读 getBranch、buildSessionProjection 等。

[公共导出 src/index.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/index.ts) 暴露消息转换与 session helpers；模型的当前分支不能由所有 JSONL entries 混合代替。长期自定义 section 与临时 session 约束是插件分别维护的内容，不是 Pi 自动保证识别所有用户限制。

## P2 — 独立请求、usage 和生命周期

[ModelRegistry:132–143](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/model-registry.ts#L132-L143) 的 streamSimple/complete 是公开的独立请求入口；[types.ts:985–1022](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/types.ts#L985-L1022) 明确区分 settled 与 turn_end。

官方可支持隔离分析，不意味着自动复制 Hermes cache scope 或自动将辅助用量记入主 session 总数。插件必须自己保存 request 级 usage/unknown，并提供 TUI 明细。SDK 备选需要禁用自身扩展、工具、重试/压缩，不能使用主会话 fork/navigateTree 代替隔离。

## H5 — 历史检索与外接契约

[session_search_tool.py](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py) 提供基于会话存储的搜索/读取路径；本插件复用 Pi JSONL，而不是复制 Hermes SQLite session schema。

[MemoryProvider:103–206](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/memory_provider.py#L103-L206) 明确分开静态 system_prompt_block、本轮 prefetch、后台 queue_prefetch、sync_turn 与成功写入镜像；可选 hooks 不代表每个实现都有同样能力。详见本地 external-adapter-evaluation.md，首版不实现接口框架。

## 覆盖与排除

| 首版能力 | 来源/决定 | 适配去向 |
| --- | --- | --- |
| 四目标与原子有界提交 | H1–H2、U1 | scoped-memory / D1–D3 |
| 自动快照与费用可见 | H2–H3、P2、U1 | automatic-memory / D6–D7、review-contract R1–R7 |
| 注入与压缩/分支 | H4、P1、U1 | memory-context / D4 |
| 本地历史检索 | H5、P1 | session-recall / D5 |
| 外接暂不实现 | H5、U1 | D8、external-adapter-evaluation |

不采用“满足90%需求”“固定折扣”“prefetch必然击穿静态前缀”等无实测依据说法；没有执行真实模型或后端费用测试。完整上游、provider 品牌实现、所有平台与锁的运行时性质不在本轮已验证范围。OMD 关系只覆盖首版规划清单；未来实现后需增加真实代码和测试端点。
