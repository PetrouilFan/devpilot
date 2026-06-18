import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"

export type IsolationMode = "worktree" | "scope" | "none"

export interface IsolationResult {
  readonly mode: IsolationMode
  readonly workDir: string
  readonly cleanup?: Effect.Effect<void, never, never>
}

function spawnGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

export function createIsolation(
  baseDir: string,
  taskID: string,
  mode: IsolationMode,
): Effect.Effect<IsolationResult> {
  if (mode === "none") {
    return Effect.succeed({ mode: "none" as const, workDir: baseDir })
  }

  if (mode === "worktree") {
    return Effect.gen(function* () {
      const branch = `subagent/${taskID}`
      const worktreePath = path.join(baseDir, ".opencode", "worktrees", taskID)

      yield* Effect.try({
        try: () => spawnGit(["worktree", "add", worktreePath, "-b", branch], baseDir),
        catch: (error) => new Error(`Failed to create worktree: ${error}`),
      }).pipe(Effect.orDie)

      return {
        mode: "worktree" as const,
        workDir: worktreePath,
        cleanup: Effect.try({
          try: () => {
            spawnGit(["worktree", "remove", worktreePath, "--force"], baseDir)
          },
          catch: (error) => new Error(`Failed to remove worktree: ${error}`),
        }).pipe(Effect.orDie),
      }
    })
  }

  // scope mode
  return Effect.gen(function* () {
    const scopeDir = path.join(baseDir, ".opencode", "scopes", taskID)
    yield* Effect.tryPromise(() => fs.mkdir(scopeDir, { recursive: true })).pipe(Effect.orDie)
    return {
      mode: "scope" as const,
      workDir: scopeDir,
      cleanup: Effect.tryPromise(() => fs.rm(scopeDir, { recursive: true, force: true })).pipe(Effect.orDie),
    }
  })
}

export function cleanup(result: IsolationResult): Effect.Effect<void> {
  if (result.cleanup) return result.cleanup
  return Effect.void
}

export * as SubagentIsolation from "./isolation"
