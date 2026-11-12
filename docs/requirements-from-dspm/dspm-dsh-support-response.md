# dsh → dspm 支持需求回复（Phase 3）

- 答复方：deepseek-harness（dsh）侧
- 日期：2026-11-07
- 基线：需求文档与本回复均以 dsh `skill-output/dspm-dsh-support-requirements.md`（2026-11-05，基线 `fb8b38fa68`）与 `dspm-dsh-support-evaluation.md`（2026-11-05）为输入；交付证据以变更线 `da8e79a698`（D1）与 `f148f8aeca`（D2）为准，版本线 0.2.1-alpha.1
- 性质：对九项需求的正式答复；P0 两项已**交付并全绿归档**，其余按评估建议给出排期/路径/婉拒理由与待确认清单

## 1. 答复总览

| 编号 | 需求 | 答复 | 状态 |
| --- | --- | --- | --- |
| REQ-D1 (P0) | 权限策略 ACP 配置入口 | **已交付**（薄入口 + `always` 档 + 预设目录 option） | ✅ 交付并部署验证 |
| REQ-D2 (P0) | 技能列表 ACP 枚举 | **已交付**（`session/skills_list` 扩展方法，双旗标无过滤） | ✅ 交付并部署验证 |
| REQ-D5 (P1) | 计划模式经 ACP | 接受，第二期（`set_mode` + `modes` 广告 + plan-review 复用 `request_permission`） | 🗓 已评估排期，未开工 |
| REQ-D4 (P1) | 压缩经 ACP | 接受，第二期（`session/compact` + 完成通知） | 🗓 已评估排期，**有一项待 dspm 确认**（§4.2） |
| REQ-D3 (P1) | 多 provider 配置 | 接受为第三期优化项；**零代码路径今天可用**（§4.3） | 🗓 优化项 + 立即可用路径 |
| REQ-D6 (P2) | userQuestions ACP 化 | 接受，按需触发（不阻塞 P1） | 🗓 按需，附预期管理（§4.4） |
| REQ-D8 (P2) | 导出开放 | 延后（P2 末位，双路径均可行，请偏好答复 §6） | 🗓 延后 |
| REQ-D7 (P2) | 文件通道 ACP 化 | **婉拒**——dspm MCP 方案即认可形态 | ❌ 婉拒（§5.1） |
| REQ-D9 (P2) | goal 经 ACP | **婉拒**（两项结构性障碍）；「goal 属 dsh 私有体验」将文档化 | ❌ 婉拒（§5.2） |

P0 两项的交付证据（双方验收可直接引用）：

- 变更记录：`logos/changes/archive/20261107-1203-dsh-acp-permission-policy/`（D1）、`logos/changes/archive/20261107-1447-dsh-acp-skills-list/`（D2）。
- 部署报告：`logos/resources/verify/deployment-report.md`（D1）、`logos/resources/verify/s50-deployment-report.md`（D2）——均为本地 staging 等效环境的真实 WebSocket 冒烟 + 全量门禁（Gate 3.6/3.8 PASS）记录。
- 升级指南（中英文）：`docs/upgrade-guide/v0.2.1-alpha.1/acp-permission-policy/`、`docs/upgrade-guide/v0.2.1-alpha.1/acp-skills-list/`。后续每个 ACP 面变化继续按此先例提前同步 dspm。

## 2. REQ-D1 交付详情（权限策略入口）

会话配置新增两个 option id，经既有 `session/set_config_option` 应用，`session/new` / `session/resume` 响应的 `configOptions` 中广告，跨 resume 持久（落会话日志折叠）：

- **`permission_policy`**：`ask`（默认放行语义不变）/ `never`（ask 源自动拒绝）/ **`always`（新增：每次工具调用执行前询问）**。`always` 下每次询问只提供一次性选项 `allow_once` / `reject_once`，**不提供 `allow_always`**——与 dspm 验收建议的一次性语义一致。未知值 fail-loud（invalid params 并给出可接受词表）。
- **`permission_preset`**：部署预设目录单选，出厂 `read-only` / `workspace-write` / `danger-full-access`，一次调用打包 {沙箱模式, 审批策略}。旋钮不再匹配任何捆绑时派生当前值读作 `custom`。
- `always` 的持久化为新会话事件类型 `approval/policy-always`：**早于本交付的构建会拒绝打开含该事件的会话日志**（required-on-read，报未知类型并指名）。dspm 每用户独立 home PVC 的形态不受影响；但混合版本共享会话存储的场景须先升级全部读取方再启用 `always`。部署的 `approval` 静态配置仍只接受 `ask` / `never`。
- **验收直达路径**：`set_config_option` 设 `always` 后，任意工具调用（含文件写）触发一次 `session/request_permission`；`allow_once` 放行、`reject_once` 拒绝且会话继续、`stopReason` 正常结算。此链路已在真实 WebSocket 冒烟（SMOKE-acp-network-03）逐项断言，dspm 集成验收可直接复用该用例形态。
- **边界（与评估一致）**：`ask-writes` / `ask-network` 类别级 ask **本期不含**——仓库无工具类别分类法、sandbox 词表无网络维度，属独立设计立项；dspm 如有此诉求请在 §6 清单中回复立项意愿。fail-closed 语义（无应答者 → 该次调用拒绝、会话不中断）与 dspm relay 设计一致，未改动。

## 3. REQ-D2 交付详情（技能清单枚举）

新 ACP bridge 扩展方法（ACP 1.4.0 无技能标准面，扩展属性已在 acp README 与升级指南明示）：

- 请求 `{ sessionId }`；响应 `{ skills: [{ name, description, modelInvocable, userInvocable }] }`，按 `name` 字典序，每项恰含四个字段。`description` 为完整路由描述，不截断；不暴露 `path` / `whenToUse` / `source` / `provider`。
- **无调用面过滤**：`disable-model-invocation`（手势专属）与 `user-invocable: false`（模型专属）技能均在列，双旗标即注册表解析值——dspm UI 按旗标区分入口的需求原样满足，且服务端不承担任何策略（与 dsh 自有 UI 通道的 userInvocable 过滤是不同边界）。
- 解析链：会话预设挂载的作用域注册表优先，回退全局注册表；按会话 cwd 列出合并清单（六根目录、优先级、同名覆盖、frontmatter 校验全部复用宿端实现，dspm 不再需要自扫目录兜底）。dspm 真机验证过的 `$DSH_HOME/.dsh/skills` 手势触发链路不变，本方法只是补齐「枚举」这最后一环。
- 只读零持久化：不落会话事件、不进模型 transcript；**无变更推送**（`skills/change` 推送为后续可选增量，镜像 config_option_update 既有模式），目录变化由客户端重拉观察。技能体不经 ACP 加载，调用仍走模型 `skill` 工具与手势路径。
- 错误分支：未知会话 id → invalid params（-32602）；组合未挂载技能注册表（如自定义 profile 剥离插件）→ internal error 并说明缺口，不返回空列表、不静默降级。空目录（已挂载但无技能）合法返回 `[]`，**不要把空数组当作「不支持技能」**。
- 验收：SMOKE-acp-network-04 为新增第四条真实冒烟通道（种子目录 + 旗标逐项核对 + 未知会话 + prompt 往返后重列一致）；keyless 快照 `snapshots/acp/skills-list` 固定方法面与字段映射。dspm 可用三技能 fixture（两种调用面独占 + 双面）复刻该验收。

## 4. P1 / P2 分项答复

### 4.1 REQ-D5 计划模式 —— 接受，第二期

形态：注册标准方法 `session/set_mode`；`session/new` / `session/resume` 响应补 `modes`（plan / normal 二值）；`plan/mode` 变更经 `session/update` 发 `CurrentModeUpdate`。plan-review（Approve / Keep planning）复用现有 `session/request_permission` 通道（allow_once / reject_once 映射）——不依赖 REQ-D6，且顺带修复今日 ACP 下 `exit_plan_mode` review 因无应答者而工具报错的缺陷。**语义明示（请 dspm 按此设计 UI）**：回合中切换为 `queued`（下一个 accepted pre-step 生效），响应体不承诺立即生效，以 `CurrentModeUpdate` 时序为准。强制只读不由 plan mode 承担（其自身不读 sandbox/审批状态）；如需强制保障，将以 mode→preset 联动配置承载（与 `permission_preset` 同形态）。

### 4.2 REQ-D4 压缩 —— 接受，第二期；**待 dspm 确认一项**

形态：bridge 扩展方法 `session/compact`，复制 `/compact` 的全部包装语义（busy/cancelled/changed/summary/commit/persistence 六失败码经 JSON-RPC error data 携带；caller-abort → cancelled）。**需 dspm 答复**：完成通知接受 ACP 标准面 UNSTABLE 的 `compaction_update`（status: in_progress/completed/failed/cancelled）+ capability 广告（gated on `ClientSessionCapabilities::compaction`）吗？接受则走标准面；不接受则回退纯同步响应或 dsh 扩展通知，二选一请在 §6 答复。另两点预期管理：六失败码是闭联类型属性而非结果联合，到 ACP 错误语义的映射在第二期提案中定；自动压缩（压力阈值触发）今日为纯 log-only，无面向客户端的完成通知——dspm「摘要续接」兜底在第二期交付前继续有效。

### 4.3 REQ-D3 多 provider —— 第三期优化项；零代码路径今天可用

核验结论：单 provider 限制仅在 acp-network 的 Config 层；llm 注册表天然多 provider，会话级跨 provider 切换端到端可用（选择经 `EpochHeader.config` 持久、resume 恢复）——`set_config_option` 的 model 值本就带供应商维度（dspm §1.3 判断正确）。

**dspm 立即可用的零代码路径**：出货 base bundle 已挂载休眠的 `llm-pi-ai` 多供应商孪生——`llm-pi-ai:` settings 节的 `providers` dict 有条目即注册活路由、清空即摘除（web Models 页即此机制；k8s PVC 可经 home 首启 `settings.yaml` 一次性导入预置）。形态示意（以部署时生成的配置目录文档为准）：

```yaml
llm-pi-ai:
  providers:
    deepseek-official:
      apiKeyEnv: DSPM_DEEPSEEK_API_KEY   # credential-ref：每请求经凭据存储解析，键不入配置
      baseURL: https://api.deepseek.com
    other-vendor:
      apiKeyEnv: DSPM_OTHER_API_KEY
      api: openai-completions            # 路由若不在出厂目录需显式协议
      models: [{ id: vendor-model, name: Vendor Model, contextWindow: 131072 }]
```

配合 profile patch 中 acp-network 行的 `provider` / `model` 指定默认对即可替代「每实例单 provider + 切换重排」供给链。dsh 侧第三期优化形态为 acp-network Config 增 `providers` 数组 + 指定默认路由；**一个待答复项**：llm-pi-ai 的 dict 先例明确拒绝数组形态——若 dspm 接受 dict（settings 节）作为长期形态，dsh 侧可少一类形态分叉，请在 §6 表态。

### 4.4 REQ-D6 userQuestions —— 接受，按需触发

通道成熟（问题/选项/多选/超时/取消语义齐备，四个消费者先例）；dspm 判断正确：SSE 审批卡片 + REST 应答应映射 userQuestions 而非 `request_permission`（后者一问一选项、无超时/自由文本）。ACP 回调为 bridge 扩展方法。**两点预期管理（请回传更新原文）**：goal complete 人类授权是宿端会话事件见证（开放回合内存在 `source.kind='user'` 的消息），不经过 userQuestions——问题回调解锁不了 goal complete；超时后 `continued` 态的迟到应答落库为 `user-question-reply` 消息，同样不满足见证条件。触发时机由 dspm 提出（权限卡片之外的第一个真实消费者出现即立项）。

### 4.5 REQ-D8 导出 —— 延后（P2 末位）

双路径均增量可行：(i) ACP 方法流式返回会话日志 ZIP 条目；(ii) `/api/session.export` 增 acp-network HMAC token 鉴权分支（复用现有 signHmacToken / timing-safe / TTL / 防重放机制，属新增分支非开关）。dspm 镜像导出已覆盖主诉求，维持延后；请 dspm 在 §6 答复两条路径的偏好，排期时直接按偏好出提案。

## 5. 婉拒项

### 5.1 REQ-D7 文件通道 —— 婉拒；dspm MCP 方案即认可形态

dsh 仓库不变量是「provider 请求永不携带文件字节」（字节经 agent 的文件工具按 host 路径按需读取）；dspm 的 `conversation_attachment_read(attachment_id)` MCP 方案与该不变量架构同构、成本低且不引入新协议面。ACP prompt 面维持 text / resource_link（文本化标记）/ image（capability 门控），不扩展 file 引用与配套上传通道。双方各自保持现状即为最终形态，无需后续排期。

### 5.2 REQ-D9 goal —— 婉拒（附理由）；dspm 自建即认可形态

两项结构性障碍：(i) GoalService 各方法取活进程内 `Agent` 句柄，无 session-id 间接——ACP 转发需新造 id-based seam，属接口层重设计而非薄入口；(ii) complete 授权是宿端见证模型（direct-human / exact-goal-round），**任何客户端调用都无法授予**——外部触发的 complete 违反该安全模型。且授权不经 userQuestions（§4.4），REQ-D6 落地也不解锁此项。结论：goal 属 dsh 私有体验，dsh 侧将文档化该立场；dspm 维持「存储 + 每回合 prompt 注入」自建形态即认可形态（无 round 推进与 complete 授权语义的差异由 dspm UI 如实声明，与现状一致）。

## 6. 需要 dspm 答复 / 行动的事项清单

1. **核验更正回传**：将 §7 六项更正合入需求文档原文（尤其 goal 授权通道错位与 `ask-network` 缺口两项影响后续设计）。
2. **REQ-D4 通知形态**：接受 UNSTABLE `compaction_update` + capability 广告，还是纯同步响应 / dsh 扩展通知（二选一）。
3. **REQ-D3 长期形态**：接受 `llm-pi-ai` providers dict（settings 节）作为多 provider 长期形态，还是仍需 acp-network `providers` 数组优化项。
4. **REQ-D6 触发时机**：权限卡片之外首个真实消费者出现时提出立项。
5. **REQ-D8 路径偏好**：ACP 方法流式 vs HMAC token 鉴权分支。
6. **类别级 ask 立项意愿**：`ask-writes` / `ask-network` 需工具分类法 + sandbox 网络维度，独立立项评估——dspm 是否提出。
7. **消费版本**：D1 / D2 自变更线 `da8e79a698` / `f148f8aeca`（0.2.1-alpha.1 线）起可用；dspm 下轮镜像构建请以含两提交的发布物为准，升级指南两篇随镜像同步。
8. 升级指南提前同步机制维持（v0.2.1-alpha.1 先例），dspm 侧无需动作，仅确认收货人不变。

## 7. 对需求文档的核验更正（六项，请回传更新原文）

1. **ask 触发源精度（§1.2 / REQ-D1）**：`kind:'ask'` 产源为两处——PreToolUse hook（`packages/hooks/hooks-claude-code/src/index.ts:248`）与 auto-review（`packages/experimental/auto-review/src/index.ts:660`）；sandbox 升权不产 ask，而是经 `approveEscalation` 直通审批 seam（`packages/sandbox/sandbox/src/escalation.ts:188`）。操作结论不变：交付前 `session/request_permission` 的现实触发源仅 sandbox 升权——REQ-D1 动因成立；交付后以 `always` 档为直达触发路径。
2. **`ask-network` 无支撑面（REQ-D1）**：sandbox 词表仅文件访问维度，无网络维度；全仓无工具类别分类法。类别级 ask 是独立设计项，v1 不含（§6 第 6 条）。
3. **REQ-D2 字段大半现成（历史背景）**：`modelInvocable` 本就在 wire 类型（`packages/api/session-controller/src/types.ts:245-256`）；评估报告指出的「userInvocable 过滤 vs 双旗标」设计决策，交付结论为**无过滤 + 双旗标**——dspm 原请求字段原样满足。
4. **goal 授权通道错位（REQ-D6）**：goal complete 授权不经 userQuestions，是会话事件见证（`packages/goal/tool-goal/src/authority.ts:80-93,111-118`）；ACP 问题回调不解锁 goal complete，`continued` 态迟到应答同样不满足见证条件。
5. **REQ-D4 形态细节**：六失败码是 `ManualCompactionError.code` 闭联类型属性（`packages/compaction/compaction/src/index.ts:35-41`），非结果联合；自动压缩今日纯 log-only（`packages/compaction/compaction-basic/src/index.ts:150-156,172,213-225`），无面向用户的完成通知。
6. **REQ-D3 线引用修正**：acp-network 单值对在 `packages/acp/acp-network/src/index.ts:55-56`（所引 40-51 为接口块，单值继承自 `AcpBridgeOptions`）；provider 分组在 `packages/acp/acp/src/model-control.ts:160-175`，value 编码在 `:223-226`。

其余声明（§1.1 手势链路、§1.3 协议面、§1.4 capabilities、REQ-D7 字节不进请求、REQ-D8 导出与 browser-auth、REQ-D9 goals RPC、feedback log-only）经四路并行核验均与代码一致，无需更正。

## 8. 立场更新（2026-11-08 增补）

D4 交付归档并经 dsh 侧逐项确认后，§6 清单的立场更新如下。§6 原文保留作交付记录，本节为当前有效立场，下次沟通时随更正清单一并重发：

1. **核验更正回传（原第 1 条）**：dsh 将在下次沟通**主动重发** §7 更正清单，不再被动等待回传。
2. **REQ-D4 通知形态（原第 2 条）**：D4 **已交付并归档**——`session/compact` 扩展方法 + UNSTABLE `compaction_update`（in_progress/completed/failed）+ `session.compaction` capability 广告，变更线 `609ef15b5a` → `80df47eb8c` → `f19e2555e5` → `d6d9167d29`，部署证据 `logos/resources/verify/s52-deployment-report.md`。dsh 将主动知会 dspm；正式接受/异议仍待表态，若不接受回退形态按 §4.2 二选一另行排期。
3. **REQ-D3 长期形态（原第 3 条）**：**决策变更——不再等待表态，第二期直接排入 acp-network `providers` 数组方案**（dict-vs-数组之辩降级为文档说明项）；dspm 对 dict 的表态仍欢迎，影响文档而非排期。
4. **REQ-D6 触发时机（原第 4 条）**：**决策变更——第二期提前排期** goal 授权经 ACP 的设计，不等首个真实消费者出现。
5. **REQ-D8 导出路径（原第 5 条）**：**决策变更——第二期直接排入 ACP 方法流式导出（路径 i：新增扩展方法沿 ACP 连接流式返回日志 ZIP 条目，纯协议面扩展，stdio 本地形态同样可用）**；HMAC token 鉴权分支（路径 ii）留作后手，dspm 若明确服务端直拉消费形态可切换。
6. **类别级 ask（原第 6 条）**：dsh **先做内部调研**（工具分类法 + sandbox 网络维度），立项评估材料就绪后随下次沟通附上；dspm 立项意愿仍欢迎。
7. **消费版本（原第 7 条）**：基线追加 D4——D1/D2 自 `da8e79a698` / `f148f8aeca` 起可用，**D4 自 `80df47eb8c` / `f19e2555e5` 起可用**（同 0.2.1-alpha.1 线）；下轮镜像构建请以含四提交的发布物为准，升级指南三篇（permission-policy、skills-list、compaction）随镜像同步。
8. **升级指南提前同步机制（原第 8 条）**：维持不变，等 dspm 确认收货人。

第二期范围（dsh 侧确认稿，与 dspm 沟通后立项）：REQ-D3 acp-network `providers` 数组方案、REQ-D6 goal 授权经 ACP、REQ-D8 ACP 流式导出、类别级 ask 内部调研。
