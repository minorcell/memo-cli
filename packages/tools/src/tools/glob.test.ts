import assert from "node:assert"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join, basename } from "node:path"
import { tmpdir } from "node:os"
import { describe, test, beforeAll, afterAll } from "bun:test"
import { glob } from "@memo/tools/tools/glob"

let tempDir: string

beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memo-tools-glob-"))
    await writeFile(join(tempDir, "a.ts"), "content")
    await writeFile(join(tempDir, "b.js"), "content")
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe("glob tool", () => {
    test("validates input", async () => {
        const res = await glob("{}")
        assert.strictEqual(res, "glob 需要 pattern 字符串")
    })

    test("matches pattern under provided path", async () => {
        const res = await glob(JSON.stringify({ pattern: "**/*.ts", path: tempDir }))
        const files = res.split("\n").filter(Boolean).map((p) => basename(p))
        assert.deepStrictEqual(files.sort(), ["a.ts"])
    })
})
