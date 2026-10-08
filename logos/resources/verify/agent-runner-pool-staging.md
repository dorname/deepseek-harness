# 执行池 staging 部署记录（agent-runner-pool [deploy]）

- 日期：2026-10-08
- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。
- 节点：runner A / runner B（`agent-dispatch` 编排循环）+ 发布 runner + 两个中继副本，串行操作。
- 租约库 `staging_leases`：runner A 持租约后被 kill（停止续约），队列重投后 runner B 在租约窗口内接管并接续该会话（SMOKE-core-14）。
- 中继库 `staging_relay`：runner 发布 4 条事件/帧，两副本各自从游标追赶收到相同 (seq, payload) 流；中途订阅从 seq 2 精确回放 3..4（SMOKE-core-15）。
- 回滚：runner/副本进程退出；`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。
- CPU 峰值：15.2%（阈值 80%），耗时 1223ms。
