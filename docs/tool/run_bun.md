# Memo CLI `run_bun` 工具

在临时文件中运行任意 Bun (JS/TS) 代码，等价于一个轻量「代码解释器」。

## 基本信息

- 工具名称：`run_bun`
- 描述：在临时文件中运行 Bun (JS/TS) 代码，支持 top-level await，输出 stdout/stderr 与退出码。
- 文件：`packages/tools/src/tools/run_bun.ts`
- 确认：否

## 参数

- `code`（字符串，必填）：需要执行的 JS/TS 代码。

## 行为

- 将代码写入临时目录的随机文件（尊重 `TMPDIR`，否则 `/tmp`），使用 `bun run <tmp>.ts` 执行。
- 开启 `FORCE_COLOR=0`，避免彩色输出影响解析。
- 收集 stdout/stderr 文本及退出码，返回格式：
  ```
  exit=<code>
  stdout:
  <stdout content>
  stderr:
  <stderr content>
  ```
- 即使出现 runtime error 也会返回（exit 为非 0，stderr 包含错误）；只在文件写入/进程创建等异常时标记 `isError=true`。
- 执行完会尝试删除临时文件（清理失败会被忽略）。

## 适用场景

- 小块 JS/TS 验证、字符串/数据处理。
- 调用 npm/bun 内置 API（无需项目依赖）。
- 验证 top-level await 或 TypeScript 类型提示行为。

## 注意

- 只能访问环境已有的依赖（未自动安装第三方包）。
- 代码运行环境与 memo 进程同机，需注意安全与资源消耗。
- 输出未经截断，长输出可能占用较多 token。***
