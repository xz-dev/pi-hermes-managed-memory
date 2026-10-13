## Purpose

将长期短记忆和当前任务状态以可识别版本送入模型上下文，使新会话无需回忆口令即可使用相关事实，并正确处理会话分支、压缩和作用域变化，而不把历史记忆升级为覆盖用户当前请求的授权。

## ADDED Requirements

### Requirement: Automatic bounded short-memory injection
启用的用户画像、全局和当前项目短记忆 SHALL 自动进入模型上下文；注入有总预算、来源、作用域和版本，不要求用户说“回忆”。无关项目条目及完整 session 历史不得随之全量加载。

#### Scenario: Fresh session
- **WHEN** 用户在项目 A 开启新会话并提出普通任务
- **THEN** 可用的稳定画像、全局事实与 A 的项目事实自动提供给模型；B 的项目事实不出现

### Requirement: Facts do not override current authority
注入内容 SHALL 标明是可过时的参考事实，而不是更高权限指令；用户当前明确要求、项目授权及工具门禁 SHALL 不被旧记忆覆盖。未经确认的推断不得伪装成用户原话。

#### Scenario: Current request contradicts preference
- **WHEN** 旧画像是偏好简短回答，而用户此次要求详细解释
- **THEN** 当前任务按详细要求处理；不因旧偏好拒绝，也不把这次例外自动改成永久偏好

### Requirement: Versioned refresh boundaries
记忆写入与注入版本 SHALL 分开记录；新会话、明确刷新、项目/分支切换和成功压缩后 SHALL 在下个有效请求应用最新允许版本。普通轮次不重复追加相同记忆，失败的压缩不能伪称刷新成功。

#### Scenario: Mid-run compression
- **WHEN** 工具执行期间发生压缩，磁盘记忆已有新版本
- **THEN** 下一个模型请求能识别新版记忆，不必等下一条用户消息；旧注入不会作为另一份并列有效事实累计

### Requirement: Preserve explicit session constraints
系统 SHALL 提供当前任务约束的显式登记与查看，并按当前分支恢复。已登记的有效约束 SHALL 在压缩后仍可见；取消、替代或完成后的约束不得在新任务或新分支自动复活。

#### Scenario: Added restriction before compaction
- **WHEN** 用户追加的“本次不要部署”被登记为当前任务约束，随后发生压缩
- **THEN** 约束及用户来源在压缩后保留，直至该任务结束或用户明确撤销；不写入永久画像

#### Scenario: Unregistered instruction
- **WHEN** 用户要求只存在于普通会话历史而未被显式登记
- **THEN** 系统依赖 Pi 原生历史与压缩，不声称能够机械地保证每项语义要求永不丢失

### Requirement: Explicit task lifecycle boundaries
当前 taskId SHALL 只因显式前台开始、切换或完成操作改变；普通新输入、assistant 结束、settled 或 compaction MUST NOT 自动推断任务结束。新任务 SHALL 不继承上一 taskId 的约束，取消/替代/完成后的旧版本不得自动取得 active 资格。

#### Scenario: Continue the same task
- **WHEN** 当前任务已有登记的“不部署”约束，用户继续讨论该任务而未显式切换或完成
- **THEN** taskId 与活动约束保持，后续有效请求仍有约束及来源；不把每条新输入当成新任务

#### Scenario: Explicitly start another task
- **WHEN** 前台显式选择一个新的 taskId
- **THEN** 新任务不注入旧 taskId 的约束；保留原生历史，不通过合并全部分支或重放旧记录恢复已失效资格

### Requirement: Active constraints precede facts within the shared budget
系统 SHALL 在现有总注入预算内先完整容纳当前任务所有 active 约束及来源/作用域/版本，再选择完整长期事实条目。超限新登记 SHALL 被拒绝且保留原状态；不能保存 active 状态后又声称可省略其约束。不得通过额外模型请求缩短约束或提高预算。

#### Scenario: Registration would exceed capacity
- **WHEN** 新约束加入后全部 active 约束及必需 metadata 无法完整装入总预算
- **THEN** 拒绝登记并明确报告容量原因；既有约束状态、原生历史和长期文件不被修改

#### Scenario: Existing active constraints no longer fit
- **WHEN** 用户收紧预算，已有 active 约束及必需 metadata 已无法完整装入
- **THEN** 阻止该次正式模型请求并显式提示恢复预算或处理约束，不省略约束后继续；已登记状态保留，未产生辅助总结调用

### Requirement: Branch-aware session state
session 状态 SHALL 从当前有效分支恢复，不从整个 JSONL 的所有分支合并；原分支已提案或已处理标记不得让另一分支错误跳过或重复提交。

#### Scenario: Switch to a sibling branch
- **WHEN** 用户跳到没有某临时约束的兄弟分支
- **THEN** 该约束不再注入，旧分支的异步任务不能提交，新分支有独立的恢复状态

### Requirement: Local compaction checkpoint without hidden model work
压缩前检查点 SHALL 只捕获必要的本地版本和 session 状态；成功/失败事件分别处理，不在压缩或关闭钩子中追加未纳入预算的模型总结。

#### Scenario: Compression fails
- **WHEN** Pi 原生压缩失败或被取消
- **THEN** 插件保留原 session 状态，丢弃未提交的边界更新，不重复启动后台提炼

### Requirement: Explain what was used
用户 SHALL 能查看本轮注入目标、版本、大小、裁剪/缺失原因及来源；此诊断不得再次把完整私人记忆或凭据写入普通日志。

#### Scenario: Injection budget too small
- **WHEN** 配置预算无法容纳启用的短记忆块
- **THEN** 系统显示未注入条目及原因，不静默截成错误事实，也不通过额外模型请求自动压缩文件
