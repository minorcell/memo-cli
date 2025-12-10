# Memo CLI `glob` 工具

按 glob 模式扫描目录并返回匹配的绝对路径列表。

## 基本信息
- 工具名称：`glob`
- 描述：按 glob 模式匹配文件，返回绝对路径列表
- 文件：`packages/tools/src/tools/glob.ts`
- 确认：否

## 参数
- `pattern`（字符串，必填）：glob 模式（例如 `src/**/*.ts`）。
- `path`（字符串，可选）：扫描起点目录；默认当前工作目录。

## 行为
- 使用 `Bun.Glob` 在指定 `cwd` 下扫描。
- 将所有匹配项标准化为绝对路径，按发现顺序返回（以换行分隔）。
- 无匹配时返回提示“未找到匹配文件”。
- 执行异常时返回错误消息。

## 输出示例
```
/abs/workspace/src/a.ts
/abs/workspace/src/sub/b.ts
```

## 注意
- 不会自动忽略 `node_modules` 等目录，需要在 pattern 中自行过滤。
