# delta — core-01-requirements.md（变更 dsh-acp-session-export）

## MODIFIED — 三、场景总览（表格追加一行）

在场景总览表 S54 行后追加：

```markdown
| S55 | 外部客户端经 ACP 流式拉取会话导出 | 外部 ACP 客户端对 owned 会话发起导出三方法，沿连接分块拉取与 HTTP 路由同工件的 ZIP | P01/P03/P08 | P1 |
```

## ADDED — 四、核心场景详述：S55

在 §四 S54 小节之后、"## 五、约束与边界" 之前插入：

```markdown
### S55: 外部客户端经 ACP 流式拉取会话导出

- **触发条件**：外部 ACP 客户端（dspm 镜像、编辑器插件、自动化脚本）需要会话的完整归档（根日志 JSONL + subagent 日志 + 附件），而宿主面只有 HTTP `/api/session.export`（browser-auth，私有协议可达）——客户端经 ACP 连接对它创建/恢复的会话调用导出三方法。
- **用户价值**：会话导出不再要求浏览器鉴权面；ACP 集成方沿既有连接拉取与 web 下载完全同工件的 ZIP 归档（dspm 镜像可退役为标准 unzip 消费），stdio 本地形态同样可用（← P01/P03/P08）。
- **优先级**：P1
- **主路径**：`session/export_begin { sessionId, includeDescendants? }` → 桥接做 owned-session 校验 → flush 活跃日志、预读根日志（缺失在任何字节产生前域错误应答）→ 返回 `{ exportId, filename }` 并持有 per-connection 拉式游标 → 客户端循环 `session/export_read { exportId }` 取 `{ data, eof }`（每次至多 `exportChunkBytes` 原始字节的 canonical base64，eof 即终态交付）→ 客户端写文件并标准解包，得到与 HTTP 下载同布局的归档（`session.v4.jsonl`、`subagents/`、`media/`、`files/`）；`session/export_cancel { exportId }` 随时中止（生产者 terminate，无截断档案）。
- **边界**：授权模型是连接级 owned-session（桥接会话表即授权边界，与既有 ACP 方法一致），跨会话读取不可达；导出交付完整原始会话日志（含内部事件、工具输出、subagent 日志与附件字节），严格多于投影 wire 视图——与浏览器用户经 `/api/session.export` 所得一致（stdio 本地 / acp-network HMAC token 同级信任），规格显式声明、无脱敏选项；零新增通知类型、零新增会话事件类型（导出只读日志，flush 落盘的是已记录事件）、零新增 capability 要求（旧客户端 methodNotFound 天然向后兼容）；新增两个 dsh-acp Config 字段（`exportChunkBytes`、`exportCompressionLevel`）均为加载期校验的部署旋钮；`SessionEventMap` 与 Session format 4 不变，模型可见 ⟺ 已记录不变量保持（导出不产生任何模型可见输入）。
```

## ADDED — 四、S55 验收条件

接在 S55 边界段之后、"## 五、约束与边界" 之前插入：

```markdown
#### 验收条件
##### S55-AC-01 正常：ACP 连接内导出往返
- **GIVEN** ACP 连接内存在已驱动若干事件的 owned 会话
- **WHEN** 客户端 `export_begin` 后循环 `export_read` 至 eof，将字节写文件并解包
- **THEN** 归档与 HTTP 路由同布局同工件（`session.v4.jsonl` 首条目，含驱动期事件）；每次 read 载荷不超过配置分块的 base64 膨胀上界；eof 为最后一次交付，随后游标即失效
##### S55-AC-02 异常：取消与未知游标
- **GIVEN** 一个在途导出游标；以及一个不存在/已终结的游标 id
- **WHEN** 客户端 `export_cancel`（在途游标）后立即 read；或对未知游标 read/cancel
- **THEN** cancel 空结果返回、生产者中止、后续 read 得 `unknown_cursor` invalid params；未知游标的 read/cancel 一律 `unknown_cursor` invalid params，无残留状态
##### S55-AC-03 边界：根缺失与前置应答
- **GIVEN** owned 会话日志缺失（如持久层被移除）；或会话查询/附件服务缺席的组合
- **WHEN** `export_begin`
- **THEN** 根缺失得 `not_found` 域错误（无任何字节交付、无游标建立）；服务缺席 internal error fail-loud；两者均在流开始前应答
##### S55-AC-04 回归：既有导出与 ACP 方法面不变
- **GIVEN** S26 web 导出（HTTP 路由）、S49..S54 既有 ACP 方法面与 S03 主链路
- **WHEN** 执行既有回归与 SMOKE-acp-network-01..08
- **THEN** HTTP 导出行为与生产者套件不变；既有方法注册与通知派发不受第三组扩展方法影响；Session format 与事件词汇不变
```
