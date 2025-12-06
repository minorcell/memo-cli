import assert from "node:assert"
import { describe, test } from "bun:test"
import { bash } from "@memo/tools/tools/bash"

describe("bash tool", () => {
    test("returns prompt when command is empty", async () => {
        const res = await bash("   ")
        assert.strictEqual(res, "bash 需要要执行的命令")
    })

    test("executes simple command and captures output", async () => {
        const res = await bash("echo hello")
        assert.ok(res.includes('exit=0'), "exit code should be captured")
        assert.ok(res.includes('hello'), "stdout should include command output")
    })
})
