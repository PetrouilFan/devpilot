import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { createIsolation, cleanup } from "../../src/subagent/isolation"
import fs from "fs/promises"
import path from "path"
import os from "os"

function tmpDir(): string {
  return path.join(os.tmpdir(), `isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe("subagent isolation", () => {
  it("none mode returns baseDir", async () => {
    const baseDir = tmpDir()
    const result = await Effect.runPromise(createIsolation(baseDir, "task-1", "none"))
    expect(result.mode).toBe("none")
    expect(result.workDir).toBe(baseDir)
    expect(result.cleanup).toBeUndefined()
  })

  it("scope mode creates directory and cleans up", async () => {
    const baseDir = tmpDir()
    await fs.mkdir(baseDir, { recursive: true })

    const result = await Effect.runPromise(createIsolation(baseDir, "task-1", "scope"))
    expect(result.mode).toBe("scope")
    expect(result.workDir).toContain("scopes/task-1")

    const exists = await fs.access(result.workDir).then(() => true, () => false)
    expect(exists).toBe(true)

    await Effect.runPromise(cleanup(result))

    const existsAfter = await fs.access(result.workDir).then(() => true, () => false)
    expect(existsAfter).toBe(false)
  })

  it("worktree mode creates git worktree", async () => {
    const baseDir = tmpDir()
    await fs.mkdir(baseDir, { recursive: true })

    Bun.spawnSync(["git", "init"], { cwd: baseDir, stdio: ["ignore", "pipe", "pipe"] })
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: baseDir, stdio: ["ignore", "pipe", "pipe"] })
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: baseDir, stdio: ["ignore", "pipe", "pipe"] })
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: baseDir, stdio: ["ignore", "pipe", "pipe"] })

    const result = await Effect.runPromise(createIsolation(baseDir, "task-1", "worktree"))
    expect(result.mode).toBe("worktree")
    expect(result.workDir).toContain("worktrees/task-1")
    expect(result.cleanup).toBeDefined()

    const exists = await fs.access(result.workDir).then(() => true, () => false)
    expect(exists).toBe(true)

    await Effect.runPromise(cleanup(result))

    const existsAfter = await fs.access(result.workDir).then(() => true, () => false)
    expect(existsAfter).toBe(false)
  })
})
