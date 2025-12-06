import assert from "node:assert"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, test, beforeAll, afterAll } from "bun:test"
import { glob } from "@memo/tools/tools/glob"
import { grep } from "@memo/tools/tools/grep"

let tempDir: string
let filePath: string

beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memo-tools-glob-grep-"))
    filePath = join(tempDir, "sample.txt")
    await writeFile(filePath, "hello\nfoo bar\nbaz")
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe("glob tool", () => {
    test("matches files under given path", async () => {
        const res = await glob(JSON.stringify({ pattern: "**/*.txt", path: tempDir }))
        assert.ok(res.includes("sample.txt"), "should list matching file")
    })

    test("returns hint when no matches", async () => {
        const res = await glob(JSON.stringify({ pattern: "*.md", path: tempDir }))
        assert.strictEqual(res, "未找到匹配文件")
    })
})

describe("grep tool", () => {
    const rgAvailable = Boolean(Bun.which("rg"))

    test("finds content with default output", async () => {
        const res = await grep(JSON.stringify({ pattern: "foo", path: tempDir }))
        if (!rgAvailable) {
            assert.strictEqual(res, "rg 未安装或不在 PATH")
            return
        }
        assert.ok(res.includes("sample.txt"), "should include filename")
        assert.ok(res.includes("foo bar"), "should include matching line")
    })

    test("supports count output mode", async () => {
        const res = await grep(
            JSON.stringify({ pattern: "hello", path: tempDir, output_mode: "count" })
        )
        if (!rgAvailable) {
            assert.strictEqual(res, "rg 未安装或不在 PATH")
            return
        }
        const trimmed = res.trim()
        assert.ok(trimmed.endsWith(":1") || /^\d+$/.test(trimmed))
    })

    test("returns hint when no matches", async () => {
        const res = await grep(JSON.stringify({ pattern: "notfound", path: tempDir }))
        if (!rgAvailable) {
            assert.strictEqual(res, "rg 未安装或不在 PATH")
            return
        }
        assert.strictEqual(res, "未找到匹配")
    })
})
