# delta — core-01-requirements.md（变更 stateless-cluster-deployment）

## MODIFIED — S42: runner 排空与滚动升级

### S42: runner 排空与滚动升级
- **触发条件**：升级发布，runner 收到排空指令（部署编排停止其接新工作）
- **用户价值**：升级不需要停机窗口——按会话粒度排空让进行中的会话在旧 runner 上自然收尾，新工作流向其余 runner（← P03）
- **优先级**：P1
- **主路径**：排空指令 → runner 停止取派发队列、停止租约心跳 → in-flight drive 到 turn 边界自然结束 → 租约过期被其他 runner 接管 → 进程退出；升级后的新 runner 从共享层接续会话。

#### 验收条件
##### 正常：排空后新工作流向其余 runner
- **GIVEN** 双 runner 在线，runner A 收到排空指令
- **WHEN** 新会话入队
- **THEN** A 不再取队列；B 取走并执行
##### 异常：排空中 in-flight 会话到 turn 边界收尾
- **GIVEN** A 正驱动一个会话的 turn 时收到排空
- **WHEN** 该 turn 结束（whenIdle）
- **THEN** A 停止心跳、释放租约后退出；该会话可被其他 runner 立即接续，日志完整可打开
##### 正常：升级后旧会话可打开
- **GIVEN** 排空与接管完成，新版本 runner 在线
- **WHEN** 打开升级前创建的会话
- **THEN** 会话日志完整可读（会话代际 + 相邻迁移兜底），无升级专属迁移步骤
##### 正常：编排器无关优雅退出
- **GIVEN** runner 以配置化循环运行（进程加载即起循环）
- **WHEN** 任意编排器发送 SIGTERM（K8s/docker stop/systemd stop 同信号）
- **THEN** 进程停止接新工作、等待 in-flight drive 到 turn 边界、排空退出（exit 0）；剩余 runner 接续该会话

## MODIFIED — 5.3 "不做"清单

### 5.3 "不做"清单


- 不做厂商托管多租户 SaaS 后端（多用户能力以**自托管 fleet** 形态交付：认证网关 + 每用户独立进程与数据目录，见 S31–S33；由厂商运营的托管 SaaS 仍不在产品范围）。
- 不做模型训练/微调；harness 只消费模型 API。
- 不内置 IDE；编辑器集成走 ACP/SDK/hooks 桥，不重复造 IDE。
- 不承诺 API 稳定（pre-stable，升级即破坏需走 upgrade guide 记录）。
- 不做跨用户集中检索与管理面：共享持久层（S34–S36）只以每用户命名空间承载数据，不提供任何跨命名空间的查询、浏览或管理入口；Postgres FTS 集中化与 KMS 集中凭证按落地方案（multi-user-and-cluster-plan §6-3/§6-5）延后到后续里程碑。
- 不做执行池的 Redis pub/sub 中继与 PTY 进程远程化：M3 中继用 PostgreSQL `LISTEN/NOTIFY` + 中继日志表（零新增基础设施依赖，Redis 为后续 Provider）；终端/jobs 只落「属主信息面」（`ownerOf` 路由决策），PTY 远程化（ssh 式远程世界）与 Web/API 副本无状态化编排、K8s Operator（multi-user-and-cluster-plan §7-4/§9）延后到后续里程碑。
- 不做 schedule 分布式版与单机版的混用、webhook 消费的独立编排器：共享 schedule 为并列 Provider（未配置共享库时单机 `ScheduleService` 行为不变），webhook 消费复用执行池的队列/租约原语；K8s Operator 编排（multi-user-and-cluster-plan §9）仍不在范围。
- 不做编排器专属集成（K8s Operator/CRD、cloud metadata 依赖）与多租户命名空间迁移：集群编排语义锚定共享 Postgres（租约/队列/中继/恰一），编排器只负责「起进程/发 SIGTERM」；单租户形态下进程级默认命名空间即正确语义，多租户需求出现时另行立项。
