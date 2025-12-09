# `todo` 工具设计方案（add/update/remove/replace）

目标：在对话中创建/更新待办列表，支持增删改/全量替换，限制规模以避免 token 开销。默认仅进程内维护（不持久化）。

## 接口定义

- 名称：`todo`
- 输入（Zod 校验）：
    - `type`: `add | update | remove | replace`。
    - `todos`（用于 `add/replace`）：数组 1~10 条。
        - `content`：string，命令式描述，非空，≤ 100 字符（会自动 trim）。
        - `status`：`pending | in_progress | completed`，必须是这三者之一。
        - `activeForm`：string，当前进行形式，非空，≤ 120 字符（会自动 trim）。
    - `todos`（用于 `update`）：同上，且包含 `id`（string）。
    - `ids`（用于 `remove`）：`id` 数组，非空。
- 输出：JSON 字符串：
    ```json
    {
      "op": "add|update|remove|replace",
      "count": 2,
      "tasks": [
        {"id":"...","status":"in_progress","content":"修复认证bug","activeForm":"正在修复认证bug"},
        {"id":"...","status":"pending","content":"运行测试","activeForm":"正在运行测试"}
      ],
      "added|updated|removed": [...]
    }
    ```

## 约束与规则

- 总任务数最多 10 条，空列表直接拒绝。
- 严格长度与必填校验，拒绝空白/超长输入。
- `add` 追加（受上限限制）；`replace` 覆盖；`update` 按 id 更新；`remove` 按 id 删除，缺失时返回错误。
- 仅在需要同步/整理计划时调用，避免高频调用。
- 默认不持久化：任务存储在当前进程内存，进程退出后清空；后续可选增加持久化开关。

## 实现要点（MVP）

- 工具文件 `packages/tools/src/tools/todo.ts`：
    - Zod schema 支持 `add/update/remove/replace`，总数 ≤10。
    - 任务字段长度限制，trim 空白，生成 uuid 作为 id。
    - 返回结构化 JSON，包含 op/count/tasks 及 added/updated/removed。
    - 仅进程内存维护（数组），不写文件，避免脏数据；需要跨会话再考虑可选持久化。
- 注册：在 `packages/tools/src/index.ts` 将 `todo` 加入 `TOOLKIT`，并在工具类型枚举中增加。
- 提示词：在系统 prompt 工具列表中加入 `todo` 示例，强调“最多 10 条、需要时才调用”。

## 可选扩展（后续）

- 启动时加载 `tasks.json` 并注入 prompt。
- 增量接口细化：单条 add/remove/update 以进一步减小 payload。
- 自动 activeForm 生成，减少模型负担。
