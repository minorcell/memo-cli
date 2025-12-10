# Memo CLI `write` 工具

创建或覆盖写入文件内容，必要时递归创建父目录。

## 基本信息
- 工具名称：`write`
- 描述：创建或覆盖文件，传入 file_path 与 content
- 文件：`packages/tools/src/tools/write.ts`
- 确认：否

## 参数
- `file_path`（字符串，必填）：要写入的目标路径（标准化为绝对路径）。
- `content`（可选）：写入内容，支持字符串、数字、布尔、null、数组、对象、`Uint8Array`、`ArrayBuffer`。

## 行为
- 通过 `normalizePath` 标准化路径；递归创建父目录。
- 内容归一化：
  - 字符串：按原文写入。
  - `Uint8Array`/`ArrayBuffer`：按二进制写入。
  - 其他类型：序列化为 JSON（带缩进）。
- 调用 `Bun.write` 覆盖目标文件，返回写入信息（文本长度或字节数）。
- 异常时返回错误消息。

## 输出示例
`已写入 /abs/path/file.txt (overwrite, text_length=12)`

## 注意
- 始终覆盖写入，不做差异检查。
- `content` 省略时会写入序列化后的空字符串（JSON 结果）。
