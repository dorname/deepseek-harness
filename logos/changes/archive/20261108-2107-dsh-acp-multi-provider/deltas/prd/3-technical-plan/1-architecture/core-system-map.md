# delta — core-system-map.md（变更 dsh-acp-multi-provider）

## ADDED — §18、多供应商路由供给形态（S53）

在 §17（ACP 会话压缩入口）之后追加：

```markdown
## 18. 多供应商路由供给形态（S53）

| 组件 | 位置 | 职责 |
|---|---|---|
| llm-pi-ai 配置 schema | `packages/llm/llm-pi-ai/src/config.ts` | `providers` 节点接受 dict 与数组双形式（组合层）；数组归一化进 dict 管线；`provider` 字段守卫形态上下文感知（dict 值仍拒绝、数组项即路由键） |
| llm-pi-ai 解析与注册 | `packages/llm/llm-pi-ai/src/index.ts` | 不变：`resolveProfiles` → memoized 快照 → `registerAdapter` / `registerConfigurableProviders` / `registerModelDiscovery`；`assertServiceable` 在归一化后比较 |
| settings 层 | settings 文档 + web Models 页 | 不变：dict-only 供给、逐键合并、活重配 |
| llm 注册表 | `packages/llm/llm/src/index.ts` | 不变：多 provider 路由注册与列表面（`listProviders`） |
| acp-network / AcpBridge / model-control | `packages/acp/*` | 不改动：消费 llm 注册表面，configOptions 分组广告与 `set_config_option` 切换为既有行为 |

- 落点理由：供应商路由词汇（凭据引用、baseURL、协议、目录、compat、重试）归 provider 插件所有（能力缝）；llm-pi-ai 的路由供给与宿端闭包（凭据解析、attachments、fs 路径映射）绑定，消费者侧另立路由定义面需复刻整套宿端接线；数组形态与 profile 内 `provider` 字段此前被显式拒绝（`resolveProfiles`、`rejectRemovedFields`），重新开放落在词汇所有方并由 REQ-D3 消费者证据（dspm 部署 patch 清单形态）支撑。
- 零持久化面变更：无新增会话事件、无新增 wire 类型，`SessionEventMap` 与 Session format 不变；模型可见 ⟺ 已记录不变。
- 冲突 fail-loud 矩阵与 dict-vs-数组选型说明见 feature-design §13；升级指南随发布交付 dspm 组合示例。
```
