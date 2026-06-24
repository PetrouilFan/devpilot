import { LayerNode } from "@devpilot-ai/core/effect/layer-node"
import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Option, Schedule, Context } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { FSUtil } from "@devpilot-ai/core/fs-util"
import { evaluate } from "@/permission/evaluate"
import { Config } from "@/config/config"
import { Identifier } from "../id/id"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"

const RETENTION = Duration.days(7)

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = TRUNCATION_DIR
export const GLOB = path.join(TRUNCATION_DIR, "*")

// Tool output externalization defaults
const EXTERNALIZE_MIN_CHARS = 12_000
const PREVIEW_HEAD_CHARS = 2_000
const PREVIEW_TAIL_CHARS = 1_000
const EXEMPT_TOOLS = ["read_file", "read_file_tool"]

export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

export interface Options {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
}

function hasTaskTool(agent?: Agent.Info) {
  if (!agent?.permission) return false
  return evaluate("task", "*", agent.permission).action !== "deny"
}

export interface Interface {
  readonly cleanup: () => Effect.Effect<void>
  readonly write: (text: string) => Effect.Effect<string>
  /**
   * Returns output unchanged when it fits within the limits, otherwise writes the full text
   * to the truncation directory and returns a preview plus a hint to inspect the saved file.
   */
  readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  /**
   * Resolved truncation limits: values from `tool_output` in opencode config, or MAX_LINES / MAX_BYTES if unset.
   */
  readonly limits: () => Effect.Effect<{ maxLines: number; maxBytes: number }>
  /**
   * Returns true if the specified tool name is exempt from output externalization.
   * Exempt tools avoid persist-read-persist loops.
   */
  readonly isExempt: (toolName: string) => Effect.Effect<boolean>
  /**
   * Externalization config: thresholds from tool_output config or defaults if unset.
   */
  readonly externalizeConfig: () => Effect.Effect<{
    minChars: number
    headChars: number
    tailChars: number
    exemptTools: string[]
  }>
}

export class Service extends Context.Service<Service, Interface>()("@devpilot/Truncate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const cleanup = Effect.fn("Truncate.cleanup")(function* () {
      const cutoff = Identifier.timestamp(
        Identifier.create("tool", "ascending", Date.now() - Duration.toMillis(RETENTION)),
      )
      const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
        Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
        Effect.catch(() => Effect.succeed([])),
      )
      for (const entry of entries) {
        if (Identifier.timestamp(entry) >= cutoff) continue
        yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
      }
    })

    const write = Effect.fn("Truncate.write")(function* (text: string) {
      const file = path.join(TRUNCATION_DIR, ToolID.ascending())
      yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)
      return file
    })

    const limits = Effect.fn("Truncate.limits")(function* () {
      const configSvc = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(configSvc)) return { maxLines: MAX_LINES, maxBytes: MAX_BYTES }
      const cfg = yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      return {
        maxLines: cfg?.tool_output?.max_lines ?? MAX_LINES,
        maxBytes: cfg?.tool_output?.max_bytes ?? MAX_BYTES,
      }
    })

    const externalizeConfig = Effect.fn("Truncate.externalizeConfig")(function* () {
      const configSvc = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(configSvc)) {
        return { minChars: EXTERNALIZE_MIN_CHARS, headChars: PREVIEW_HEAD_CHARS, tailChars: PREVIEW_TAIL_CHARS, exemptTools: EXEMPT_TOOLS }
      }
      const cfg = yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      return {
        minChars: cfg?.tool_output?.externalize_min_chars ?? EXTERNALIZE_MIN_CHARS,
        headChars: cfg?.tool_output?.preview_head_chars ?? PREVIEW_HEAD_CHARS,
        tailChars: cfg?.tool_output?.preview_tail_chars ?? PREVIEW_TAIL_CHARS,
        exemptTools: cfg?.tool_output?.exempt_tools ?? EXEMPT_TOOLS,
      }
    })

    const isExempt = Effect.fn("Truncate.isExempt")(function* (toolName: string) {
      const ext = yield* externalizeConfig()
      return ext.exemptTools.includes(toolName)
    })

    const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
      const resolved = yield* limits()
      const maxLines = options.maxLines ?? resolved.maxLines
      const maxBytes = options.maxBytes ?? resolved.maxBytes
      const direction = options.direction ?? "head"
      const lines = text.split("\n")
      const totalBytes = Buffer.byteLength(text, "utf-8")
      const totalChars = text.length

      if (lines.length <= maxLines && totalBytes <= maxBytes) {
        return { content: text, truncated: false } as const
      }

      // Use head+tail externalization pattern for large outputs
      const extCfg = yield* externalizeConfig()
      if (extCfg.minChars > 0 && totalChars >= extCfg.minChars) {
        const file = yield* write(text)
        const headPreview = text.slice(0, extCfg.headChars)
        const tailPreview = text.slice(-extCfg.tailChars)
        const removed = totalChars - extCfg.headChars - extCfg.tailChars

        const hint = hasTaskTool(agent)
          ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
          : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

        return {
          content: [
            headPreview,
            `\n...${removed} characters truncated...\n`,
            tailPreview,
            `\n${hint}`,
          ].join(""),
          truncated: true,
          outputPath: file,
        } as const
      }

      const out: string[] = []
      let i = 0
      let bytes = 0
      let hitBytes = false

      if (direction === "head") {
        for (i = 0; i < lines.length && i < maxLines; i++) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.push(lines[i])
          bytes += size
        }
      } else {
        for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.unshift(lines[i])
          bytes += size
        }
      }

      const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
      const unit = hitBytes ? "bytes" : "lines"
      const preview = out.join("\n")
      const file = yield* write(text)

      const hint = hasTaskTool(agent)
        ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
        : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

      return {
        content:
          direction === "head"
            ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
            : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
        truncated: true,
        outputPath: file,
      } as const
    })

    yield* cleanup().pipe(
      Effect.catchCause((cause) => Effect.logError("truncation cleanup failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.delay(Duration.minutes(1)),
      Effect.forkScoped,
    )

    return Service.of({ cleanup, write, output, limits, isExempt, externalizeConfig })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(NodePath.layer))

export const node = LayerNode.make(layer, [FSUtil.node])

export * as Truncate from "./truncate"
