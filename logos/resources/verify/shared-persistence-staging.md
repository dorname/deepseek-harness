# 共享持久层 staging 部署记录（shared-persistence-backends [deploy]）

- 日期：2026-10-08
- 共享 Postgres：`@embedded-postgres/linux-x64` 免 root 二进制，临时数据目录，运行后连同目录一并销毁。
- 节点：两个独立进程角色（writer/reader）按串行执行，分别注入 fleet subject `acc-alice` / `acc-bob`。
- 会话库 `staging_sessions`：节点 A 创建并提交会话 `staging-shared-session`（seq 0..5，一回合完整事件）；节点 B 以同 subject 打开读到相同事件与头（SMOKE-core-12）。
- 域库 `staging_domain`：`staging` 域 `probe` 表 `staging-key`，A/B 两 subject 双向只见自己命名空间的值（SMOKE-core-13）。
- 回滚：节点进程退出；`cluster.stop()` 停止共享库并删除数据目录，staging 库不保留。
- CPU 峰值：14.9%（阈值 80%），耗时 2420ms。
