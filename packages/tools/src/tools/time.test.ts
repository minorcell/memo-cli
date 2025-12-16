import assert from 'node:assert'
import { describe, test } from 'bun:test'
import { timeTool } from '@memo/tools/tools/time'

describe('time tool', () => {
    test('requires empty input object', () => {
        const ok = timeTool.inputSchema.safeParse({})
        assert.strictEqual(ok.success, true)

        const invalid = timeTool.inputSchema.safeParse({ extra: true })
        assert.strictEqual(invalid.success, false)
    })

    test('returns iso/utc/timezone payload', async () => {
        const before = Date.now()
        const res = await timeTool.execute({})
        const after = Date.now()

        const text = res.content?.[0]?.type === 'text' ? res.content[0].text : ''
        assert.ok(text.length > 0, 'should return payload text')
        const payload = JSON.parse(text)

        assert.strictEqual(typeof payload.iso, 'string')
        assert.ok(payload.iso.includes('T'), 'iso should contain T split')
        assert.strictEqual(typeof payload.utc_iso, 'string')
        assert.ok(payload.utc_iso.endsWith('Z'), 'utc iso should be Zulu time')
        assert.strictEqual(typeof payload.epoch_ms, 'number')
        assert.strictEqual(Math.floor(payload.epoch_ms / 1000), payload.epoch_seconds)
        assert.ok(
            payload.epoch_ms >= before - 1000 && payload.epoch_ms <= after + 1000,
            'timestamp should be near now',
        )

        const offsetFromEnv = -new Date().getTimezoneOffset()
        const normalizedOffset = offsetFromEnv === 0 ? 0 : offsetFromEnv
        assert.strictEqual(payload.timezone.offset_minutes, normalizedOffset)
        assert.strictEqual(typeof payload.timezone.offset, 'string')
        assert.ok(payload.iso.endsWith(payload.timezone.offset), 'local iso should include offset')
        assert.strictEqual(typeof payload.timezone.name, 'string')

        assert.strictEqual(typeof payload.day_of_week, 'string')
        assert.strictEqual(typeof payload.human_readable, 'string')
        assert.ok(
            payload.human_readable.includes('UTC'),
            'human readable should reference UTC offset',
        )
        assert.ok(
            payload.human_readable.includes(payload.timezone.offset),
            'human readable should include offset',
        )
        assert.strictEqual(payload.source, 'local_system_clock')
    })
})
