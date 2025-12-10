# Memo CLI `bash` 工具

执行任意 bash 命令，返回 exit/stdout/stderr 结果，主要用于调试与脚本执行（安全性由上层控制）。

## 基本信息
- 工具名称：`bash`
- 描述：在 shell 中执行命令，返回 exit/stdout/stderr
- 文件：`packages/tools/src/tools/bash.ts`
- 确认：否

## 参数
- `command`（字符串，必填）：要执行的完整命令。

## 行为
- 使用 `bash -lc <command>` 在当前环境中运行；继承进程 `env`。
- 捕获 stdout/stderr，等待子进程退出。
- 组装为单行文本返回：`exit=<code> stdout="<...>" stderr="<...>"`。
- 任何异常（如 spawn 失败）返回错误消息，标记为 `isError=true`。

## 输出示例
`exit=0 stdout="hello\n" stderr=""`

## 注意
- 不做命令安全校验，请在上层控制可执行内容。
- `command` 为空白时直接报错，不会执行。
