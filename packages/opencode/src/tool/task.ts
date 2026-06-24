import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@devpilot-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@devpilot-ai/core/database/database"
import { SubagentConcurrency } from "@/subagent/concurrency"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@devpilot-ai/core/provider"
import { ModelV2 } from "@devpilot-ai/core/model"
import * as SubagentIsolation from "@/subagent/isolation"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"

const TaskItem = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({
    description: "Unique identifier for this task (used in depends_on references)",
  }),
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  depends_on: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Task IDs that must complete before this task starts",
  }),
  model: Schema.optional(
    Schema.Struct({
      providerID: Schema.String.annotate({ description: "Provider ID for the model" }),
      modelID: Schema.String.annotate({ description: "Model ID to use" }),
    }),
  ).annotate({ description: "Override the model for this specific task" }),
  output: Schema.optional(
    Schema.Struct({
      format: Schema.Literals(["text", "structured", "list"]).annotate({
        description: "Expected output format",
      }),
      schema: Schema.optional(
        Schema.Record(Schema.String, Schema.Any).annotate({
          description: "JSON schema for structured output format",
        }),
      ),
      sections: Schema.optional(
        Schema.Array(Schema.String).annotate({
          description: "Required sections in the output (e.g. ['files', 'summary', 'issues'])",
        }),
      ),
      max_length: Schema.optional(
        Schema.Number.annotate({ description: "Maximum output length in characters" }),
      ),
    }),
  ).annotate({ description: "Output contract specifying what the subagent should return" }),
  on_failure: Schema.optional(Schema.Literals(["fail-fast", "continue", "retry"])).annotate({
    description: "How to handle this task's failure: 'fail-fast' aborts all, 'continue' keeps others, 'retry' retries once",
  }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "Maximum time in milliseconds for this task",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "Resume a previous task session by ID instead of creating a new one",
  }),
})

export const Parameters = Schema.Struct({
  tasks: Schema.Array(TaskItem).annotate({
    description:
      "Array of tasks to execute (at least 1 required). Independent tasks run in parallel. Each task becomes a separate subagent session.",
  }),
})

function renderTaskOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

type TaskType = Schema.Schema.Type<typeof TaskItem>
type TaskResult = {
  task: TaskType
  sessionID?: SessionID
  state: "completed" | "error" | "timeout"
  text: string
  error?: string
}

function taskKey(task: TaskType): string {
  return task.id ?? task.description
}

function hasDependencies(tasks: TaskType[]): boolean {
  return tasks.some((t) => t.depends_on && t.depends_on.length > 0)
}

function detectCycle(tasks: TaskType[]): string | null {
  const graph = new Map<string, string[]>()
  for (const task of tasks) {
    graph.set(taskKey(task), [...(task.depends_on ?? [])])
  }
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string): string | null {
    if (inStack.has(node)) return node
    if (visited.has(node)) return null
    visited.add(node)
    inStack.add(node)
    for (const dep of graph.get(node) ?? []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }
    inStack.delete(node)
    return null
  }

  for (const task of tasks) {
    const cycle = dfs(taskKey(task))
    if (cycle) return cycle
  }
  return null
}

function topologicalSort(tasks: TaskType[]): TaskType[][] {
  const graph = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const task of tasks) {
    const key = taskKey(task)
    graph.set(key, new Set(task.depends_on ?? []))
    inDegree.set(key, (inDegree.get(key) ?? 0) + (task.depends_on?.length ?? 0))
  }

  const layers: TaskType[][] = []
  const remaining = new Map(tasks.map((t) => [taskKey(t), t]))

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(
      (task) => (task.depends_on ?? []).every((dep) => !remaining.has(dep)),
    )
    if (ready.length === 0) break
    layers.push(ready)
    for (const task of ready) {
      remaining.delete(taskKey(task))
    }
  }

  return layers
}

function renderBatchOutput(results: TaskResult[]) {
  const succeeded = results.filter((r) => r.state === "completed").length
  const failed = results.length - succeeded

  return [
    `<batch total="${results.length}" succeeded="${succeeded}" failed="${failed}">`,
    ...results.map((r) => {
      if (r.state === "completed") {
        return [
          `<task id="${r.sessionID}" description="${r.task.description}" agent="${r.task.subagent_type}" state="completed">`,
          r.text,
          `</task>`,
        ].join("\n")
      }
      return [
        `<task id="${r.sessionID ?? r.task.description}" description="${r.task.description}" agent="${r.task.subagent_type}" state="${r.state}">`,
        `<error>${r.error ?? "Unknown error"}</error>`,
        `</task>`,
      ].join("\n")
    }),
    `</batch>`,
  ].join("\n")
}

function formatResultsForSynthesis(results: TaskResult[]): string {
  return results
    .map((r) => {
      const header = `## ${r.task.description} (${r.task.subagent_type})`
      if (r.state === "completed") {
        return `${header}\n\n${r.text}`
      }
      return `${header}\n\nFAILED: ${r.error}`
    })
    .join("\n\n---\n\n")
}

function buildResult(
  tasks: readonly TaskType[],
  results: TaskResult[],
  subagentCfg?: { orchestrator?: string },
) {
  const succeeded = results.filter((r) => r.state === "completed").length
  const failed = results.length - succeeded
  const output = renderBatchOutput(results)
  const orchestratorName = subagentCfg?.orchestrator

  const orchestratorHint = orchestratorName
    ? `\n\n<orchestrator_hint>Results ready for synthesis by "${orchestratorName}" agent. The orchestrator should read these results and produce a coherent summary.</orchestrator_hint>`
    : ""

  return {
    title: tasks.map((t) => t.description).join(", "),
    metadata: {
      totalTasks: tasks.length,
      succeeded,
      failed,
      ...(orchestratorName && {
        orchestratorSynthesisRequested: true,
        rawResults: formatResultsForSynthesis(results),
      }),
      taskResults: results.map((r) => ({
        taskDescription: r.task.description,
        taskID: r.task.id,
        sessionID: r.sessionID,
        state: r.state,
        error: "error" in r ? r.error : undefined,
      })),
    },
    output: output + orchestratorHint,
  }
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const provider = yield* Provider.Service

    const runSingleTask = Effect.fn("TaskTool.runSingleTask")(function* (
      task: TaskType,
      taskIndex: number,
      parentCtx: Tool.Context,
      concurrency: SubagentConcurrency.ConcurrencyLimit,
      parentResults?: Map<string, TaskResult>,
    ) {
      const cfg = yield* config.get()
      const subagentCfg = cfg.subagents

      if (!parentCtx.extra?.bypassAgentCheck) {
        yield* parentCtx.ask({
          permission: id,
          patterns: [task.subagent_type],
          always: ["*"],
          metadata: {
            description: task.description,
            subagent_type: task.subagent_type,
          },
        })
      }

      const next = yield* agent.get(task.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${task.subagent_type} is not a valid agent type`))
      }

      const session = task.task_id
        ? yield* sessions.get(SessionID.make(task.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(parentCtx.sessionID)
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const isolationMode = cfg.subagents?.isolation ?? "none"
      const isolationResult =
        isolationMode !== "none" && !session
          ? yield* SubagentIsolation.createIsolation(parent.directory, task.task_id ?? `${parentCtx.sessionID}-${taskIndex}`, isolationMode)
          : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: parentCtx.sessionID,
          title: task.description + ` (@${next.name} subagent)`,
          agent: next.name,
          metadata: isolationResult
            ? { isolation: { workDir: isolationResult.workDir, mode: isolationResult.mode } }
            : undefined,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: parentCtx.sessionID, messageID: parentCtx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      // Resolve model: task.model → agent.model → subagents.model → parent model
      const model = task.model
        ? {
            modelID: yield* provider
              .getModel(ProviderV2.ID.make(task.model!.providerID), ModelV2.ID.make(task.model!.modelID))
              .pipe(Effect.map((m) => m.id)),
            providerID: ProviderV2.ID.make(task.model.providerID),
          }
        : next.model ?? {
            modelID: ModelV2.ID.make(msg.info.modelID),
            providerID: ProviderV2.ID.make(msg.info.providerID),
          }

      const metadata = {
        parentSessionId: parentCtx.sessionID,
        sessionId: nextSession.id,
        model,
        taskIndex,
        description: task.description,
      }

      yield* parentCtx.metadata({
        title: task.description,
        metadata,
      })

      const ops = parentCtx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(task.prompt)

        // Inject parent task results if this task depends on others
        const depResults =
          parentResults && task.depends_on && task.depends_on.length > 0
            ? task.depends_on
                .map((dep) => parentResults.get(dep))
                .filter((r): r is TaskResult => r !== undefined)
            : []
        const depParts =
          depResults.length > 0
            ? [
                {
                  type: "text" as const,
                  text: [
                    "\n\n<dependency_results>",
                    ...depResults.map((r) =>
                      [
                        `<task id="${taskKey(r.task)}" state="${r.state}">`,
                        r.text || (r.error ? `<error>${r.error}</error>` : ""),
                        `</task>`,
                      ].join("\n"),
                    ),
                    "</dependency_results>",
                  ].join("\n"),
                },
              ]
            : []

        // Inject output contract into prompt if specified
        const contractParts = task.output
          ? [
              {
                type: "text" as const,
                text: [
                  "\n\n<output_contract>",
                  `Format: ${task.output.format ?? "text"}`,
                  ...(task.output.schema ? [`Schema: ${JSON.stringify(task.output.schema)}`] : []),
                  ...(task.output.sections ? [`Required sections: ${task.output.sections.join(", ")}`] : []),
                  ...(task.output.max_length ? [`Max length: ${task.output.max_length} characters`] : []),
                  "</output_contract>",
                ].join("\n"),
              },
            ]
          : []

        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts: [...parts, ...depParts, ...contractParts],
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const runWithTimeout = task.timeout_ms
        ? runTask().pipe(
            Effect.timeoutOrElse({
              duration: task.timeout_ms,
              orElse: () => Effect.succeed(""),
            }),
          )
        : runTask()

      const runWithConcurrency = concurrency.withPermit(runWithTimeout)

      return yield* runWithConcurrency.pipe(
        Effect.map(
          (text) =>
            ({
              task,
              sessionID: nextSession.id,
              state: "completed" as const,
              text,
            }) as const,
        ),
        Effect.catch(
          (error: unknown) =>
            Effect.succeed({
              task,
              sessionID: nextSession.id,
              state: "error" as const,
              text: "",
              error: error instanceof Error ? error.message : String(error),
            }),
        ),
        Effect.tap(() =>
          isolationResult ? SubagentIsolation.cleanup(isolationResult) : Effect.void,
        ),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* ops.cancel(nextSession.id)
            if (isolationResult) yield* SubagentIsolation.cleanup(isolationResult)
          }),
        ),
      )
    })

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (params.tasks.length === 0) {
        return yield* Effect.fail(new Error("At least one task is required"))
      }

      const cfg = yield* config.get()
      const subagentCfg = cfg.subagents

      const maxConcurrency = subagentCfg?.max_concurrency ?? 5
      const concurrency = SubagentConcurrency.make(maxConcurrency)

      // If tasks have dependencies, use DAG scheduling
      if (hasDependencies([...params.tasks])) {
        const cycle = detectCycle([...params.tasks])
        if (cycle) {
          return yield* Effect.fail(new Error(`Circular dependency detected involving task: ${cycle}`))
        }

        const layers = topologicalSort([...params.tasks])
        const completed = new Map<string, TaskResult>()
        let layersAborted = false

        for (const layer of layers) {
          if (layersAborted) {
            for (const task of layer) {
              completed.set(taskKey(task), {
                task,
                state: "error",
                text: "",
                error: "Skipped: earlier task failed with fail-fast",
              })
            }
            continue
          }

          const layerResults = yield* Effect.all(
            layer.map((task, i) => runSingleTask(task, i, ctx, concurrency, completed)),
            { concurrency: maxConcurrency },
          )

          let layerAborted = false
          const retriedResults: TaskResult[] = []

          for (let i = 0; i < layer.length; i++) {
            const result = layerResults[i]
            retriedResults.push(result)

            if (result.state !== "completed") {
              const failureMode = result.task.on_failure ?? "continue"
              if (failureMode === "fail-fast") {
                layerAborted = true
                layersAborted = true
              } else if (failureMode === "retry") {
                const retry = yield* runSingleTask(
                  result.task,
                  i,
                  ctx,
                  concurrency,
                  completed,
                )
                retriedResults[retriedResults.length - 1] = retry
              }
            }
          }

          for (const result of retriedResults) {
            completed.set(taskKey(result.task), result)
          }
        }

        const allResults = [...completed.values()]
        return buildResult(params.tasks, allResults, subagentCfg)
      }

      // No dependencies — execute all tasks concurrently with on_failure handling
      const results = yield* Effect.all(
        params.tasks.map((task, i) => runSingleTask(task, i, ctx, concurrency)),
        { concurrency: maxConcurrency },
      )

      // Process retries and fail-fast after all tasks complete
      const finalResults: TaskResult[] = []
      let aborted = false

      for (const result of results) {
        if (aborted) {
          finalResults.push({
            task: result.task,
            state: "error",
            text: "",
            error: "Skipped: earlier task failed with fail-fast",
          })
          continue
        }

        finalResults.push(result)

        if (result.state !== "completed") {
          const failureMode = result.task.on_failure ?? "continue"
          if (failureMode === "fail-fast") {
            aborted = true
          } else if (failureMode === "retry") {
            const retry = yield* runSingleTask(
              result.task,
              finalResults.length - 1,
              ctx,
              concurrency,
            )
            finalResults[finalResults.length - 1] = retry
          }
        }
      }

      return buildResult(params.tasks, finalResults, subagentCfg)
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      jsonSchema: ToolJsonSchema.fromSchema(
        Schema.Struct({
          tasks: Schema.Array(
            Schema.Struct({
              id: Schema.optional(Schema.String),
              description: Schema.String,
              prompt: Schema.String,
              subagent_type: Schema.String,
              depends_on: Schema.optional(Schema.Array(Schema.String)),
              model: Schema.optional(
                Schema.Struct({
                  providerID: Schema.String,
                  modelID: Schema.String,
                }),
              ),
              output: Schema.optional(
                Schema.Struct({
                  format: Schema.String,
                  schema: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
                  sections: Schema.optional(Schema.Array(Schema.String)),
                  max_length: Schema.optional(Schema.Number),
                }),
              ),
              on_failure: Schema.optional(Schema.String),
              timeout_ms: Schema.optional(Schema.Number),
              task_id: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
