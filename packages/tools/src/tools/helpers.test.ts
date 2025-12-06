import assert from "node:assert"
import { describe, test } from "bun:test"
import { normalizePath } from "@memo/tools/tools/helpers"

describe("helpers.normalizePath", () => {
    test("normalizes relative paths to absolute", () => {
        const normalized = normalizePath("./tmp/../tmp/file.txt")
        assert.ok(normalized.endsWith("/tmp/file.txt") || normalized.endsWith("\\tmp\\file.txt"))
        assert.ok(normalized.startsWith("/"), "should be absolute path")
    })
})
