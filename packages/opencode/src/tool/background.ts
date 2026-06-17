import { Effect, Stream, Exit, Duration, Cause } from "effect"
import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Shell } from "@devpilot-ai/core/shell"
import { BackgroundID } from "./background/id"
import { BackgroundPrompt } from "./background/prompt"
import type { Parameters } from "./background/prompt"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { TaskPromptOps } from "./task"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { assertExternalDirectoryEffect } from "./external-directory"

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}

function captureOutput(
  handle: { all: Stream.Stream<Uint8Array, unknown>; exitCode: Effect.Effect<number, unknown> },
  timeoutMs: number,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const outputChunks: string[] = []

    yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
      outputChunks.push(chunk)
      return Effect.void
    }).pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause),
      ),
    )

    yield* handle.exitCode.pipe(
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause),
      ),
    )

    return outputChunks.join("")
  })
}

const BACKGROUND_STARTED = [
  "The command is running in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, or check on its status — continue working on other tasks.",
  "You can use the background tool with action='status' and the job_id to check on it later if needed.",
].join("\n")

function renderOutput(input: { state: "running" | "completed" | "error"; text: string }) {
  const tag = input.state === "error" ? "background_error" : "background_result"
  return `<${tag}>\n${input.text}\n</${tag}>`
}

function renderStatus(input: {
  jobID: string
  status: string
  command?: string
  cwd?: string
  output?: string
  error?: string
  startedAt?: number
  completedAt?: number
}) {
  const lines = [
    `Job: ${input.jobID}`,
    `Status: ${input.status}`,
    `Command: ${input.command ?? "unknown"}`,
    `Directory: ${input.cwd ?? "unknown"}`,
  ]
  if (input.startedAt) lines.push(`Started: ${new Date(input.startedAt).toISOString()}`)
  if (input.completedAt) lines.push(`Completed: ${new Date(input.completedAt).toISOString()}`)
  if (input.output) lines.push(`\nOutput:\n${input.output}`)
  if (input.error) lines.push(`\nError:\n${input.error}`)
  return lines.join("\n")
}

type BackgroundMetadata = {
  status: string
  description?: string
  jobId?: string
  command?: string
  output?: string
}

export const BackgroundTool = Tool.define(
  BackgroundID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const trunc = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const plugin = yield* Plugin.Service
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

    function runInBackground(
      params: { command: string; description: string; workdir?: string; timeout?: number; mode?: "stream" | "wait" },
      ctx: Tool.Context,
      shell: string,
      shellEnv: NodeJS.ProcessEnv,
    ) {
      return Effect.gen(function* () {
        const mode = params.mode ?? "stream"
        const timeoutMs = params.timeout ?? defaultTimeoutMs

        const handle = yield* spawner.spawn(cmd(shell, params.command, params.workdir ?? ".", shellEnv))

        const output = yield* Effect.race(
          captureOutput(handle, timeoutMs),
          Effect.sleep(Duration.millis(timeoutMs)).pipe(
            Effect.flatMap(() => handle.kill({ forceKillAfter: "5 seconds" })),
            Effect.andThen(() => Effect.fail(new Error("Command timed out"))),
          ),
        ).pipe(Effect.orDie)

        return output
      })
    }

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const limits = yield* trunc.limits()
        const prompt = BackgroundPrompt.render(limits, defaultTimeoutMs)

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const action = params.action ?? "run"

              if (action === "status") {
                if (!params.job_id) {
                  return {
                    title: "Background job status",
                    metadata: { status: "error" } as BackgroundMetadata,
                    output: "Error: job_id is required for action='status'",
                  }
                }
                const job = yield* background.get(params.job_id)
                if (!job) {
                  return {
                    title: "Background job status",
                    metadata: { status: "not_found" } as BackgroundMetadata,
                    output: `No background job found with ID: ${params.job_id}`,
                  }
                }
                return {
                  title: "Background job status",
                  metadata: {
                    status: job.status,
                    jobId: job.id,
                    command: job.metadata?.command as string | undefined,
                  } as BackgroundMetadata,
                  output: renderStatus({
                    jobID: job.id,
                    status: job.status,
                    command: job.metadata?.command as string | undefined,
                    cwd: job.metadata?.cwd as string | undefined,
                    output: job.output,
                    error: job.error,
                    startedAt: job.started_at,
                    completedAt: job.completed_at,
                  }),
                }
              }

              if (!params.command) {
                return {
                  title: "Background command",
                  metadata: { status: "error" } as BackgroundMetadata,
                  output: "Error: command is required for action='run'",
                }
              }
              if (!params.description) {
                return {
                  title: "Background command",
                  metadata: { status: "error" } as BackgroundMetadata,
                  output: "Error: description is required for action='run'",
                }
              }

              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir ? params.workdir : instanceCtx.directory
              const timeout = params.timeout ?? defaultTimeoutMs

              // Check external directory permission
              yield* assertExternalDirectoryEffect(ctx, cwd, { kind: "directory" })

              // Check bash permission for the command
              yield* ctx.ask({
                permission: "bash",
                patterns: [params.command],
                always: [params.command],
                metadata: { command: params.command, description: params.description, cwd },
              })

              const shellEnv = yield* Effect.gen(function* () {
                const extra = yield* plugin.trigger(
                  "shell.env",
                  { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
                  { env: {} },
                )
                return {
                  ...process.env,
                  ...extra.env,
                }
              })

              const jobID = `bg_${ctx.sessionID}_${Date.now()}`

              const injectResult = Effect.fn("BackgroundTool.injectResult")(function* (
                state: "completed" | "error",
                text: string,
              ) {
                const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
                if (!ops) return

                const currentSession = yield* sessions.get(ctx.sessionID)
                yield* ops
                  .prompt({
                    sessionID: ctx.sessionID,
                    agent: currentSession.agent ?? "build",
                    parts: [
                      {
                        type: "text",
                        synthetic: true,
                        text: renderOutput({
                          state,
                          text:
                            state === "completed"
                              ? `Background command completed (job: ${jobID}).\n\nOutput:\n${text}`
                              : `Background command failed (job: ${jobID}). Error:\n${text}`,
                        }),
                      },
                    ],
                  })
                  .pipe(Effect.catch(() => Effect.void))
              })

              const runEffect = runInBackground(
                {
                  command: params.command!,
                  description: params.description!,
                  workdir: params.workdir,
                  timeout: params.timeout,
                  mode: params.mode,
                },
                ctx,
                shell,
                shellEnv,
              )

              const runEffectScoped = Effect.scoped(runEffect)

              yield* background.start({
                id: jobID,
                type: "background-command",
                title: params.description,
                metadata: {
                  command: params.command,
                  cwd,
                  timeout,
                  mode: params.mode ?? "stream",
                },
                onPromote: Effect.void,
                run: runEffectScoped.pipe(
                  Effect.exit,
                  Effect.tap((exit) =>
                    Exit.isFailure(exit)
                      ? injectResult("error", String(exit.cause))
                      : injectResult("completed", exit.value),
                  ),
                  Effect.asVoid,
                  Effect.map(() => "done"),
                ),
              })

              yield* ctx.metadata({
                metadata: {
                  status: "running",
                  description: params.description,
                  jobId: jobID,
                },
              })

              return {
                title: params.description,
                metadata: {
                  status: "running",
                  description: params.description,
                  jobId: jobID,
                },
                output: renderOutput({
                  state: "running",
                  text: BACKGROUND_STARTED,
                }),
              }
            }),
        }
      })
  }),
)
