# delta — core-system-map.md（变更 dsh-acp-permission-policy）

## ADDED — 14. ACP 会话审批策略入口（S49）

### 14.1 组件与职责

| 组件 | 位置 | 职责 |
|------|------|------|
| ACP bridge 配置入口 | `packages/acp/acp/src/bridge.ts` `setSessionConfigOption` | 先于模型选项委托识别 `permission_policy` / `permission_preset`，校验词表与预设目录，fail-loud 拒绝未知值 |
| 审批策略服务 | `packages/interaction/user-approval/src/index.ts` | 既有 `setPolicy(agent, policy)` 按 tier 落 `approval/policy`（ask/never）或 `approval/policy-always`（always）事件并注入模型可见切换通知；`effectivePolicy` 按 seq 跨两类事件折叠 override → config 默认 → `ask` |
| always 询问源 | pre-execute 审批监听 | 策略为 `always` 时对每次工具调用产生询问并路由进既有 serviceAsk 管线；`ask`/`never` 维持既有分发语义 |
| 权限预设服务 | `packages/interaction/permission-presets/src/index.ts` | 既有 `catalog()` 枚举预设目录、`set()` 应用 `{sandbox, approval}` 打包；ACP 只暴露入口，不重定义各档值 |
| 权限回环 | `packages/acp/acp/src/bridge.ts` ApprovalService answerer | 既有 `session/request_permission` 投递与 allow-once/reject-once 应答结算，一次性语义保持 |

### 14.2 配置数据流

```text
Client
  │ session/set_config_option { permission_policy | permission_preset }
  ▼
AcpBridge.setSessionConfigOption ── 校验词表/预设目录 ──▶ 未知值: JSON-RPC invalid params（状态不变）
  │ 合法值
  ▼
ApprovalService.setPolicy / permission-presets set()
  │ 落 approval/policy 或 approval/policy-always 事件 + 模型可见切换通知（既有持久化路径按档分流）
  ▼
configOptions 广告当前值（session/new、session/resume、设置回执）
  │
  ▼
后续工具调用按档分发：always→每次询问 / never→自动拒绝 / ask→放行既有触发源
```

策略状态经策略事件对持久化与恢复：ask/never 落既有 `approval/policy`（payload 冻结于 format-4 词表，扩宽即破坏性持久化变更），always 落新增普通事件类型 `approval/policy-always`（same-version 增长机制，`version: 0` 出生即带版本，沿 `subagent/catalog` 先例）；折叠按 seq 跨两类事件取最后者。旧构建读已知类型集不含新事件，按 required-on-read 语义拒绝打开含该事件的日志（fail-loud）；模型可见切换通知已由既有 setPolicy 注入，不新增模型可见输入。

### 14.3 故障与边界不变量

- 未知策略值或未知预设名一律 fail-loud（invalid params），不静默忽略、不回退默认；预设目录为空或审批/预设插件未组装时同样显式失败，不吞错。
- `always` 询问复用既有 fail-closed 应答语义：客户端未实现回调时该次调用被拒，会话不中断，不降级放行。
- 权限应答保持一次性（allow-once / reject-once）；不提供 `allow_always`，不在 bridge 推断持久授权。
- 类别级询问（ask-writes / ask-network）不在本变更：无工具类别分类法，sandbox 词表无网络维度；`/permission` 命令与 profile 会话种子行为不变。
