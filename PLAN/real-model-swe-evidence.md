# Task1.4 — 真实 SWE 首轮失效与有界补测

## 授权与实际消耗

用户批准 `openai-api-extension/devin/devin/swe-2`、三组纯虚构样本、最多8次模型提交；每次保守输入估算≤16000、输出≤2048，无重试/换模型，失败或未知用量停止。不读取私人历史或迁移私人记忆。

实际执行于2026-10-12，原始证据 `/var/tmp/hermes-14-swe-fixed-rSzsGG`：**7次真实请求 =5前台+2辅助**，逐次都有wire payload、HTTP响应和reported终态。B审查输入估算16227，超过16000，正确skipped/not-sent；没有补第8次。

原始累计usage：input4873、output2162、cacheRead2688、cacheWrite0、reasoning0、total9723。按SDK total-minus-output归一化输入7561。所有原始字段保留；reasoning0是provider报告，不保证内部没有推理。目录无报价、SDK cost全零是占位，**实际金额未知，不是免费**。辅助请求由生产ReviewLedger记账；前台调用另存逐请求journal，未混入辅助额度。

## 分环节结果

| 样本/环节 | 观察 |
| --- | --- |
| A模型识别 | 正确提出 `I prefer concise answers.` 和 `This project uses Cedar build.`，引用实际原生entry；未提出临时不部署要求。 |
| A协议接纳 | 返回单个JSON代码围栏，生产严格 `JSON.parse` 拒绝，终态no-proposal/proposal-validation。 |
| A来源资格 | 本探针把两条稳定事实与 `For this task only, do not deploy.` 放进同一原生用户消息。已接受的整消息排除规则使该源整体无长期化资格；仅剥围栏也无法保存。 |
| A持久保存/后续使用 | 保存0条；新session无这些记忆，模型询问构建工具/风格，没有有效复用。不能归因于小模型不会识别事实。 |
| B更正 | 旧事实未保存，前置条件本已不成立。探针仍继续下游，且审查被输入预算挡住；更正及复用均未证明。 |
| C无长期事实 | 返回裸JSON `{"candidates":[]}`；no-proposal/no-stable-facts，实际错误长期化0条。这个负例不是学习成功的替代。 |

三次审查意图中1次输入预算skip、2次实际提交；有效保存和召回均0。**首轮效用未达成，不能据此勾选task1.4。** 该轮115个原产品路径未变；补测结果另列如下。

## 无收费本地消融与Hermes依据

`offline-ablation.mjs` 已运行通过，网络0、MemoryStore写入0：

1. 实录围栏原文无法由生产 `JSON.parse` 接纳。
2. 仅剥掉这一次完整围栏后，JSON可解析，但两项实际来源都被生产 `candidateCandidate` 拒为 `no-current-native-user-evidence`。
3. 反事实控制：同样批准的三句话各自作为独立synthetic源，稳定候选通过、临时要求仍拒绝。这是隔离变量的假设控制，不替换真实来源，不宣称生产保存。

固定Hermes提交 `234badf4012af380d23c91eae55d045a69c69ffb` 的 `agent/background_review.py::_run_review_fork`（1167–1213）使用当前messages_snapshot和受限管理工具；`tools/memory_tool.py`注册handler接收工具参数。它没有本插件“把assistant正文作为单个JSON提案解析”的相同关口；不能冒称Hermes已规定接受或拒绝Markdown围栏。本插件单请求/无工具循环是已批准Pi适配，来源/版本/审批门禁不因该格式问题失效。

## 保留失败与接下来需决定的范围

- 最初 `/var/tmp/hermes-14-swe-SrIOjF` 探针误用公开API工厂，调用不存在的`.streamSimple`时同步失败，未进入adapter/传输层，实际模型提交0。原脚本/终态保留；后续只修公开工厂调用，新隔离根执行，非付费重放。
- 首轮最后断言“必须8次”失败。8是上限；合法skip导致7次，不能把它当模型/provider故障，也不能靠补费使断言通过。原断言及失败仍保留。
- 下次探针须有依赖门：实际保存成立才测试新session使用、更正；原事实不存在就停止正例链。稳定与临时要求分成独立的已批准原生样本entry，不降低整消息来源排除规则。允许少于8次，skip如实记录。

首轮诊断后用户明确批准窄产品改动：裸 JSON，或“整段唯一、标明json的完整代码围栏”内的JSON对象；仍拒绝额外正文、多围栏、截断或无效JSON，并保持schema/来源/版本/容量/审批检查。用户另批准最多新增4次同一SWE-2请求、原16k/2048上限和成功依赖门，不重试/换模型/放宽来源规则。原8次轮次的剩余额度没有补用。

## 本地外包装验证

生产变更仅 `src/memory-review.ts` 解析入口3行，无新依赖。实际原生 `/hermes-review run` 围栏保存case先RED后GREEN，保留主JSONL/leaf/messages不变。`test/review-envelope.test.ts` 12个case覆盖完整围栏/CRLF、前后解释、多围栏、截断、无标签、坏JSON/schema、伪造entry和可识别private/temporary整源排除。181项受影响review回归通过；新测试类型兼容修正后12/12、`npm run check`、strict通过。

原RED、中间98/99失败、6项新测试类型诊断留在 `/var/tmp/hermes-14-envelope-Bu9HnW`。泛化 `Private:` 不匹配现有有界识别词的错误fixture已改为既有 `Secret:`；没有为探针扩张来源分类。`findLast` 改为既有ES2022兼容写法、Source使用完整来源对象比较；不是core/tsconfig变更。

## 补测结果与来源

四次新请求，证据 `/var/tmp/hermes-14-swe-second-TlACPs`，`result.json`、`requests.jsonl`、6个stage JSON、`parent-semantic-check.json`。117产品路径在调用前后相同；只在fixture内使用public SessionManager持久化已批准虚构样本，没有伪造assistant回复、直接seed MemoryStore或过滤模型输出。独立原生用户entry为偏好、项目事实、临时要求；完整当前快照审查（不是私下增量截取）。

| 请求 | 保守输入估算 | 规范输入/输出 | 实际结果 |
| --- | ---: | ---: | --- |
| A提炼 | 4049（账本4060含工具元数据） | 1402/357 | saved：USER偏好与PROJECT事实各1条；GLOBAL0；临时要求0 |
| A新会话使用 | 2778 | 1158/108 | “This project uses **Cedar build**, and you usually prefer **concise** explanations.” |
| B更正 | 4441（账本4452含工具元数据） | 1566/250 | saved：同一USER ID更正为 detailed，PROJECT不变 |
| B新会话使用 | 2779 | 1157/223 | “Build tool: Cedar build; Preferred explanation detail: ... **detailed answers**.” |

稳定偏好ID `bec6ddd036fe7fe10a510b0d51808c09` 保持；项目ID `6918eefef4cfa6bb10a69157ab278dc4`。A来源session `01a13003-5a66-7517-8a04-18326a14ba4b` 的用户entries `c7f62bc6` / `a8028cef`；B新来源session `01a13003-954d-7517-8a04-18371d8cdcd9` 的更正entry `9d890fdc`。原生来源文件、精确quote与实际存储metadata读回一致，review没有写入主对话。

两次使用均是public runtime真正新建的session，当前用户只有同一问题：“Which build tool does this project use, and how much detail do I usually want in explanations?” 未重复期望答案。public `getCurrentSystemPrompt` 合并的有效section和真实wire均有对应记忆；B只含详细偏好，没有旧简短偏好。parent最初只检查`system.content`的本地断言失败已记录，结构化`sections.hermes_memory`和wire核验通过，不重发模型请求。回答语义经父级核对，不把关键词regex当通用效果判定器。

C复用首轮真实 `candidates:[]` 与本地negative回归，0新增请求。补测A/B返回裸JSON；它们证明新来源布局下的真实保存/复用，不冒充真实模型在本轮走过围栏分支。围栏接纳的宿主路径由原生faux回归验证。

## 验收结论与用量边界

真实代表性闭环现已成立：2条有原生来源的稳定新增、1次保留ID的明确更正、2次真正新会话事实使用；临时/无内容样本实际错误长期化0。首轮1/3审查意图预算跳过，补测0/2；合计5个审查意图、4辅助提交、2个no-proposal、2个saved请求，不拿调用少或无报错代替效用。前台总7次，辅助总4次。

补测原始usage：input4835/output938/cacheRead448/cacheWrite0/reasoning0/total6221；规范输入5283。两轮累计11次：原始input9708/output3100/cacheRead3136/cacheWrite0/reasoning0/total15944；规范输入12844。全部reported，无unknown；所有可配retry为0，退出无paid flush。**金额仍未知，cost0占位不是免费或发票。** 初始工厂设置错误未进入adapter，不计作额外远端请求。

这是少量虚构样本的提炼/保存/事实复用验收，不是自动调度大负载、实际私人工作、跨模型质量、偏好普遍服从、物理TCP或账单证明。原首轮失败与已接受7.1–7.3证据不被覆写或重新判定。无需扩大预算、真实companion或外接backend。

