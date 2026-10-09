# Host 本地服务分布式化 staging 部署记录（distributed-host-services [deploy]）

- 日期：2026-10-09
- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。
- 节点：双 schedule-dispatch 循环、webhook-ingress 消费者、双 agent-dispatch runner，串行操作。
- schedule 库 `staging_schedule`：到期行双 runner 并发取用恰一交付（SMOKE-core-16）。
- webhook 库 `staging_webhook`：同去重键重复投递折叠为一行，消费恰一建会话（SMOKE-core-17）。
- 派发库 `staging_dispatch`：runner A 排空（停取队列、等 turn 边界、释放租约）后 runner B 取走重投会话（SMOKE-core-18）。
- profile 镜像形态：`DSH_CONFIG_READONLY=1` 下 HMR fail-closed 禁用（UT-S42-04 钉住）；固定层只读 + 用户层共享挂载为部署打包要求。
- 回滚：runner/副本进程退出；`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。
- CPU 峰值：3.3%（阈值 80%），耗时 1388ms。
