# delta — core-smoke-test-cases.md（变更 dsh-provider-model-discovery）

## ADDED — 四、DeepSeek 动态模型目录冒烟（S48）

| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-25 | 真实动态目录与精确模型 ID 推理 | 部署方案 §十 / S48-AC-06 | staging | 已部署目标 commit；真实 baseURL 与既有 Secret 可用；不得把密钥写入报告 | 读取 DeepSeek 动态目录并记录实际 ID → 选择目录中的实际模型（回归目标 `deepseek-v4-flash` 在目录时优先）经 ACP 完成 prompt → 再选择目录中另一个实际模型验证 → 保留 SMOKE-core-06 与 ACP 网络回归 | 目录只含真实上游项；第一模型请求 ID 与目录一致且收到正常助手响应；第二模型如实记录成功或权限失败；`deepseek-v4-flash` 缺席时如实记录缺席并改选实际模型；无 Secret、目录为空或真实调用未执行时不得判 AC-6 PASS，不得以 Mock 替代 |

覆盖度校验：

- [x] 配置与密钥：SMOKE-core-04/05/25（25 额外验证动态发现复用既有 Secret 且报告不含密钥）。
- [x] 关键链路：SMOKE-core-06/07/25（25 验证真实目录到精确模型请求的闭环）。
- [x] S48-AC-06：仅接受真实供应商目录与真实推理结果；第二模型权限失败单独记录，不掩盖第一模型结果，也不伪报第二模型成功。
