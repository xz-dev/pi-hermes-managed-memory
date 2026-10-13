# Shared review contract v1

本文件是本仓库的首版互操作契约，不是通用子代理框架或外部 memory-provider 接口。下文 wire 已由本仓库生产路径与隔离 skill 协议替身验证；尚未集成真实 companion，也未修改其正文副本。实现仅用官方 Pi 公共 API。

## 用户决定与边界

- 默认当前有效上下文快照、同模型；不是增量审查，不恢复压缩前全部原始历史。
- 后台消耗与失败必须持续可见。无人值守不得换模型、转进程或自动重复请求。
- 外部记忆适配器只作评估，不实现网络服务接入。
- 各插件独立安装；共同安装不代表允许费用翻倍或互相写文件。

## R1 — 单一收费入口与调度

所有自动模型调用只能经过 review coordinator；压缩、关闭、纠正、维护、空响应 fallback 都不能另有收费入口。显式 `/hermes-review run` 也经过同一计量入口，默认仍受预算限制。

计数来自有效用户消息和 tool-bearing assistant turn 两种独立证据：记忆默认每 10 个用户轮次到期；skill 默认每 10 个含工具的模型轮次到期，但仅在前台 `agent_settled` 后派发。`turn_end` 不等于用户轮次。重复事件、审查自己的消息、工具数量和遥测条目不产生新用户计数。

协调采用官方 `pi.events` 的版本化 `hermes.review.v1` 协议。参与者仅声明目标、提交验证器和状态订阅；在同一稳定边界收集目标后，以固定插件标识排序选一个 owner。只有 owner 发请求；相同 session/有效终点/快照内容合并目标。若后来出现新目标而快照已处理，等待下个合格边界，不立即重发。协议不兼容或身份不确定时暂停自动审查并提示，绝不双方各自启动。

同进程协调不够：`getAgentDir()/hermes-review/` 保存跨进程租约、累计额度预留和结果账本。预算准入与重复任务声明在一个受锁的本地事务中完成；丢失/损坏账本不能当成零用量重置。单独安装任一插件时也使用同一路径和协议版本。

## R2 — 默认限制与准入

下列是首版保守设计默认值，不是 Hermes 默认值，也不是实际费用测量；用户可在全局配置中调整，TUI 显示生效值。项目设置只能收紧，不能扩大权限或预算。

| 项目 | 初始值 |
| --- | --- |
| 每个自动任务的模型请求数 | 1 |
| 每任务累计输入预算（含历史、system、tools、附加证据） | 64,000 tokens |
| 每任务累计输出预算（含 provider 报告的 reasoning） | 4,096 tokens |
| 任务超时 | 90 秒 |
| 每 UTC 日自动任务数 | 4 |
| 每 UTC 日累计输入/输出预算 | 256,000 / 16,384 tokens |
| 自动重试、自动 fallback | 0 |
| 收费中的自动任务并发 | 每个 agentDir 1 |

输入是完整有效快照，超预算就 skipped-budget，不偷偷裁剪或使用另外的廉价模型。缓存输入也计入输入预算，不假定免费。缺少可靠 tokenizer 时使用保守估算并标明 estimated；预算是本插件可控制的用量上限机制，不是对远端账单的数学保证。

每次请求前持久预留完整准入额度和 request ID。返回实际 usage 后结算；实际量高于估算须显示超额并暂停后续自动审查。网络中断、取消、进程崩溃后的未知调用保留预留且标记 unresolved，不自动释放为零；恢复后不重放请求。日期回拨不能把已用额度变回可用；跨日未结调用继续占用未结额度。用户明确处置未知记录不代表证明远端没有收费。

用户查看并明确确认恢复后，未知请求的完整输入/输出预留只记作确认当日 UTC 的一次预算消耗；actual usage 仍未知，不自动重放旧请求。记账在锁内逐请求幂等，重新检查存活 owner；实际 UTC 日低于账本日期高水位时拒绝恢复。已记账请求不再同时占原始日期的预留/报告额度；迟到遥测保留实际量及历史，不另扣一次、不自动退回确认额度，超额仍重新暂停。新请求继续受剩余额度限制，正常下一 UTC 日更新预算。确认只处置预览中的未变记录，新错误仍阻止恢复。

SDK/transport 可配置的重试和自动压缩必须关闭或被同一准入入口覆盖。不得把外部 provider 自己不可观测的行为宣称为“零重试”；无法满足单次计量的运行路径应禁用自动审查并显示限制。任何将来增加调用次数的配置，都需要同步增加累计计量测试。

## R3 — 快照与独立请求

在 `agent_settled` 捕获公开的当前分支/投影、有效 system 文本、当前模型与 thinking、最近可观察的上下文转换及使用过的 skill 版本。快照深复制，关联 sessionId、有效终点、projectId、generation、digest。自有遥测 custom entries 不参与工作内容 digest。

主实现采用公开 `ctx.modelRegistry.streamSimple` 的独立、单请求分析，不开启自动工具循环。使用官方导出的 session/context 转换能力构造请求；不直接写 `agent.state.messages`，不解析并重放私有 provider payload，不调用主会话的 fork/navigateTree。

审查只输出分类提案。宿主接纳裸 JSON 对象，或整段唯一、标为 `json` 的完整代码围栏中的同一对象；前后解释、多围栏、截断、无效 JSON 或 schema 仍拒绝，不追加请求。外包装不改变来源、作用域、版本、容量与审批校验，混合消费者仍按现有 schema 分开验证。需要修改的已有 skill/记忆，宿主在请求前附上已读版本及必要证据；超预算仍跳过。无关工具不可执行；模型若请求工具或输出不完整提案，记为 no-proposal/failed，不自动追加一次请求。由原生运行时公开取得的 tool 声明只能作为只读上下文，不能继承其执行权。

这是对 Hermes 的明确收敛：保留当前快照、同模型和隔离审查方法，但首版不复制其最多多轮工具执行流程。独立 SDK in-memory session 是已知公开备选，不作为第二条自动 fallback 路径；若采用备选必须先证明禁用默认扩展、默认工具、重试和自动压缩。源码参数 `noTools` 是 `"all" | "builtin"`，不是 boolean。

官方公共 API 无法保证所有其他扩展的临时改写、最终 wire payload、provider cache scope 和服务端缓存行为完全复制。尽可能保留模型可见的有效历史与稳定前缀，但不得报告“100% cache parity”。这里是隔离分析快照，不是复制模型隐藏状态。

## R4 — 状态、取消与提交

任务状态：queued → admitted → running → changed / no-change / no-proposal / pending / conflict / failed / cancelled。准入前可进入 skipped-budget / skipped-disabled / skipped-unsupported。usage-unknown 是可与终态并存的计量状态。

新用户输入、主会话/分支/项目变化、reload、shutdown 或用户取消，立即递增 generation 并撤销旧提交资格，向独立请求传递 AbortSignal。取消不意味着远端没收费。前台不等待后台长任务；返回结果只可更新其旧 request 的用量记录，不能更新已经切换的文件或主聊天。

宿主验证提案 schema、来源、目标作用域、读取版本、权限、容量后调用各插件自己的提交器。每个消费者只写自身文件；无变更、冲突和拒绝均是终态，不生成递归审查。所有提案用稳定 proposal ID 去重。已遗忘条目的 tombstone 阻止旧提案复活。

任何自动任务 failed 或 usage-unknown 后暂停自动审查，直到用户明确查看并恢复；新用户消息、reload 和周期 tick 不自动解除。

## R5 — 用量与 TUI 契约

每个 request 持久记录：request/job ID、触发、目标集合、session/project 身份（不保存凭据）、模型/provider、开始/结束时间、状态、估算/预留、reported input/output/cache-read/cache-write、已知价格估值或 cost-unknown、错误分类、提交结果。SDK 常见 input 与 cache 字段可能口径不同，保留原始 usage 字段及规范化依据，不简单相加造成重复统计。

provider stream 的 progress 只作暂态；最终 usage 按 request ID 结算一次。错误对象含部分 usage 时保留；没有字段时 unknown。无变更不等于没花 token。关闭 UI 不停止记账，写账失败则禁止发起新的收费请求。

TUI 固定状态区显示：自动化开关/暂停原因、运行模型与耗时、最近终态、日累计 input/output/cache 与剩余额度、未确认错误数。提供 `/hermes-review status|usage|errors|cancel|retry|pause|resume`；详情显示 failed/no-change/cancelled 等全部记录。失败保留状态标识至用户确认，reload 后恢复，不能只打 debug 日志或瞬时 toast。Print/JSON 模式写结构化终态与同一持久账本，不尝试弹 TUI。

主会话 usage 与辅助请求 usage 分开列示，再给可解释的合计；不能假装后台已进入 Pi 原生 usage 统计。手动 retry 显示旧请求已用/未知额度、模型、预计新额度和剩余预算，再由用户决定。确认绑定旧请求以及当前 generation/session/project/leaf/快照/model/预留，状态变化须重新预览；仅绕过所选旧请求的重复限制，不绕过 owner、预算、账本或协议闸门。无可用公共确认 UI 时返回结构化 confirmation-required，不记恢复消耗、不恢复、不重试。

## v1 wire、ack 与生命周期（本仓库实现）

类型定义：`src/review-coordinator.ts` 的 `ReviewEvent` / `ReviewContribution` / `SharedReview`。唯一频道 `hermes.review.v1`，仅支持 memory 加一个可选独立消费者；更多参与者不被当作通用插件框架处理，直接拒绝。memory 固定 ID `hermes-memory`，每次加载随机 instance；peer 声明稳定 ID、当前加载 instance、`version: 1`。ID 使用 `[a-z][a-z0-9-]{0,63}`；peer ID `memory` 保留给自有 `memory:` 目标归属，discovery 直接拒绝，不收费。重复 ID、旧 instance 消失、版本不兼容或没有必要 ack 均 fail closed。

公开 SDK `EventBus.emit` 返回 void，listener 异常由 SDK 捕获。它既不是 ack，也不会把异常传给发起者。以下步骤只认显式 callback ack，收集窗口固定 100ms；窗口关闭后的 ack 忽略。非 discover 步骤必须恰好一个 ack，缺失/重复均拒绝。参与者必须在本地有界时间完成协议动作，不通过 ack 窗口进行模型调用。

| type | 请求与明确响应 |
| --- | --- |
| `discover` | 广播 `ack({id,instance,version})`；协调器在同一窗口汇总 identity。无 peer 声明且之前未见 peer = standalone；已见 peer 消失不是 standalone fallback。 |
| `collect` | 定向 `participant` + `instance`，提供深复制且冻结的当前有效 `snapshot`（digest/session/project/leaf/generation/messages/tools、独立 native user/tool 计数）和 `trigger`。`ack(undefined)` 明确表示未到期；否则 `ack({targets:[{target,version}],instruction,context})`，最多16个唯一目标、序列化贡献最多64KB。原生未转换私密来源不另行传给 peer。 |
| `validate` | 派发前再次 discover，并把读贡献发给对应 peer；必须 `ack(true)` 证明当前 instance、版本、权限仍有效，false/缺失即零收费。memory 的 epoch/version、scope 和现有独立校验不变。 |
| `dispatch` | 贡献者固定 ASCII ID 升序选 owner。若 peer 胜出，只有该 peer 接收单次 `execute()` 能力；它必须先 ack 并在窗口内调用一次。能力在窗口验证后才释放，能力内部复用现有 ledger admission + 同模型单 stream；没有第二账本、重试、主会话工具或 store 权限。memory 胜出时直接走同一入口。 |
| `commit` | 响应后重新确认 identities，定向发送该消费者自己的 proposal、原读贡献、requestId、`valid()`；不发送其他消费者提案或 memory 写能力。peer 在最终同步写入前必须检查 `valid()`、自身版本/审批/容量；晚于窗口、输入/分支/配置/reload/shutdown 撤销后 `valid()` 为 false。必须 ack 每个声明目标的 `{target,status,ids}`；缺失/损坏 ack 记录 failed（实际写入可能未知），绝不宣称成功或自动重放。 |

混合返回 schema 为 `{consumers:{"hermes-memory":<原 memory candidates/removals 提案>,"<peer-id>":<peer 自有提案>}}`。memory-only 保留原 schema 与来源验证；skill-only 不附加 memory 贡献。模型字段不能选择 owner、授权写入或改变目标。每消费者提案独立解析，memory 拒绝不阻止 peer 的合法提交，反之亦然。账本 `commits[].consumer` 指明消费者；peer 目标为 `<peer-id>:<target>`；`saved` 仅存 memory entry IDs，peer IDs 不能获得 memory recall credit。混合请求逐目标记录结果；保存加拒绝 = conflict，保存加 pending = pending，任何 failed（含 commit ack 丢失）= failed 并暂停。已有成功提交保留，费用只结算一次。

`/hermes-review run` 仍代表明确 memory intent，不自动附带新到期 peer。retry 只使用旧请求的目标集合；预览绑定所有发现的 participant/instance、所选贡献/version、memory epoch、有效快照/model 和旧 ledger stamp。确认期间改变目标、版本或参与者须重新预览；owner dispatch 的所有异步等待结束后，最终 execute 边界再次检查 generation/signal/session/leaf，已撤销的 retry 在进入任何 ledger admission/recovery 变更前拒绝。合法确认后因预算不足而 skipped 的既有恢复语义保持不变。旧 ledger 的 `targets:["memory"]` 兼容解释为该次明确 memory 预览的当前已解析目标，不需要迁移。无 UI 仍 confirmation-required，无恢复扣款或派发。

memory OFF 关闭本扩展 automatic shared dispatch，不因为 peer 到期重新打开。peer 自己单独运行/关闭的开关与 cadence 是其责任；本仓库不实现真实 companion 调度器。已处理的相同有效终点/快照不重发；没有新增原生用户或 tool-bearing assistant entry 的 continuation、重复 settled 和 reload 不重新收费。后来新增目标等待下个合格工作边界；同一用户之后新增的真实工具轮次可以形成新的合格边界，不必等待新用户。memory 的 attempted/cadence 仅限制 memory 贡献，不阻断已新到期的 peer；peer-only 消耗不重置 memory 用户 cadence。跨进程仍由原 ledger 的锁、reservations、owner instance、恢复债务和 duplicate-snapshot 保护。

协议错误持久暂停并记录 skipped/not-sent 原因；账本故障可见 unavailable，没有 standalone 或额外请求 fallback。状态只记录 identity/版本摘要/结果，不输出原私密提案体。合作是显式协议契约，不是对恶意扩展写权限的沙箱：peer 必须履行自己的审批、最终 version 和 `valid()` 检查。

## R6 — 最小验收矩阵

- 3 个用户轮次/40 个模型工具轮次、重复 settled 事件：用户计数不被放大，同一快照只请求一次。
- 两插件同时到期及两个 Pi 进程竞争：一个收费 owner；累计预留不能双花。
- changed/no-change/empty/reasoning-only/invalid JSON/超时/断流/取消：全部有记录；请求总数不因失败增长。
- 请求已发出后杀进程并重启：unknown 记录保留，既不重发也不把额度归零。
- 新输入/换项目/换分支时迟到返回：只记量，不提交。
- 超预算、账本故障、协议版本冲突、关闭自动化后 compaction/shutdown：零新模型调用，TUI 显示原因。
- provider 未给 usage/price：unknown，不显示零；高于估算时暂停后续自动任务。
- 使用假 provider 和官方扩展测试入口验证以上行为，不以真实付费调用作为默认测试方式。

## R7 — 先验证学习闭环，再扩展协调

单请求、64k、每日四次及失败暂停是可调整的初始设计参数，尚未证明适合所有 Pi 上下文；它们不能取代学习效用验收。实现先以单插件最小链路完成：完整有效快照→有来源提案→校验保存→后续搜索/注入→对应费用和终态，再逐步完善跨进程及双插件协调。首次接触任何真实收费 provider 前仍必须具备单次准入、有限预算、记录和取消，不允许为了早期验证绕开这些底线。

持续区分 eligible、admitted、skipped-budget、no-proposal、conflict、saved、reused/recalled，报告各阶段的数量和原因。保留正例、纠正、临时要求与无可保存内容的代表性样本。全部跳过或没有有效提案不能算“低成本学习成功”；失败暂停须在 TUI 提示未执行的学习任务和明确恢复入口，不伪装为长期正常运行。

fake provider 证明宿主流程，不证明真实模型总结质量。少量真实模型与后续任务复用评估须在实现阶段另获费用授权；未执行如实标记。若单轮不足或预算过小，先交付具体失败样本、请求数与费用估算，再请用户选择提高限额、增加受控调用或保持手动，不自动扩大。
