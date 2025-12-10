# Memo CLI `todo` 工具

进程内维护的待办列表，支持新增、替换、更新、删除，最多 10 条，不持久化。

## 基本信息
- 工具名称：`todo`
- 描述：管理待办列表（add/update/remove/replace），最多 10 条，不持久化
- 文件：`packages/tools/src/tools/todo.ts`
- 确认：否

## 参数
使用 discriminated union：
- `type`：`add` / `replace` / `update` / `remove`。
- 当 `type=add`：`todos` 为待添加任务数组，每项需提供 `content`、`status`（`pending`/`in_progress`/`completed`）、`activeForm`，长度 1–10。
- 当 `type=replace`：同上，但会清空后替换全部任务。
- 当 `type=update`：`todos` 项额外需要 `id`（存在的任务 id），不可重复，长度 1–10。
- 当 `type=remove`：`ids` 字符串数组，长度 ≥1。
- 字段约束：`content` 1–100 字符，`activeForm` 1–120 字符。

## 行为
- 全部状态存于进程内内存；进程退出即清空。
- `add`：若超出上限 10 条返回错误；否则生成 `id` 并追加。
- `replace`：清空并替换为新列表（仍受 10 条限制）。
- `update`：校验 id 存在且不重复，逐项更新内容、状态、activeForm。
- `remove`：删除给定 id；若无任何命中返回错误。
- 返回 JSON 字符串，包含当前任务列表与操作信息（op/count/tasks/added/updated/removed/replaced）。
- 异常或规则错误时返回错误消息。

## 输出示例
`{"op":"add","count":2,"tasks":[{"id":"...","content":"do A","status":"pending","activeForm":"task A"}],"added":[...],"updated":null,"removed":null,"replaced":false}`

## 注意
- 不做持久化，也无并发锁；适合单进程短期待办。
- 上层应保存返回的 `id` 以便后续更新/删除。
