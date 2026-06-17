import { Schema } from "effect"
import { PositiveInt } from "@devpilot-ai/core/schema"

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema(description: string) {
  return Schema.Struct({
    action: Schema.optional(Schema.Literals(["run", "status"])).annotate({
      description: "Action to perform. 'run' (default) starts a new background command. 'status' checks an existing job.",
    }),
    command: Schema.optional(Schema.String).annotate({
      description: "The command to execute in the background (required for action='run')",
    }),
    description: Schema.optional(Schema.String).annotate({
      description: "Clear, concise description of what this command does in 5-10 words (required for action='run')",
    }),
    job_id: Schema.optional(Schema.String).annotate({
      description: "The job ID returned by a previous background run (required for action='status')",
    }),
    workdir: Schema.optional(Schema.String).annotate({
      description: "The working directory to run the command in. Defaults to the current directory.",
    }),
    timeout: Schema.optional(PositiveInt).annotate({
      description: "Optional timeout in milliseconds. Default: 10 minutes (600000ms). Commands running longer than this will be killed.",
    }),
    mode: Schema.optional(Schema.Literals(["stream", "wait"])).annotate({
      description:
        "Output mode. 'stream' (default) streams output in real-time. 'wait' returns only the final output when the command finishes.",
    }),
  })
}

export const Parameters = parameterSchema("")
export type Parameters = Schema.Schema.Type<typeof Parameters>

export function render(limits: Limits, defaultTimeoutMs: number) {
  return {
    description: `Run a shell command in the background while you continue working. You will be notified when it finishes.

Use this for long-running commands (builds, deployments, tests, downloads, etc.) that would block the normal bash tool.

When to use:
- Commands expected to take more than 30 seconds
- Tasks that can run independently while you work on other things
- Build/deploy/test pipelines
- File downloads or processing

When NOT to use:
- Quick commands that finish in seconds (use the bash tool instead)
- Commands that need interactive input
- Commands whose output you need immediately to continue

The command runs as a detached background process. You can continue using other tools while it runs.
When the command completes, you will receive a notification with the exit code and output.

In "stream" mode, output is streamed to the session in real-time as it arrives.
In "wait" mode, only the final output is returned when the command completes.

To check the status of a running command, use action='status' with the job_id from a previous run.`,
    parameters: parameterSchema(
      `Run a shell command in the background. Returns immediately with a job ID. You will be notified when it finishes. Timeout: ${defaultTimeoutMs}ms.`,
    ),
  }
}

export * as BackgroundPrompt from "./prompt"
