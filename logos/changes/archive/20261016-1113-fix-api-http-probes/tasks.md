# 实现任务

## [code] API HTTP 健康检查

- [x] 增加有截止时间的 loopback HTTP 健康检查及参数校验
- [x] 为 API 配置 Compose health gate 与 Kubernetes startup、readiness、liveness HTTP 探针
- [x] 补齐异常状态、超时、恢复及并发端口隔离回归测试
- [x] 更新中英部署文档、配对记录及验证报告
- [x] 通过相关测试、Helm 清单校验、doc-sync 和 lint

## [deploy] 本地 staging 验证

- [x] 验证 HTTP 探针部署与双 API 副本就绪
- [x] 验证故障副本摘除与 liveness 自动恢复

## 交付

按用户指示，将探针修复及验证记录作为独立提交；不自动推送。
