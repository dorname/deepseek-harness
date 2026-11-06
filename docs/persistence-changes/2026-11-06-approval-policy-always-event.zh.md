---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-06-approval-policy-always-event

[English](2026-11-06-approval-policy-always-event.md) | 中文

## 概述

新增普通会话事件类型 `approval/policy-always`,为新增的 `always` 审批策略档提供持久、可回放的切换记录。ask/never 切换继续走既有 `approval/policy` 事件,其 payload 冻结于已接受的 format-4 词表(`ask` | `never` 加可选委派 `source`);扩宽该联合类型是破坏性的同层 payload 变更。新事件出生即带版本(`version: 0`,沿既有 `subagent/catalog` 先例),未来 payload 增长以更高版本备选落地,无需格式升版。读取方按 seq 跨两类事件折叠最后一条策略事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-06-approval-policy-always-event
baseline: false
changes:
  - root: "event:approval/policy-always"
    previous: null
    after: "185b1eaaf2c894cd6293c92773f43eeff133b1cd3f875393d5970948f0b9baa0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增普通事件类型是 same-version 变更。早于本变更的构建不认识 `approval/policy-always`,会拒绝打开包含该事件的会话日志并报出未知类型——即 required-on-read 语义;仅用过 ask/never 的会话完全可读。委派 seed 路径只写 `never`,子会话继承仍走未变更的事件。Session 头、信封与表面结构均不变;SESSION_FORMAT_VERSION 维持 4。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/interaction/user-approval/tests packages/interaction/permission-presets/tests:78 项通过。pnpm exec vitest run packages/acp/acp/tests packages/core/tools/tests packages/subagent/subagent/tests packages/subagent/subagent-in-process-driver/tests:948 项通过,1 项既有环境失败(root 忽略 chmod 的 cwd 测试,与本变更无关)。pnpm run test:snapshot:182 项通过,1 项既有 Node load-hook 环境失败;permission-policy 快照已对真实 API 重录并 refresh。pnpm run typecheck 与 pnpm run lint 通过。OpenLogos reporter 账本再生:UT-S49-01..07、ST-S49-01/02、SMOKE-acp-network-01/02/03 全部通过。

<a id="dev-note"></a>
## 开发备注

无。
