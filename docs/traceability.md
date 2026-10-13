# 当前实现追溯与交付核验

## 入口与权限

- [用户操作、存储和恢复指南](../README.md)
- [7.3 新鲜公开原生生命周期](../PLAN/lifecycle-acceptance-evidence.md)
- [7.2 已接受费用/TUI 证据](../PLAN/review-cost-ui-evidence.md)
- [proposal](../openspec/changes/archive/2026-10-12-add-managed-memory-lifecycle/proposal.md)、[design](../openspec/changes/archive/2026-10-12-add-managed-memory-lifecycle/design.md)、[tasks](../openspec/changes/archive/2026-10-12-add-managed-memory-lifecycle/tasks.md)
- [Hermes 源码参照与已批准差异](hermes-reference-decisions.md)、[共享审查契约](review-contract.md)
- [OMD 当前范围/连线派生 receipt](traceability-map.json)

父级已接受并勾选1.4及其余任务；当前change **26/26**，最终CLI状态与收尾记录见 `/var/tmp/hermes-14-swe-second-TlACPs/bookkeeping.json`。独立费用/样本授权后的 [真实SWE闭环](../PLAN/real-model-swe-evidence.md) 保存2条有来源事实、同ID更正1次、在2个真正新session中使用；两轮11次实际请求、15944 total tokens，金额未知。小样本事实使用不是普遍服从性或私人任务泛化证明。已接受7.3收据 `/var/tmp/hermes-73-parent-SrnOYG/acceptance.json` 和原两次writer FAILED状态保持。用户随后授权同步主规格与归档；4个主规格已同步，change位于 `openspec/changes/archive/2026-10-12-add-managed-memory-lifecycle/`，归档记录在 `/var/tmp/hermes-archive-KKlE4B`。没有启用个人配置。

## OMD 当前连线

权威是本仓库 `.omd/` 的原store/history；归档仅使用metadata rename迁移7个文件路径，保留file/range IDs与历史；没有重建store、delete/gc/reset/activate或全局/companion注册。历史规划10文件/67范围/110条healthy links是旧快照，不再冒充实现状态。

当前实际CLI观察：**49个file objects、158个Unicode-scalar ranges、298条healthy links**，归档后另有17个统计import对象：原10个历史对象保留，用户另行明确批准对7条旧统计范围追加退出标记并登记其归档路径；没有删除文件、范围、对象或历史，`omd check`已通过。7.3收尾时47/153/291是已接受历史快照。1.4仅追加所需源/范围观察、67条可达关系的逐link复核、2个新file/5个meaningful ranges/7条精确关系；最后单个checkbox再同步14次源/adapt操作及11条实际下游links。旧860个OMD路径除state/published外哈希未变，不重建store、不覆盖历史或重验7.1–7.3。

新增范围使用真实组件/方法、注册命令/tool和具体`node:test`调用的Unicode scalar坐标：

- 四份已归档delta的33条normative requirements与map key集合完全相同；已同步主规格的Purpose、requirements和42个scenarios另经完整比较相同。既有连线保留归档来源的ID，未另建33条主规格追溯体系。分别关联当前实现和对应可执行case，不是只检查healthy数量。
- 全26个任务均有父级验收；1.4连向真实SWE效用和独立用量范围，以及当前review实现，不以宿主fake机制代替真实效果。
- `gate:1.4`保留7.3时未执行的历史边界并指向后续独立实测；Learning usefulness另直接关联真实保存/更正/新会话事实使用。围栏native-faux能力与补测裸JSON提案分开，不把全部成功归因于解析修补。
- 7.3连向实际前台命令实现、既有学习闭环case和本次临时probe的来源/版本/字节证据段；scratch probe本身不塞进产品测试树。
- 7.2连向源码相同的已接受费用/TUI证据；未重跑402或历史对抗套件。

`traceability-map.json`包含file hash、原root/current tip、范围坐标/内容hash及实际查询出的link IDs/status。它是派生查询入口，非第二authority，不递归追踪自身。Components/test range的健康只说明端点当前可定位；不证明所有scenarios已跑、100%字符覆盖、模型质量、远端账单或真实companion兼容。

## 本次验证与限制

原始命令、CLI setup failures、显式adapt选择和新鲜probe证据位于 `/var/tmp/hermes-73-lifecycle-7JYodz`。初始OMD观察有13 dirty /17 locate；追加源/范围和逐关系复核后，实际`omd verify --json`、`omd check --json`通过，dirty/locate/missing/identity/obligations/open blocks均0，links broken/stale/unchecked/obliged均0。没有以旧planning healthy或测试总数替代当前核验。

新鲜7.3 end-to-end case：32 foreground +1辅助=33实际synthetic provider calls；真正的新native session注入、生产search/read、严格整条消息更正、可见批准遗忘、automatic OFF和完整不加载均有正例。公共UI double是决策模拟，不是真人/TUI证明；已接受7.2另有真实stock PTY。失败或unknown费用机制依赖源码相同的既有7.2证据，不为了保险重复运行整套。

Writer冻结候选的生产source、已有tests、package和OpenSpec字节保持交付起点一致。父级另在独立临时目录以仅改输出ROOT的原探针重放完整生命周期，1/1通过，同样32前台+1辅助；随后仅追加7.3勾选、对应OMD同步和派生追溯记录，未改运行代码。备份/audit/raw-history不因忘记或禁用被删除，没有外部backend或旧私人数据迁移。

## 核验命令

```sh
openspec validate --specs --strict
omd verify --json
omd check --json
omd links --json
omd links list --node range:<root-id> --limit 20 --json
```

`links list`每页上限100，按真实返回的`next`传`--cursor`；不是`--offset`。对meaningful source/range先观察fresh expected credential，再用实际`omd commit commit`追加历史。对已有range使用**当前tip**作为`--id`，旧root只用于定位，不可猜测重init或以旧ID覆盖链。

## 父级已完成的 checkbox 同步

父级接受后仅将tasks.md的7.3 `[ ]`改为`[x]`，1.4仍为`[ ]`。受保护脚本已执行且退出0；追加3次源观察、4次分层adapt，处理准确5条下游关系。随后strict/status/apply通过，CLI ready25/26，OMD仍291 healthy且无未决义务。派生map已刷新。本节是已完成操作记录，不应重跑。

执行顺序（可检查脚本/精确IDs见绑定交付和scratch `final-checkbox-sync.py`；writer未执行，由父级验收后执行）：

1. 仅改7.3 checkbox；对照交付manifest确认其他product字节未变。`omd verify --json`重新观察，保留可能的dirty返回及`.data.expected`。
2. 对tasks.md file追加一次`omd commit commit`；随后分别追加既有`tasks:7`组及`task:7.3`范围，使用新观察的current tip、现有Unicode坐标和fresh expected。不得重复init。
3. 查看`task:7.3`四条实际下游links与`implementation:memory-commands → verification:learning`传播link；依据“只改验收checkbox、source/test/probe不变”的语义选择各自真实pending changes，分层显式adapt。不要全store blanket ack。
4. 重新verify/check及targeted links；确保无新增dirty/locate/obligations，之后再刷新派生map receipt。若出现这五条以外的义务或其他文件变化，停下查明，不自动扩展同步。

OMD普通commit/adapt是本地metadata操作，不是Git commit。父级新hash/收据单独保存，未覆盖writer冻结候选；7.3证据页中的24/26与其收尾25/26均为历史快照。后续1.4的验收、精确checkbox同步和最终CLI/OMD记录独立保存在 `/var/tmp/hermes-14-swe-second-TlACPs`；没有追加模型调用、重新执行上述7.3配方或改写其runner状态。
