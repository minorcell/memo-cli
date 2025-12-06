import assert from "node:assert"
import { describe, test } from "bun:test"
import { fetchUrl } from "@memo/tools/tools/fetch"

describe("fetch tool", () => {
    test("requires url", async () => {
        const res = await fetchUrl(" ")
        assert.strictEqual(res, "fetch 需要 URL")
    })

    test("fetches data url content", async () => {
        const res = await fetchUrl("data:text/plain,hello")
        assert.ok(res.includes("status=200"))
        assert.ok(res.includes('body="hello"'))
    })
})
