import type { ToolFn } from "@memo/tools/tools/types"

export const bash: ToolFn = async (rawCmd: string) => {
    const cmd = rawCmd.trim()
    if (!cmd) return "bash 需要要执行的命令"

    try {
        const proc = Bun.spawn(["bash", "-lc", cmd], {
            stdout: "pipe",
            stderr: "pipe",
            env: process.env,
        })

        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited

        return `exit=${exitCode} stdout="${stdout}" stderr="${stderr}"`
    } catch (err) {
        return `bash 执行失败: ${(err as Error).message}`
    }
}
