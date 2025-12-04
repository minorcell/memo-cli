# 开发计划（UI/Core/Tools 分层 + MCP 兼容）

## 阶段一：分层落地与契约固化

阶段目标：抽出 Core/Tools 包，固化 ToolRegistry 与 LLMClient 接口，保持现有 XML 协议可运行。

[] 建立 packages 结构（core/tools/ui），迁移主循环、工具实现与类型到对应包，保留现有 CLI 入口可运行。
[] 定义 Core 对外接口（runAgent / 事件流）、ToolRegistry 接口与 ToolFn 约束，整理 prompt/history 配置注入点。
[] 抽离 DeepSeek 客户端到 core/apis，使用 request 封装；补充类型与错误处理。

## 阶段二：MCP 适配与双协议准备

阶段目标：在 Tools 层引入 MCP 适配器，Core 支持“本地工具 + MCP 工具”的注册；为协议切换预埋扩展点。

[] 实现 MCP 客户端/适配器，拉取 MCP 工具定义并包装为 ToolFn，注入 ToolRegistry。
[] Core 调用路径支持动态工具源（本地+MCP），保持 XML 解析不变；新增协议抽象层（parser+prompt 可切）。
[] 增加日志/错误可观测性（工具来源、本地/MCP 标记），确保历史记录兼容。

## 阶段三：UI 替换与协议 A/B

阶段目标：引入 Ink UI，支撑流式渲染与配置选择；准备 JSON 工具调用协议的 A/B（可选）。

[] 在 ui 包实现 Ink 界面（输入、消息流、工具日志、状态指示），调用 Core 的事件流接口。
[] 增加配置入口（模型、温度、启用工具/MCP、日志路径），由 UI 注入 Core/Tools。
[] 预研 JSON 工具调用协议版本（prompt + parser），与 XML 并存可开关，便于后续切换到标准工具调用。
