## Purpose

让稳定偏好和事实无需用户反复说“记住”即可被提炼，同时以当前上下文快照、单一调度入口、可取消任务及可见预算控制自动化，防止后台失败、重复请求和隐藏费用损害用户对记忆系统的信任。

## ADDED Requirements

### Requirement: Foreground and snapshot extraction
系统 SHALL 支持前台主动记忆工具与默认当前有效分支快照审查；后台输入包含已存在的压缩摘要，而非自动恢复所有历史或仅取新增消息。默认同模型，服务端缓存命中不构成成功前提。

#### Scenario: Implicit stable preference
- **WHEN** 用户自然表达稳定沟通偏好但没有说“请记住”
- **THEN** Agent 可通过前台工具或符合调度条件的审查提出记忆；系统记录来源，不声称每次模型都能正确识别

### Requirement: Schedule on user work not model loops
自动审查 SHALL 在前台稳定结束后由一个统一入口调度；按用户轮次和有效任务活动分别计数，模型工具循环、review 自身和重复事件不能冒充新用户轮次。压缩/退出不得另起独立收费 flush。

#### Scenario: Many tool iterations
- **WHEN** 三条用户输入产生四十次模型工具循环
- **THEN** 用户计数仍为三；不因误计用户轮次连续重发整个历史，重复快照被去重

### Requirement: Preflight and durable budget reservation
后台请求 MUST 在发出前校验并预留单任务、累计输入/输出、调用次数及时间预算。超限 SHALL 显示未执行；默认不得静默重试、改变模型、启动子进程或隐式切换增量模式。

#### Scenario: Budget exhausted
- **WHEN** 全局累计预算不足或完整快照超过本次限额
- **THEN** 不发送请求，显示限制原因和手动处理入口；重启、reload 或切项目不会清零累计债务

### Requirement: Account for every charged outcome
每次提交到 provider 的请求 SHALL 具有独立记录；changed、no-change、failed、cancelled 和 usage-unknown 都计入总账。无价格或 usage 时 MUST 显示未知，不显示零费用；重复回调不得重复计量。

#### Scenario: Empty completion after consumption
- **WHEN** 请求只返回 reasoning、空内容或不可解析文本
- **THEN** 记录实际/未知用量和 no-proposal 或 failed，不写记忆、不转入第二个隐藏请求

### Requirement: Persistent visible failures
TUI SHALL 持续显示后台状态、最近结果、累计 input/output/cache 用量和预算，以及尚未确认的错误；提供可打开的明细。错误不能只写日志或一闪而过，非 TUI 模式 SHALL 保存结构化状态。

#### Scenario: Provider failure
- **WHEN** 后台请求失败而前台正常回答
- **THEN** TUI 同时保留前台结果与后台失败标记，自动审查暂停；用户可以查看原因与已用/未知 token，不会误以为后台没有执行

### Requirement: Explicit unknown-usage recovery
系统 SHALL 仅在用户查看并明确确认后，将未知旧请求的完整预留计入确认 UTC 日的一次预算消耗；actual usage 保持 unknown，不自动重放。记账 MUST 在锁内幂等并检查存活 owner 与日期高水位；日期回拨或存活请求不能被确认消除。已确认请求不重复扣原始日期；迟到遥测保留历史、不自动退款，超额重新暂停。

#### Scenario: Confirm recovery without replay
- **WHEN** 用户确认已预览、未变化的未知记录
- **THEN** 完整预留只计入确认日一次；新调用仍受剩余额度限制，正常下一 UTC 日刷新；新出现的未查看失败继续阻止恢复

#### Scenario: Confirmation becomes stale or unavailable
- **WHEN** retry 的旧记录或当前 generation/session/project/leaf/快照/model/预留变化，或没有可用公共确认 UI
- **THEN** 拒绝原确认并要求重新预览或返回 confirmation-required；不记恢复消耗、不恢复、不发新的收费请求

### Requirement: Main-session isolation and cancellation
后台审查 MUST NOT 切换主会话、移动主分支或写主聊天；新输入、分支/项目变化、关闭和用户取消 SHALL 撤销旧结果的提交资格。取消并不意味着已发出的请求不收费。

#### Scenario: Late response
- **WHEN** 用户切换项目后旧 provider 响应才返回
- **THEN** 丢弃旧提案、保留计量；不将项目 A 的事实写入 B，也不向主会话追加审查对话

### Requirement: Validated proposals and user-controlled deletion
受管记忆的有效新增和非冲突更新 SHALL 自动提交；后台删除、遗忘或有矛盾的用户画像改写 SHALL 进入可见待确认队列。模型提案不能直接执行任意文件、网络或终端操作。

#### Scenario: Reviewer removes an old fact
- **WHEN** 无人值守审查建议删除已有记忆
- **THEN** 原记忆保持不变并显示待确认差异；已知旧值与最新用户明确更正的非破坏性更新仍可按受管策略提交

#### Scenario: Supported explicit correction
- **WHEN** 通过其余来源与安全校验的后台替换提案引用的整条原生用户消息（允许前后空白）为 `Correction: "旧事实" -> "新事实"` 或 `更正：“旧事实” → “新事实”`，旧值、新值、目标及读取版本均匹配，且没有后续相关更正行撤销其自动资格
- **THEN** 可通过受管入口自动更新同一条目；该首版大小写/引号/箭头敏感格式不等于通用自然语言识别，也不保证模型必然提出合格提案

#### Scenario: Unsupported or later-qualified correction
- **WHEN** 通过其余来源与安全校验的替换提案来自其他措辞或带额外正文的更正，或较早的合格提案之后出现含相关已支持更正行的冲突、限定或否定消息
- **THEN** 不自动覆盖旧值，整目标批次进入待确认；有效兼容的完整重复更正不撤销资格，普通稳定事实新增无需上述格式，删除仍始终需要批准

### Requirement: Shared review without required companion
记忆插件 SHALL 独立可用；与 skill 插件共存时 SHALL 合并同一快照的审查目标、共享预算并只计一次总费用，各自验证和写入自身文件。协调失败 MUST 暂停自动收费，不能退化成重复独立请求。

#### Scenario: Mixed lessons
- **WHEN** 同一任务产生沟通偏好和可复用开发流程，两个插件均启用
- **THEN** 一次审查返回两类提案，记忆插件只处理偏好，skill 插件只处理流程，各自报告提交结果

### Requirement: Complete disable and explicit retry
关闭自动审查 SHALL 禁止所有自动模型调用，但保留记忆读取、检索、手动工具与本地排队。失败后只有用户明确重试才能再次花费；重试前 SHALL 展示模型与剩余预算。

#### Scenario: Disabled during shutdown
- **WHEN** 自动审查已关闭且 session 退出或发生压缩
- **THEN** 不运行模型总结或 correction fallback，仅保存已有本地状态

### Requirement: Learning usefulness is observable
系统 SHALL 分开报告准入、预算跳过、无提案、错误长期化、冲突、保存及后续使用。验收 SHALL 以代表性偏好/项目事实贯通提炼、保存、新会话注入或召回，不能把无请求或无报错当作学习有效；真实模型效果不得由 fake-provider 测试替代。

#### Scenario: Safe but ineffective defaults
- **WHEN** 初始预算或单请求策略使代表性正例无法完成提炼和后续使用
- **THEN** 报告效用未达成、原因和实际消耗，带证据请用户调整；不以“没有超支”宣布自动记忆验收通过
