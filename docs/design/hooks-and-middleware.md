# Session Hook & Middleware 设计

## 背景与问题

- 目前 Core 仅暴露 `onAssistantStep` 与一个简化的 `onObservation(tool, text, step)` 回调，无法覆盖 turn 开始、工具调度、最终响应等关键节点，UI/集成层想做审计或指标统计就只能解析 JSONL。
- 没有统一的“中间件”概念，同一个扩展场景必须堆多个回调，且无法在不同项目中复用；缺乏明确的调用顺序与失败保护。
- Hook 上下文信息不足，例如不知道 `sessionId`、`turnUsage`，也无法拿到完整 `history/steps`。

## 目标

1. 给出完整的 `onTurnStart/onAction/onObservation/onFinal` 事件流，包含必要上下文。
2. 在 Core 层定义可复用的 `AgentMiddleware`，一个中间件可同时实现多个 Hook。
3. 保持 API 简洁：默认无需写中间件，必要时传入 `deps.hooks` 或 `deps.middlewares` 即可。
4. 错误隔离：中间件异常不能中断 Session，只打印警告。
5. 所有扩展统一走 Hook/Middleware，彻底移除旧的 `deps.onObservation` 入口，避免多套回调并存。

## 方案概述

### Hook 类型

| Hook            | 触发时机                                           | 上下文字段                                                                                                           |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `onTurnStart`   | `runTurn` 接收到用户输入并写入 `turn_start` 事件后 | `sessionId`、`turn`、`input`、当前 `history` 快照                                                                    |
| `onAction`      | 解析出 `action` 并准备执行工具时                   | `sessionId`、`turn`、`step`、`action`（工具名+原始 input）、`history`                                                |
| `onObservation` | 工具执行完 observation 写回历史后                  | `sessionId`、`turn`、`step`、`tool`、`observation`、`history`                                                        |
| `onFinal`       | 任何路径下得出最终回答并写入 `final` 事件时        | `sessionId`、`turn`、`step?`、`finalText`、`status`、`errorMessage?`、`tokenUsage?`（当前步）与 `turnUsage`、`steps` |

> `history` 为浅拷贝快照（`{ role, content }[]`），`turnUsage` 也会复制数值，调用方视为只读。

### API 设计

- 新增类型：
    ```ts
    export type AgentHookHandler<T> = (payload: T) => Promise<void> | void
    export type AgentHooks = { onTurnStart?: AgentHookHandler<TurnStartHookPayload>; ... }
    export type AgentMiddleware = AgentHooks & { name?: string }
    ```
- `AgentDeps` 新增 `hooks?: AgentHooks`（简单模式）与 `middlewares?: AgentMiddleware[]`（多实例模式）。
- Hook 调用顺序：`deps.hooks` → `deps.middlewares`（顺序执行）。任何一个抛错只打印 `console.warn`，不中断主流程。

### 运行流程

1. 创建 Session 时聚合所有中间件，存成 `HookRunnerMap`。
2. 运行 Turn：
    - 写入 `turn_start` 后触发 `onTurnStart`。
    - 每次解析出 `action`，在执行工具前触发 `onAction`。
    - 工具返回 observation 后写回历史并触发 `onObservation`。
    - 任一路径确定 `finalText` 时立即触发 `onFinal`，并保证每次 `final` 事件对应一次 Hook 调用。
3. Hook 只读取上下文，不允许修改核心状态（文档中强调“视为只读”）。

## 迁移与测试

- 旧的 `deps.onObservation(tool, observation, step)` 已移除，如需监听工具反馈，应在 `hooks` 或 `middlewares` 中实现 `onObservation`。
- `onAssistantStep` 流式回调保持原样，可与 Hook 并行使用。
- 测试：使用 mock LLM + 假工具，断言 Hook/中间件依顺序触发、携带上下文，并运行 `bun test`（核心 runtime + 工具）做回归。
