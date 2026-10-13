# Task7.3 — 临时项目公开原生生命周期证据

## 边界与候选

本次只新增隔离探针、操作文档及本地 OMD 历史保留连线；`src/`、既有 `test/`、package 和 OpenSpec 正文只读。父级 owns acceptance/checklist；当前24/26，7.3 尚未勾选。没有外部 backend、私人数据迁移、真实 provider 花费或 companion 改动。

起点 `/var/tmp/hermes-73-start-PIfAg9/repo`：113 paths，manifest SHA256 `5c110c5f5f4799b2afc800b473cc9cffe3b573b2eeff986615bca821964c2594`。新探针和原始证据根：`/var/tmp/hermes-73-lifecycle-7JYodz`。

## 公开原生执行

探针 `probes/lifecycle.test.ts` 使用当前实际 `createMemoryExtension`、stock Pi0.99.2公共 `AgentSessionRuntime.newSession` / services、现有 `sdkFixture`、synthetic provider。HOME/USERPROFILE/agentDir/auth/settings/cwd/sessions 全在 `/var/tmp`；`projectTrusted:false`，网络/发现/resources/retries关闭。所有用户变更经注册工具或命令，没有以 Store 直接 mutate/add/forget 替代；Store/ledger 仅用于读回断言。Provider callback 内捕获 payload/options，callback 外断言。

### 创建、记忆与新 session 注入

临时项目 `/var/tmp/hermes-sdk-X9XJzf/project`；agentDir `/var/tmp/hermes-sdk-X9XJzf`。真实前台 `hermes_memory remember` 保存 USER 偏好及 PROJECT 事实，分别落到 agentDir 与显式解析项目根；GLOBAL 为空。两次 native foreground provider calls，辅助0。

- 原 session `01a10cd5-07f7-77bd-a8c7-7f12acfff05c`，真实用户 entry `4e60893a`。
- 经公共 runtime 真正创建新 session `01a10cd5-0858-77bd-a8c7-7f14c4b9ac61`，新ID/file，header cwd仍同项目。
- 实际新请求的当前 owned memory section 含 `[user version=…]` 的 `I prefer concise answers.` 及 `[project version=…]` 的 `This project uses Cedar build.`。不是旧原生聊天继续承载事实。
- 原 session JSONL byte/hash保持不变；文件版本、事实ID、原生来源与原始字节均在 `logs/01-remember.json` / `02-new-native-session-injection.json`。

### 本地 search/read

真实 `hermes_session_search` tool 经过生产 SessionRecall/SessionIndex 返回 `groups[].locator`，命中原 session/entry。后续 sessionId/entryId read 返回真实原始正文、coverage、预算字段，没有辅助 inference 或历史改写。Search、read 各为 native tool请求+回答两次 foreground calls；总辅助仍0。原始 locator和source hash见 `logs/03-search.json` / `04-read.json`。

### 更正与实际费用

新 session 中整条原生消息为 `Correction: "I prefer concise answers." -> "I prefer detailed answers."`，entry `e121e98b`。显式 `/hermes-review run` 的单个生产独立请求提案引用该新entry和同一已读旧ID；宿主自动更正实际 USER 文件，保留ID、改变版本与来源。没有放宽语法、来源或审批。

请求 `8fa9efe6-5a58-4797-ad1e-91949132a2a2` saved/reported；捕获 options为 maxRetries0、maxTokens4096、toolChoice none、timeout90000。同模型/full effective snapshot；辅助结果不改变 native bytes/messages/leaf。下一实际请求的当前 owned section 只有 detailed新事实，没有 concise旧事实。`logs/05-correction.json` / `06-corrected-injection.json` 留有提案、usage、旧/新版本及payload。

### 遗忘、批准与保留副本

无UI `/hermes-memory forget user <id>` 返回 confirmation-required，文件未变。公共 UI double明确模拟批准（不是人类或真实TUI）；真实 forget命令提交，USER entries为空，tombstone含原ID。下一请求 owned section 不含旧/新偏好，PROJECT事实仍注入。

原A JSONL仍保留旧事实，B原生correction仍保留新事实；USER备份、journal和生命周期receipt仍存在。遗忘是未来资格移除，不是原始历史/副本擦除。批准preview与retention说明、前后字节见 `logs/07-forget-preview.json` 至 `09-forgotten-injection.json`。

### Automatic OFF 与完全不加载

实际写入仅fixture自己的 `<agentDir>/hermes-memory/config.json` 为 `{"automaticReview":false}`，status OFF。随后前台remember保存 `I prefer runnable examples.`，10条真实新用户工作仍有owned注入、无新增辅助。已有辅助账本/费用保留。

再经公共runtime新建session，资源加载器实际为 `noExtensions:true` + `extensionFactories:[]`（其他发现关闭），并非虚构产品“disable”设置。新session `01a10cd5-0a86-77bd-a8c7-7f162718bdd1` 的10次实际请求没有owned memory section或hermes工具，无插件辅助；原Markdown和JSONL byte/hash仍可读且未删除。见 `logs/10-automatic-off.json` / `11-full-extension-disabled.json`。

## 新鲜结果与保留失败

最终 `logs/lifecycle-05.*`：一个完整端到端 native case通过。**32 foreground + 1 auxiliary =33 actual provider calls**，账本 daily requests1，errors空。`logs/lifecycle-summary.json`为有界索引，完整分阶段字节、来源、版本和请求在11份stage JSON中。

前四次失败是探针消费公开返回形状的设置错误，原探针版本及失败stage均保留，不改生产代码或原标准：

1. run01误用search.hits而实际是groups/locator。
2. run02把历史system deltas全部拼接当作当前owned section；改用公共getCurrentSystemPrompt后提取当前section。
3. run03错误给memory UI通知套`.detail`；实际memory通知是detail自身。
4. run04切换绑定模式后忽略仍在工作的UI double通知；捕获真实stdout或通知入口，不将其冒充print/TUI测试。

更正后正例单独通过；这是宿主机制证据，不是模型识别率、服从性、远端发票或物理TCP证明。真实成本/TUI adversarial行为复用源码相同且父级已接受的 [7.2证据](review-cost-ui-evidence.md)，不重新跑402或旧对抗套件。

## OMD 与父级收尾

`.omd/`保留既有store/root/history，以实际CLI追加current source/range及有理由的显式关系adapt。`docs/traceability-map.json`是派生receipt，不替代关系历史；当次实际verify/check/targeted-link结果及counts见 [traceability](../docs/traceability.md) 和冻结logs。Healthy端点不是语义测试证明。

Parent接受后才能勾选7.3；tasks.md已被追踪，勾选会使hash再次变化。最终交付包含对该一个checkbox的最小file/range/下游选择同步配方；不会声称当前metadata跨未来编辑永远健康。

## 历史边界：7.3 时未执行任务1.4

交付7.3时，1.4未执行，尚需独立真实费用授权及用户批准的少量脱敏快照；本页synthetic lifecycle和已接受7.2不构成这些授权，也不是1.4真实效果证明。后续用户已另行授权两轮SWE样本测试：首轮失败保留，窄修补及四次补测贯通实际保存/更正/新会话事实使用，见 [Task1.4独立证据](real-model-swe-evidence.md)。这是后续状态引用，不重新验收7.3或改写其冻结原始收据。
