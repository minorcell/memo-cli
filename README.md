## ReAct Demo

一个用 Bun 快速跑起来的 ReAct Agent 示例，结合 DeepSeek 模型、XML 规范回复和可扩展工具集。

### 环境准备

```bash
bun install
```

需要 DeepSeek API Key：

```bash
export DEEPSEEK_API_KEY=your_key_here
```

### 运行与示例

```bash
# 直接提问
bun index.ts "帮我快速了解项目"
```

运行时会打印每轮 LLM 输出与最终 `<final>`。

![result](./public/image.png)

### 内置工具

- `getTime`：返回当前 ISO 时间。
- `bash`：执行 shell 命令，返回 exit/stdout/stderr。
- `read`：读取文件内容。
- `write`：写入/追加文件，参数 JSON：`{"path":"notes.txt","content":"...","mode":"overwrite|append"}`。
- `fetch`：对 URL 发 GET 请求，返回状态与正文。

### 自定义/扩展

- 修改 `prompt.tmpl` 调整行为或新增工具说明。
- 在 `tools.ts` 添加新工具并更新类型 `ToolName`，模型即可调用。
- 如需调试 LLM，可在 `index.ts` 中调整 `MAX_STEPS`、`temperature` 或增加日志。
