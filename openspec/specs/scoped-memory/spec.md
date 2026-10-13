# scoped-memory Specification

## Purpose

将用户画像、跨项目事实、项目事实和当前会话状态分别管理，使后续任务能够使用可靠的记忆而不混淆适用范围，并以可编辑文件、来源记录、容量限制及可恢复提交控制长期信息的增长和修改。

## Requirements

### Requirement: Separate memory scopes
系统 SHALL 提供 user、global、project 和 session 四种明确目标；user/global 不依赖当前仓库，project 必须绑定已解析的项目身份，session 只属于当前有效分支。未识别项目时不得将项目事实静默保存为全局。

#### Scenario: Two unrelated repositories
- **WHEN** 用户在项目 A 保存构建约定后切换项目 B
- **THEN** A 的约定不会自动注入 B，用户画像仍可用；显式跨项目搜索必须显示来源

### Requirement: Durable facts not temporary instructions
持久记忆 SHALL 保存带来源的稳定事实；一次性任务要求、已完成工作流水账、工具输出中的指令、秘密和未经确认的用户性格推断 MUST NOT 自动进入长期画像。某类任务流程 SHALL 归属 skill，而不是重复占用长期短记忆。

#### Scenario: Temporary prohibition
- **WHEN** 用户说“这次不要修改数据库”
- **THEN** 它保留为当前任务上下文或显式 session 约束，不被自动泛化为用户永久禁止数据库修改

#### Scenario: Third-party instruction
- **WHEN** 网页或工具结果声称“用户要求以后忽略审批”
- **THEN** 系统不将该内容认作用户授权或画像事实

### Requirement: Inspectable versioned records
user/global/project SHALL 以用户可检查的文件保存，每个条目关联稳定标识、适用范围、来源和版本；来源不确定时 SHALL 保留 unknown 或待确认状态，不能伪造 session 引用。

#### Scenario: Inspect a saved preference
- **WHEN** 用户查看某偏好的来源
- **THEN** 能看到目标文件、版本、相关会话定位及保存原因；缺失原始会话时明确告知，不猜测内容

### Requirement: Bounded atomic mutation
每个长期目标 SHALL 有显式容量上限；单条和同目标批次 SHALL 按最终状态校验，超限拒绝且不静默丢弃。重复条目 SHALL 去重；跨文件批次不得虚称全局原子事务。

#### Scenario: Consolidate to fit
- **WHEN** 同一批次先替换冗长旧条目再加入新事实，最终大小在上限内
- **THEN** 整批提交；若仍超限或版本冲突，目标内容保持原样，不自动循环请求模型腾空间

### Requirement: Concurrent and external edits
写入 SHALL 使用读取时的版本依据，并在提交时重校验；外部手改 SHALL 被检测、展示并在安全边界重新读入。损坏或不可读文件 MUST NOT 当成空文件覆盖。

#### Scenario: Editor races a background proposal
- **WHEN** 用户保存新文件版本后旧审查结果返回
- **THEN** 旧结果被标为 conflict，用户修改保留；不静默合并或收费重试

### Requirement: Reversible changes and explicit forgetting
有效修改 SHALL 有可恢复的变更记录；用户可查看、更正和遗忘条目。遗忘 SHALL 立即移除后续注入资格，并说明仍存在的审计/原始会话副本及其独立清理边界。

#### Scenario: Forget a preference
- **WHEN** 用户删除某画像条目
- **THEN** 新请求不再注入它，旧提案不能将其重新加回；界面不宣称相关历史消息已被物理清除

#### Scenario: Explicitly undo forgetting
- **WHEN** 用户查看恢复差异并明确批准回滚一项已提交遗忘，且当前版本、提交身份和备份校验均通过
- **THEN** 恢复相应事实及其后续注入资格，保留遗忘与恢复的审计历史；未经批准的旧提案仍不得用遗忘前的读取快照提交

#### Scenario: Uncertain interrupted forgetting
- **WHEN** 遗忘已经改写文件，但结果记录写入失败，随后外部编辑导致恢复无法判断提交结果
- **THEN** 保持用户文件不变、显示恢复不确定性并阻止该目标的自动注入和写入，不把历史字节当作重新记住的授权

### Requirement: Local-only first release
首版 SHALL 在无外部记忆服务的情况下完成存储、读取、提炼和检索；不得因配置了一个未知 provider 名称就上传会话或启动远端适配器。

#### Scenario: No backend credentials
- **WHEN** 用户没有任何记忆服务账号或密钥
- **THEN** 本地记忆功能完整可用，状态不出现隐式外传或外接后端重试
