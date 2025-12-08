# config 模块

负责配置与路径处理：
- 读取/写入 `~/.memo/config.toml`（可用 `MEMO_HOME` 覆盖）。
- 提供 provider 选择（name/env_api_key/model/base_url）。
- 生成会话存储路径：`sessions/YY/MM/DD/<uuid>.jsonl`。
- 提供 sessionId 生成工具。

主要文件：
- `config.ts`：配置类型、加载（带 needsSetup 标记）、写入、路径构建。
- `constants.ts`：兜底默认（MAX_STEPS 等）。
