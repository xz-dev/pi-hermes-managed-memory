## Purpose

在不复制整个聊天进模型且不要求专用远端记忆服务的条件下，提供可溯源的 Pi 会话搜索与按需恢复，明确项目、会话分支、内容预算和索引失效行为，使历史存在与实际召回成为可分别验证的能力。

## ADDED Requirements

### Requirement: Native session source of truth
检索 SHALL 使用官方 Pi session 数据作为事实来源；索引只作为可删除重建的派生数据，不重写原始 JSONL，不以摘要替代原始证据，也不要求外部服务。

#### Scenario: Index deleted
- **WHEN** 派生索引丢失或版本不兼容
- **THEN** 可以从仍存在的 Pi 会话重建；检索明确报告准备状态，不删除或改写原会话

### Requirement: Explicit scope and provenance
搜索 SHALL 默认限定当前项目，并支持显式会话和跨项目范围；结果 SHALL 给出 session、entry、分支关系和时间/文件定位。分叉复制内容应去重展示，历史引用不等于当前用户新指令。

#### Scenario: Similar text in two projects
- **WHEN** A 与 B 都讨论相同工具
- **THEN** 默认只返回 A 的可用范围，显式跨项目搜索显示每条来源；不把 B 的约定注入 A 的项目记忆

### Requirement: Bounded search then bounded read
搜索 SHALL 返回有界片段和分页标识，详细读取另行请求；预算、截断和下一段入口可见。巨大的工具输出不能通过单条命中绕过总结果预算。

#### Scenario: Large historical tool output
- **WHEN** 某命中消息包含数十 KB 的构建输出
- **THEN** 只返回预算内片段和定位信息，需要时再按段读取，不自动发送完整输出到模型

### Requirement: No hidden inference during retrieval
普通索引、关键词搜索和原文读取 SHALL 不调用模型；如果结果不足，返回不足或无命中，而不是暗中启用 LLM 摘要、embedding 服务或远端 fallback。

#### Scenario: No match
- **WHEN** 查询没有可靠结果
- **THEN** 返回明确无命中，不产生后台模型费用或虚构回忆

### Requirement: Incremental indexing and noise filtering
索引 SHALL 识别追加、修改、损坏及缺失会话文件，避免每次搜索重新提炼全库；自身审查和明确后台噪声 SHALL 默认排除，过滤条件可解释。

#### Scenario: Session truncated or removed
- **WHEN** 已索引会话被用户修改或删除
- **THEN** 过期命中被失效，读取报告来源不可用，不能用旧缓存内容冒充当前原文

### Requirement: Recall guidance without recall guarantees
系统 SHALL 指导模型在相关历史可能存在时使用检索工具，无需固定“回忆”口令；不得声称模型每轮必然搜索或召回全部相关事实。

#### Scenario: User references earlier work
- **WHEN** 用户提到以前讨论过的决策
- **THEN** 模型可直接检索对应历史并给出来源，不要求用户重复全部背景；查不到时坦诚说明
