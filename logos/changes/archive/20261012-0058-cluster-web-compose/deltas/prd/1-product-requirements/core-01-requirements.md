# delta — core-01-requirements.md（变更 cluster-web-compose）

## MODIFIED — 三、场景总览（表追加 S43 行；整表守恒携带既有行）

在 S42 行之后追加：

| S43 | 同域 cluster-web Compose 一键启动 | 运维执行 compose up / supervise | P03/P08 | P0 |

## ADDED — 四、核心场景详述 · S43

### S43: 同域 cluster-web Compose 一键启动

- **触发条件**：运维在仓库根执行 `docker compose -f deploy/cluster-web/docker-compose.yml up`，或无 Docker 时运行 `deploy/cluster-web/supervise.mts`
- **用户价值**：浏览器只开一个 origin 即可使用 GUI；API 副本留在 loopback，edge 做同域反代（← P03/P08）
- **优先级**：P0
- **主路径**：supervise 按低副本默认拉起 api（及可选 runner）→ edge 对外监听 → 打印 PUBLIC_URL → SIGTERM 排空子树退出。

#### 验收条件
##### 正常：同域入口可达
- **GIVEN** API_REPLICAS=1、RUNNER_REPLICAS=0（smoke 默认）
- **WHEN** 经 edge 的 PUBLIC_URL 发起 HTTP 请求
- **THEN** 非 5xx；浏览器 Host 经 edge 原样转发
##### 正常：副本上限保护 CPU
- **GIVEN** 验收配置
- **WHEN** 设置 API_REPLICAS>2 或 RUNNER_REPLICAS>2
- **THEN** supervise 拒绝启动；冒烟串行且主机 CPU 峰值 ≤ 部署配置阈值
##### 正常：SIGTERM 排空
- **GIVEN** 进程树就绪
- **WHEN** 向 supervise 发 SIGTERM
- **THEN** 子进程退出；supervise 在宽限内结束
