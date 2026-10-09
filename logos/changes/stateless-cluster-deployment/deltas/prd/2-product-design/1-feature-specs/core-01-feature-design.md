# delta — core-01-feature-design.md（变更 stateless-cluster-deployment）

## MODIFIED — 7. Host 本地服务分布式化交互规格（S40–S42） > S42: runner 排空与滚动升级 — 交互规格（运维/开发面）

### S42: runner 排空与滚动升级 — 交互规格（运维/开发面）

**入口**：部署编排向 runner 发出排空指令（进程信号或管理调用）

**行为规范**：
1. **停接新工作**：排空即停止取派发队列——新会话流向其余 runner
2. **停租约心跳**：不再续约，持有的租约在有效期内自然过期被其他 runner 接管
3. **turn 边界收尾**：in-flight drive 等待当前 turn 结束（`whenIdle`）后返回，不中断进行中的会话
4. **接管续跑**：升级后的新 runner 从共享层接续被排空会话的未消费输入（复用 S38 接管语义）；会话日志经代际 + 相邻迁移保持可打开
5. **profile 只读形态**：集群共享配置以 `DSH_CONFIG_READONLY=1` 声明，HMR 在该形态下 fail-closed 禁用；固定层镜像 + 用户层共享只读挂载是部署打包要求，不新增运行时缝

#### 验收条件（交互级）

##### 正常：排空后新工作流向其余 runner
- **GIVEN** 双 runner，A 排空
- **THEN** 新入队会话由 B 取走
##### 异常：in-flight 会话到边界收尾
- **GIVEN** A 正驱动一个 turn 时排空
- **THEN** turn 结束后 A 释放退出，会话可立即被接续，日志完整
##### 正常：升级后旧会话可打开
- **GIVEN** 排空与接管完成
- **THEN** 升级前创建的会话在新 runner 上完整可读
6. **配置化循环生命周期**：runner 形态 = `nodeId` 配置在场即加载自动起派发循环（AbortController 挂 fiber）；fiber dispose（SIGTERM 已由 launcher 接线为整树 unwind）→ `drain()` 等待 in-flight drive 到 turn 边界 → 关池。schedule-dispatch（`loop: true`）与 webhook-ingress（`consumer: true`）同构
7. **编排器无关**：所有集群语义锚定共享 Postgres；编排器只负责「起进程 / 发 SIGTERM」——K8s、docker compose、systemd、裸机多进程为同等支持的编排矩阵，不做任何编排器专属集成

#### 验收条件（交互级·编排器无关节）

##### 正常：配置化循环加载即启动
- **GIVEN** runner profile 以 `nodeId`/`loop`/`consumer` 配置加载
- **THEN** 派发/到期/消费循环自动启动，无需外部调用
##### 正常：SIGTERM 排空退出
- **GIVEN** 循环运行中
- **WHEN** 进程收到 SIGTERM
- **THEN** 停止接新工作、等待 in-flight 到边界、排空退出（exit 0）
