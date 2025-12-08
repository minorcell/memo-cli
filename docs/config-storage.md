# 配置与会话存储设计（~/.memo/）

目标：像 Claude/LLM CLI 工具一样，把配置和会话历史放到用户主目录（~/.memo），而不是项目目录。支持多 Provider 配置，按日期归档 Session JSONL，便于长期使用与迁移。

## 目录布局（默认 ~/.memo）

```
~/.memo/
  config.toml           # 全局配置（providers/默认 provider/日志/路径）
  sessions/
    25/12/01/UUID.jsonl # 按 YY/MM/DD 分桶的会话日志（JSONL 事件）
    25/12/02/UUID.jsonl
```

- 路径可通过环境变量 `MEMO_HOME` 覆盖，默认为 `~/.memo`。
- Session 文件命名：`sessions/<YY>/<MM>/<DD>/<uuid>.jsonl`，内容为事件流（与现有 JSONL 事件格式一致）。

## 配置文件（config.toml）

```toml
# 默认 provider 名称（providers 中的一个）
current_provider = "deepseek"
# 每个 trun 最大的步骤数
max_steps = 100

[[providers]]
name = "deepseek"
env_api_key = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
base_url = "https://api.deepseek.com"

[[providers]]
name = "openai"
env_api_key = "OPENAI_API_KEY"
model = "gpt-4.1-mini"
base_url = "https://api.openai.com/v1"
```

字段说明：

- `current_provider`: 启动时使用的 provider 名称。
- `providers[]`: 可配置多个 LLM 供应商。
    - `name`: 标识符，供选择使用。
    - `env_api_key`: 读取的环境变量名称（不在文件中存密钥）。
    - `model`: 默认模型名。
    - `base_url`: 可选，兼容 OpenAI 生态；缺省则使用 SDK 默认。

## 核心改造要点

- **配置加载层**：在 Core 增加配置加载模块（读取 `MEMO_HOME/config.toml`，无则用内置默认）。解析 provider 列表，暴露 `resolveProvider(name)` 返回 `{ baseURL, model, apiKey }`。
- **默认路径**：历史 sink 默认指向 `sessions_dir`（按日期/uuid），不再写入仓库根目录。
- **依赖注入**：`withDefaultDeps` 从配置中选择 provider（默认或 CLI/环境覆盖），初始化 LLM 客户端；token 预算从配置读取，CLI 覆盖优先。

## UI/CLI 行为

- 启动时读取 config.toml，选择 provider（默认或 `--provider <name>`）。
- Session 文件路径在启动时打印（便于查阅 JSONL）。

## JSONL 事件保持不变

- 继续使用 `type: session_start/turn_start/assistant/action/observation/final/turn_end/session_end`。
- `session_start.meta` 中写入 provider 名称、模型、base_url、tokenizer、预算。

## 迁移与兼容

- 当 config.toml 缺失时，使用内置默认 provider（DeepSeek+环境变量），首次运行通过交互式输入name、env_api_key、model、base_url。

## 安全与专业性

- 不在 config.toml 中存放 API key，只引用环境变量名。
- 日志放在用户目录，避免意外提交到仓库。
