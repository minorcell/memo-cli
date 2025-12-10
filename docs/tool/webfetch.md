# Memo CLI `webfetch` 工具

受限 HTTP GET，返回处理后的纯文本正文（会自动剥离 HTML 标签），带超时与大小限制。

## 基本信息
- 工具名称：`webfetch`
- 描述：HTTP GET 请求，返回处理后的纯文本正文（自动剥离 HTML 标签）
- 文件：`packages/tools/src/tools/webfetch.ts`
- 确认：否

## 参数
- `url`（字符串，必填）：请求的完整 URL，协议仅支持 `http: / https: / data:`。

## 行为
- 校验 URL 与协议；不支持的协议或无效 URL 直接报错。
- 10s 超时，通过 AbortController 中止。
- 响应体限制 512000 bytes：`content-length` 超限直接拒绝；流式读取时超限则中止。
- 对 HTML 内容进行剥离：
  - 去除 `<script>/<style>`，将块级元素/换行标签转换为换行，`<li>` 前置 `- `，去掉其他标签。
  - 进行常见实体解码，压缩多余空白与空行。
- 非 HTML 直接 `trim`。
- 预览文本最长 4000 字符；超出时截断并标注 `text_truncated=true`。
- 返回格式：`status=<code> bytes=<len> text_chars=<chars> text="<preview>" [text_truncated=true] [source=html_stripped]`。
- 超时、中止或 fetch 异常返回错误消息并标记 `isError=true`。

## 输出示例
`status=200 bytes=10240 text_chars=3800 text="Example content..." source=html_stripped`

## 注意
- 仅 GET，不发送自定义头；未处理重定向/压缩细节。
- 一律按 UTF-8 解码，非 UTF-8 站点可能乱码。
- 大型 `data:` URL 仍需经过 fetch，可能受体积限制中止。
