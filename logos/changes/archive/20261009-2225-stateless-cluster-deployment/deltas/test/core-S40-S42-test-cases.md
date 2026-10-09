# delta — core-S40-S42-test-cases.md（变更 stateless-cluster-deployment）

## MODIFIED — S42: runner 排空与滚动升级

## S42: runner 排空与滚动升级

### 1.1 单元/契约测试用例（来源：agent-dispatch spec + HMR 形态 spec）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S42-01 | 排空后不再取队列 | 编排 spec | 双循环 + 排空 A | 新会话入队 | 仅 B 取走执行 |
| UT-S42-02 | in-flight 到 turn 边界收尾 | 编排 spec | A 正 drive 中排空 | 等待 drain 返回 | drain 在 drive 完成后返回；租约释放 |
| UT-S42-03 | 排空后会话可接续 | 编排 spec | A 排空后租约过期 | B 接管 resume | 未消费输入被 B 接续 |
| UT-S42-04 | HMR 只读形态禁用 | HMR 形态 spec | `DSH_CONFIG_READONLY=1` | 装配 HMR 插件 | fail-closed 拒绝启用 |
| UT-S42-05 | HMR 常规形态不受影响 | HMR 形态 spec | 未注入只读变量 | 装配 HMR 插件 | 行为与现状一致 |
| UT-S42-06 | runner 循环生命周期：配置在场加载即启动、dispose 排空 | 编排 spec | `nodeId`/`loop`/`consumer` 配置加载 | fiber dispose | 循环自动启动；dispose 等待 in-flight 到边界后关池 |
| UT-S42-07 | SIGTERM 排空退出（exit 0） | 编排 spec | 子进程运行循环 | 向子进程发 SIGTERM | 停止接新工作；in-flight 到边界；exit 0 |

### 2.1 场景测试用例

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S42-01 | 排空后新工作流向其余 runner（S42-AC-01） | 主路径 | 双 runner 在线 | A drain → 新会话入队 | B 取走执行，A 不取 |
| ST-S42-02 | 排空接管续跑（S42-AC-02） | 异常流 | A drive 中排空 | 等 turn 边界 + 租约过期 | B 接管接续，会话日志完整 |

## MODIFIED — 覆盖度校验

## 覆盖度校验

- [x] S40 P0 验收条件：并发恰一 + 崩溃不丢 + 仅补最近一次 + 重启恢复均有用例；租约约束单独成用例
- [x] S41 P0 验收条件：恰一建会话 + 崩溃不丢 + 水平复制幂等均有用例；签名拒绝单独成用例
- [x] S42 P1 验收条件：排空流向 + 边界收尾 + 旧会话可打开均有用例；HMR 形态正反单独成用例；编排器无关节（循环生命周期/SIGTERM 排空）成用例
- [x] 资源约束：本文件资源约束节 + 部署检查清单第 13/14/15 条 + SMOKE-core-16/17/18 一致

## MODIFIED — 验收条件追溯

## 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S40-AC-01 | 正常：并发取用恰一交付 | UT-S40-01, ST-S40-01 |
| S40-AC-02 | 异常：取用后崩溃不丢 | UT-S40-02, ST-S40-02 |
| S40-AC-03 | 正常：recurring 仅补最近一次错过 | UT-S40-03 |
| S40-AC-04 | 正常：重启后恢复 | UT-S40-04 |
| S41-AC-01 | 正常：恰一建会话 | UT-S41-01, ST-S41-01 |
| S41-AC-02 | 异常：消费崩溃不丢 | UT-S41-02 |
| S41-AC-03 | 正常：入口水平复制幂等 | UT-S41-03, ST-S41-02 |
| S42-AC-01 | 正常：排空后新工作流向其余 runner | UT-S42-01, ST-S42-01 |
| S42-AC-02 | 异常：in-flight 会话到边界收尾 | UT-S42-02, ST-S42-02 |
| S42-AC-03 | 正常：升级后旧会话可打开 | UT-S42-03 |
| S42-AC-04 | 正常：编排器无关优雅退出 | UT-S42-06, UT-S42-07, SMOKE-core-19 |
