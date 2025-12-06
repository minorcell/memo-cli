import assert from "node:assert"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, test, beforeAll, afterAll } from "bun:test"
import { read } from "@memo/tools/tools/read"
import { write } from "@memo/tools/tools/write"
import { edit } from "@memo/tools/tools/edit"

let tempDir: string

beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "memo-tools-"))
})

afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe("write tool", () => {
    test("rejects missing path", async () => {
        const res = await write("{}")
        assert.strictEqual(res, "write 需要 file_path 字符串")
    })

    test("writes content to file", async () => {
        const target = join(tempDir, "write.txt")
        const res = await write(JSON.stringify({ file_path: target, content: "hello" }))
        assert.ok(res.includes("已写入"), "should acknowledge write")
        const content = await readFile(target, "utf8")
        assert.strictEqual(content, "hello")
    })
})

describe("read tool", () => {
    test("returns validation error for bad json", async () => {
        const res = await read("not-json")
        assert.ok(res.startsWith("read 参数需为 JSON"))
    })

    test("reads with offset and limit", async () => {
        const target = join(tempDir, "read.txt")
        await write(JSON.stringify({ file_path: target, content: "a\nb\nc\nd" }))
        const res = await read(JSON.stringify({ file_path: target, offset: 2, limit: 2 }))
        assert.strictEqual(res, "2: b\n3: c")
    })
})

describe("edit tool", () => {
    test("rejects missing fields", async () => {
        const res = await edit("{}")
        assert.strictEqual(res, "edit 需要 file_path 字符串")
    })

    test("replaces first occurrence by default", async () => {
        const target = join(tempDir, "edit.txt")
        await write(JSON.stringify({ file_path: target, content: "foo bar foo" }))
        const res = await edit(
            JSON.stringify({
                file_path: target,
                old_string: "foo",
                new_string: "baz",
                replace_all: false,
            })
        )
        assert.ok(res.includes("count=1"))
        const content = await readFile(target, "utf8")
        assert.strictEqual(content, "baz bar foo")
    })

    test("replaces all when replace_all is true", async () => {
        const target = join(tempDir, "edit-all.txt")
        await write(JSON.stringify({ file_path: target, content: "x y x y" }))
        const res = await edit(
            JSON.stringify({
                file_path: target,
                old_string: "y",
                new_string: "z",
                replace_all: true,
            })
        )
        assert.ok(res.includes("count=2"))
        const content = await readFile(target, "utf8")
        assert.strictEqual(content, "x z x z")
    })
})
