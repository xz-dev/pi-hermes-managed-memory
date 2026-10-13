# Hermes 代码参照与 Pi 适配决策

## 参照规则与版本

以 Hermes 记忆系统的行为和数据流为实现标准；技术决定先查相关实现、调用路径和测试。仅保留官方 Pi API/原生存储格式或用户明确要求所必需、可追溯的差异，不因为本地规划曾写下某个自定规则就把它视为替代标准。既有验收不因补充追溯自动重开；具体行为冲突再提出变更。

- 规划基线：Hermes `234badf4012af380d23c91eae55d045a69c69ffb`。
- 本轮对照上游 HEAD：`64ad33e32dadbdb462468c7384aa38e5c99a1b7a`，不是自动升级本地契约的依据。
- 官方 Pi 适配基线仍是 `@earendil-works/pi-coding-agent` 0.99.2 / `a4715ec9`，不用 fork/private API 兜底。
- 两份完整源码归档与来源收据：`/var/tmp/hermes-source-reference-5cpd2f8m/receipt.json`。规划归档 SHA256 为 `cd9ec67319b979fd768e06c2de308cedb786a039c77234006e9b771f0e9e0c79`，与原 `docs/planning-evidence.md` 完全一致。
- 父代理核对 `session_search_tool.py`、`hermes_state_search.py`、`memory_tool_store.py`、`background_review.py`、`memory_provider.py`、`write_approval.py`、`test_session_search.py` 在上述两版字节相同，收据为同目录 `parent-source-equality.json`。不据此宣称所有上游文件或所有行为相同。

这次是静态源码核验，没有运行 Hermes、调用模型或测量实际账单。完整研究报告是 Pi session artifact `subagent-artifacts/outputs/3f3ce909-85f3-4ae6-af6f-4323a24aba49/research/hermes-code-decision-map.md`；报告中的建议不是用户批准，以下以核实的源代码与决定边界为准。

## 5.2：检索的事实依据

| 问题 | Hermes 规划基线实际行为 | 本项目边界 |
| --- | --- | --- |
| 默认结果数量 | [`session_search` / `_dispatch`][search-dispatch] 默认3，范围1–10 | 用户进一步要求以Hermes为标准后，D5已改为默认3、最多10；撤回原先自行设定的默认10 |
| read单条内容 | [`_READ_MAX_CONTENT`][search-cap] 为2000；[`_shape_message`][search-shape] 只裁剪content，再添加省略号、content_truncated、original_content_chars | 2000有上游参考，但严格“片段最多2000”的实现要计入自己返回的截断标记，不能把上游2000+省略号冒充严格相同 |
| 元数据 | `_shape_message`另带id/role/timestamp/tool_name/tool_calls/tool_call_id；这些不参与content的截断计数 | 未计入上游字符预算不等于没有token成本；本项目不得用工具参数、定位或details旁路无界返回 |
| 会话read | [`_read_session`][search-read] ≤30条时全部；更多时head20+tail10，并给滚动入口 | 本地12000总量要求不能通过照搬30条×2000而失效 |
| scroll | [`_scroll`][search-scroll] 以around_message_id为锚点，window默认5、范围1–20；该路径调用_shape_message时不传content字符上限 | 本项目要求巨大工具输出不能绕过总预算，不能直接移植这个无字符上限的细读路径 |
| 搜索结果形状 | discovery按lineage root归并，首项较丰富，较低排名紧凑；FTS命中再hydrate原始消息 | 使用真实片段、显式截断和entry锚点；不用模型生成“回忆” |
| 12000 | `session_search_tool.py`无12000常量，也没有整个响应的字符预算 | 本地新增保护；用户已明确选择只累计正文，元数据另行有界，完整响应允许超过12000 |
| 分页 | read给head/tail及滚动指针；scroll用消息ID锚点，边界消息会重复作定位，messages_before/after表示是否到头 | Pi用原生session/entry定位和有界后续页；不是照抄SQLite数值消息ID |
| 作用域 | [`_read_scoped`][search-read] 单profile读取，miss不扫描其他profile的数据库 | 对应本地明确授权的native collection，不可无命中就跨根回退 |
| 辅助模型 | [模块声明][search-cap]及调用链均返回实际DB消息；搜索、read、scroll、browse无LLM调用 | 与既有零辅助调用/零远端fallback要求一致，保留 |

上游read-cap注释说明了引入该限制的实际问题：一次归档工具结果返回约74K字符，令下一次请求上下文从约50K增到89K tokens。它支持“仅限制消息数量不足以控制返回量”的判断，不证明本地12000或某种元数据计数方式已经获批。

### 分支与去重的差异

Hermes [`_discover` / `_resolve_to_parent`][search-discovery] 用数据库 `parent_session_id` 跟踪lineage，并按lineage root归并；归档/rewind可见性还依赖存储层active/compacted标记。它不是Pi JSONL复制entry的去重算法，也不能据此推断一个分支的陈述就是最终事实。

本地D5要求按来源定位/内容去重，须基于已授权、当前可验证的原生父会话链接与对应entry证据；不能仅凭相同文本合并独立会话，不能访问授权范围之外的祖先来补出处。5.1已接受的分支标记是文件最后物理entry的重载父链，不是主会话当前内存leaf，也不是压缩后模型上下文成员集合。

## 既有决定：对应机制与明确差异

| 本地主题 | Hermes对应源 | 沿用 / 差异依据 |
| --- | --- | --- |
| D1短记忆 | [`MemoryStore`][memory-store]，[`memory_tool`][memory-tool] | USER1375/MEMORY2200及短文件机制有上游来源。PROJECT及原生分支session状态是Pi新增；不声称Hermes内置有同样四目标 |
| D2写入与审批 | [`_background_delete_gate`][memory-gate]，[`write_approval`][write-approval] | 沿用自动提炼和破坏性批准分离。后台冲突/pending、明确更正证据、tombstone及已批准逆回滚是本地契约；不把上游可选审批开关偷换成本地权限 |
| D3容量与提交 | [`memory_tool_store.py`][memory-store]的最终批次容量检查、漂移/读取错误处理 | 保留最终状态容量检查及错误保护；本地版本/锁/fsync/intent-result审计与恢复是Pi实现选择，不声称逐字搬运。无额外收费consolidation仍是本地明确限制 |
| D4快照刷新 | [`invalidate_system_prompt`][prompt-refresh]，[`_rebuild_system_prompt_at_boundary`][compression-refresh] | 上游有磁盘加载和压缩提交刷新。Pi自有section、请求级投影、显式taskId约束及容量阻止正式请求是官方Pi API适配，不是Hermes现成保证 |
| D5检索 | 上表及[`hermes_state_search.py`][state-search] | 原始消息、局部片段、锚点、无LLM可参考；SQLite/FTS/lineage schema不复制。JSONL派生索引、指纹和范围验证是Pi适配 |
| D6快照review | [`build_cache_parity_fork`][review-fork]与[`_run_review_fork`][review-run] | 同模型使用当前messages_snapshot；routed时[`_digest_history`][review-digest]是本地字符串处理，不是额外模型总结。完整有效快照不等于恢复所有旧JSONL，也不保证cache/wire parity |
| D6/R1–R6收费与失败 | [`background_review.py`][review-module]、上游辅助用量记录；本地`docs/review-contract.md` | Hermes有独立review运行和有限工具迭代。本地单请求、64k/4096/90秒/日限额、持久预留、unknown确认恢复及持续TUI失败提示是针对用户费用/可见性要求的新增约束，不是Hermes默认值 |
| D7跨插件协调 | 上述review机制是参照，不提供本地协议的证明 | `hermes.review.v1`、单owner、一笔计量和独立消费者权限是两Pi插件的本地设计。伴随副本语义同步/运行兼容仍是7.1待验收门禁，不宣称已相同 |
| D8外接边界 | [`MemoryProvider`][provider]的static block、prefetch、queue_prefetch、sync_turn、on_memory_write等钩子 | 仅参考职责划分。首版“不实现loader/同步/真实服务适配器”是用户范围决定；可选钩子不能当作已实现能力 |

### 已核实的历史理由

skill项目提供了原始用户entry `4768287e`；父代理定点读回确认其原文：

> 此外，避免我们之前使用的别人的 pi-hermes-memory 插件因为设计和 tui 不显示失败而导致的巨额 token 消耗而且用户没感觉

定点证据（仅该用户条目）：`/var/tmp/hermes-source-reference-5cpd2f8m/history-user-4768287e.json`。这说明费用控制与失败可见性不能因为Hermes上游不同而自动删除；但它不是某个具体12000计数方式、真实provider试验或跨仓修改的授权。此前账单异常的唯一技术根因仍未由这句话证明。

其他已确认决定的本地记录仍按原有来源区分：`PLAN/review-controls-plan.md`记录未知usage确认日一次预留记账；`docs/review-contract.md`记录请求/审批边界；OpenSpec及各`PLAN/*-evidence.md`记录实现验收。对没有恢复原始用户定位的内容，不把文档转述冒作用户逐字原话。

## 当前推进边界

5.1保持已接受/已勾选，当前16/26。用户在源码与历史对照后明确选择“采用正文计数方式”：每片段正文≤2000、单页正文合计≤12000；来源定位、分页和进度另行有界，整个响应可以超过12000，不能在元数据夹带完整工具参数或原文。之后用户进一步明确“我们要以 hermes 记忆系统为标准”，所以搜索默认值对齐上游3（最多10），不继续保留缺少特别要求的默认10差异。D5已同步这两项决定，5.2按此实现。

检索无辅助模型调用、片段/锚点/截断语义沿上游；有界read、Pi JSONL来源校验和分叉复制去重落实已确认要求，不复制上游无字符上限scroll。此前研究者建议正文计数本身不是批准；批准来自其后的用户明确选择。

后续每个技术决定记录：`Hermes提交 + 文件/符号 + 实际机制 + Pi差异 + 差异依据`。优先沿固定参照检查相关调用路径；需要采用上游变化时再核对该变化，不每轮重审整个仓库。

[search-cap]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L1-L50
[search-shape]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L237-L250
[search-read]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L447-L477
[search-scroll]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L531-L575
[search-dispatch]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L577-L638
[search-discovery]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/session_search_tool.py#L106-L121
[state-search]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/hermes_state_search.py
[memory-store]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool_store.py
[memory-tool]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool.py#L38-L41
[memory-gate]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/memory_tool.py#L157-L205
[write-approval]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/write_approval.py
[prompt-refresh]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/system_prompt.py#L812-L838
[compression-refresh]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/conversation_compression.py#L3161-L3205
[review-fork]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L985-L1080
[review-run]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L1167-L1213
[review-digest]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L324-L355
[review-module]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py
[provider]: https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/memory_provider.py#L84-L206
