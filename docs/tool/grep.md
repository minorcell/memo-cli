# Memo CLI `grep` 工具

基于 ripgrep 搜索文本，支持输出匹配内容、仅文件列表或计数。

## 基本信息
- 工具名称：`grep`
- 描述：基于 ripgrep 查找文本，支持输出匹配内容、文件列表或计数
- 文件：`packages/tools/src/tools/grep.ts`
- 确认：否

## 参数
- `pattern`（字符串，必填）：要搜索的正则模式。
- `path`（字符串，可选）：搜索起点目录，默认当前工作目录。
- `output_mode`（枚举，可选）：`content`（默认，含行号）、`files_with_matches`（仅文件列表）、`count`（计数）。
- `glob`（字符串，可选）：附加 `--glob` 过滤。
- `-i`（布尔，可选）：忽略大小写。
- `-A`/`-B`/`-C`（非负整数，可选）：上下文行数（后/前/两侧）。

## 行为
- 依赖系统 `rg`，未安装时直接报错。
- 组装对应 `rg` 参数：`--line-number --no-heading`（content）、`-l`（files）、`-c`（count）；禁用颜色。
- 将 `pattern` 与 `path` 传给 `rg` 执行，收集 stdout/stderr。
- 退出码 2 视为错误；退出码 1 且无输出视为“未找到匹配”；否则返回命令输出。
- 异常时返回错误消息。

## 输出示例（content 模式）
```
src/index.ts:12: const x = 1;
src/index.ts:18: console.log(x);
```

## 注意
- 直接依赖外部 `rg`，需确保 PATH 可用。
- 未做结果分页，大量匹配会一次性返回。
