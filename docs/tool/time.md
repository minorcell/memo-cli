# Memo CLI `time` 工具

提供可信的当前时间视图，统一由进程系统时间返回多种格式（本地 ISO、UTC、时间戳、时区偏移等），解决模型对“现在时间”模糊的问题。

## 基本信息

- 工具名称：`time`
- 描述：返回当前系统时间（ISO/UTC/epoch/timezone 等多视图）
- 文件：`packages/tools/src/tools/time.ts`
- 确认：否

## 参数

- 无输入。调用时传入空对象 `{}` 即可。

## 行为

- 读取进程所在系统时间，计算：
    - `iso`：本地时间的 ISO 8601 字符串（包含偏移，例如 `2025-01-01T20:15:00.123+08:00`）
    - `utc_iso`：`Date.toISOString()` 结果（UTC）
    - `epoch_ms` / `epoch_seconds`：UNIX 时间戳（毫秒与秒）
    - `timezone`: `name`（IANA 时区名称）、`offset_minutes`（相对于 UTC 的分钟数）、`offset`（`±HH:MM` 形式）
    - `day_of_week`：英文星期
    - `human_readable`：`YYYY-MM-DD HH:mm:ss (Weekday, UTC±HH:MM <tz>)` 形式
    - `source`: 固定为 `local_system_clock`
- 以上内容会以 JSON 字符串写入 `CallToolResult` 的文本内容，方便模型解析。
- 不涉及网络调用；如系统时钟被篡改则结果也会随之变化。

## 输出示例

```json
{
    "iso": "2025-01-01T20:15:00.123+08:00",
    "utc_iso": "2025-01-01T12:15:00.123Z",
    "epoch_ms": 1735733700123,
    "epoch_seconds": 1735733700,
    "timezone": {
        "name": "Asia/Shanghai",
        "offset_minutes": 480,
        "offset": "+08:00"
    },
    "day_of_week": "Wednesday",
    "human_readable": "2025-01-01 20:15:00 (Wednesday, UTC+08:00 Asia/Shanghai)",
    "source": "local_system_clock"
}
```

## 注意

- 仅返回当前时间快照，不提供倒计时或两个时间点的差值。
- 如果系统没有提供 IANA 时区名称，则 `timezone.name` 可能为 `UTC`。
- 输出为单行 JSON，模型在解析前可先调用 `JSON.parse`。
