# Task 7.2 — 跨功能费用与 TUI 验收

## 结论与候选

父级接受 7.2；未修改产品源码或仓库测试。候选为 `/var/tmp/hermes-72-start-N5zu4x/repo`，112 个路径，manifest SHA256 `fe4dac52539e91b0a596fb8e982b35cb7b6d430d6d4e2565d220ada96272a4e2`。

- 父级收据：`/var/tmp/hermes-72-start-N5zu4x/acceptance.json`。恢复执行时重新核对并刷新了该收据；原收据字节未另存，不将刷新后的时间当作首次验收时间。
- 独立报告：`/home/xz/.pi/agent/sessions/--home-xz-Code-ai-pi-hermes-managed-memory--/subagent-artifacts/outputs/4b2fd69f-4404-4b22-8e19-82763c587558/verification/7.2-cost-tui.md`。
- 冻结证据：`/var/tmp/hermes-72-verify-8A38j4`；140 个文件的 manifest SHA256 `c6d503321c2e7788d723c3ffc514343371dc596c06d9bd3725d4d4b700db4e26`。
- 父级核对了 140 个证据文件、候选/运行副本/当前仓库三处 112 路径，阅读关键探针并检查原始调用、账本及终端关联；没有另跑重复测试。

## 行为证据

| 边界 | 实际观察 |
| --- | --- |
| changed / no-change / 无效结果 | 自动 PTY 第十条原生用户消息触发实际保存；新跑 outcomes 覆盖重复事实 no-change、空输出、reasoning-only、无效 JSON、模型工具请求、返回错误、限额及超时。无提案不等于免费，未隐藏重试。 |
| 有进度后出错 | `logs/partial-error.json`：start/text_start/非空 text_delta 后 error；1 次辅助请求、failed/reported、无保存。原始 input20/output7/cacheRead3/cacheWrite2/cacheWrite1h1/reasoning4/total32 保留，归一化 25/7；重复终态未重复结算。 |
| 流无终态关闭 | `logs/abrupt-end.json`：有进度后 end，无 done/error；公共 API 的 result 仍待定，经测试配置的 100ms 宿主期限取消。usage/价格未知，64000/4096 完整预留保留，暂停且无第二次辅助请求。不是物理 TCP 断线证明。 |
| 已提交请求被杀后重启 | `logs/crash-verified.json`：实际 provider 回调与账本 owner 都为自有 PID2561346；10 次成功前台后第 11 次调用为辅助请求，再 SIGKILL。原生同 session/project/agentDir 重启保留请求 `b8988afb-2abc-4713-89c3-5ab620e6515f`、unknown 及完整预留；重启只有 2 次前台、0 次辅助调用。没有用仅预留的崩溃替代。 |
| 恢复与结构化可见性 | 崩溃后 status/usage/errors 在 reload 前后关联同一未知请求；无 UI 的 retry 返回 confirmation-required，未确认、未记恢复消费、未重放。 |
| 自动审查真实终端 | stock Pi 0.99.2 InteractiveMode/Linux PTY：请求 `84318935-7e57-4c0b-9e76-cc2c7fe31f8f` saved/reported；第二次 `fd98200f-3a37-458b-95e4-28bfa24830ac` 实际派发后取消。第 21 次前台回答和 reload 后仍显示 PAUSED、errors1、Latest cancelled、unknown usage1、64000/4096 未结预留及同一请求 ID。总计 21 前台 + 2 自动辅助；正常退出未增加调用。 |
| 原始用量与价格边界 | 合成 SDK estimate $0.053 与 unknown price 分开显示；PTY 日累计 64025/4103、请求2，剩余191975/12281，cache3/2、unknown cache1。未知实际量不冒充零，不把 known subtotal 当完整账单。 |
| OFF / 原生压缩 / 退出 | 原 6.4 三个 OFF 用例只改 import/output-root 后在当前代码重放：原生显式压缩 success/failure/cancel 为2/1/0调用，自动辅助均0；随后各1次明确手动审查。reload 与 public runtime dispose 不新增调用。总调用20/19/18，不声称所有模型调用为零。 |
| 迟到遥测与部分提交 | 复用源码相同且已接受的 7.1 A3（实际 A→B、迟到结算、不写旧结果）及 A1（部分成功、丢失 ack、一次扣费）；哈希关联见 `evidence-mapping.json`。不重开 7.1。 |

新鲜执行 19 项：stream2 + crash1 + 自动PTY1 + OFF3 + outcomes12；strict 通过。此前全套402及类型检查属于源码相同的既有证据，未重复运行、未并入19项。原 outcomes 中回调内参数断言的局限保留；新探针在回调内捕获请求、回调外断言。

## 保留的失败与限制

PTY run01 在原生 session 尚未持久化时读取文件，ENOENT；run02 错配旧 Running 标记，导致过早快照。run03 使用新标记窗口和已派发且 PID 匹配的收据后通过。原失败、原探针版本和输出均保留，未弱化结果断言。

这是合成 provider 的公共宿主/流/费用机制及 Linux PTY 验证，不证明模型提炼质量、远端账单、物理网络故障或所有结果×显示模式组合。仅在实际派发后杀进程，不穷举写事务每个崩溃点。实际 companion/peer-alone 兼容性仍未验证。

358 个受保护路径的比较单列于证据；仅既知 Hindsight cursor/queue/receipt 路径允许报告运行期漂移，收据保存具体 hash，原因未证明、不恢复。不得泛称全部 metadata 未变。

1.4 仍需独立费用授权与用户认可的脱敏样本；本页不接受 1.4 或 7.3，不声称整个 change 完成。
