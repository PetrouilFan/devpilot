# opencode

The core runtime for DevPilot's AI coding agent.

## Installation

```bash
bun install
```

## Agents

Built-in agents available to the task tool:

| Agent | Mode | Description |
|-------|------|-------------|
| **build** | primary | Default agent. Full tool access. |
| **plan** | primary | Read-only analysis. Denies file edits. |
| **general** | subagent | General-purpose multi-step tasks. |
| **explore** | subagent | Read-only codebase search specialist. |
| **orchestrator** | subagent | Task decomposition and result synthesis. |

Custom agents can be defined in `devpilot.json` under `agents` or via `.devpilot/agent/<name>.md` files.

## Task Tool

The task tool accepts a batch of tasks and executes them as separate subagent sessions. Independent tasks run in parallel.

### Schema

Each task in the `tasks` array accepts the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | no | Unique identifier for dependency references |
| `description` | string | yes | Short (3-5 words) summary of the task |
| `prompt` | string | yes | Detailed instructions for the subagent |
| `subagent_type` | string | yes | Agent type to use (e.g., `general`, `explore`) |
| `depends_on` | string[] | no | Task IDs that must complete before this task starts |
| `model` | object | no | Override the model: `{ providerID, modelID }` |
| `output` | object | no | Output contract (see below) |
| `on_failure` | string | no | Failure handling: `"fail-fast"`, `"continue"`, or `"retry"` |
| `timeout_ms` | integer | no | Maximum runtime in milliseconds |
| `task_id` | string | no | Resume a previous task session by ID |

### Output Contracts

The `output` field specifies what the subagent should return:

| Field | Type | Description |
|-------|------|-------------|
| `format` | `"text"` \| `"structured"` \| `"list"` | Expected output format |
| `schema` | object | JSON schema for structured output |
| `sections` | string[] | Required sections (e.g., `["files", "summary", "issues"]`) |
| `max_length` | integer | Maximum output length in characters |

### DAG Execution

Tasks with `depends_on` fields are executed as a directed acyclic graph:

1. Tasks with no dependencies execute first (in parallel).
2. Once a layer completes, tasks whose dependencies are satisfied execute next.
3. Circular dependencies are detected and rejected with an error.

Independent tasks (no `depends_on`) all execute in parallel in a single batch.

### Failure Handling

The `on_failure` field controls behavior when a task fails:

- **`"continue"`** (default) — Other tasks continue executing. The failed task's result includes an error.
- **`"fail-fast"`** — All remaining tasks in the batch are skipped. Already-running tasks are not cancelled.
- **`"retry"`** — The failed task is re-run once. If it fails again, it is reported as an error.

## Orchestrator Agent

The orchestrator agent decomposes complex tasks into parallel subtasks using the task tool, then synthesizes results.

Configure in `devpilot.json`:

```jsonc
{
  "subagents": {
    "orchestrator": "orchestrator",
    "orchestrator_trigger": "auto"
  }
}
```

- **auto** — System injects an orchestrator hint when a batch task is launched.
- **manual** — Only invoked via explicit `@orchestrator` reference.

The orchestrator's decision framework:
1. Single subagent sufficient → do it directly.
2. 3+ independent subtasks → parallelize in one task call.
3. Dependent subtasks → sequence them.
4. Different expertise needed → use specialist agents.

## Filesystem Isolation

Subagent sessions can be isolated from the parent's working directory.

| Mode | Behavior |
|------|----------|
| `none` | Runs in the parent's working directory (default) |
| `scope` | Runs in `.opencode/scopes/<taskID>/` (temporary directory) |
| `worktree` | Runs in a git worktree at `.opencode/worktrees/<taskID>/` on branch `subagent/<taskID>` |

When isolation is enabled, file-access tools (`edit`, `write`, `read`, `shell`) reject paths outside the isolation directory.

Isolation metadata is stored in the child session's metadata and enforced at the tool boundary in `tools.ts`.

## Concurrency

Maximum concurrent subagent sessions is controlled by `max_concurrency` in the `subagents` config (default: 5). A semaphore-based limiter queues excess tasks until a slot opens.

Implementation: `src/subagent/concurrency.ts`.

## Configuration Reference

Full `subagents` config block in `devpilot.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | — | Default model for all subagents |
| `max_concurrency` | integer | 5 | Maximum concurrent subagent sessions |
| `isolation` | string | `"none"` | Filesystem isolation: `"worktree"`, `"scope"`, `"none"` |
| `timeout_ms` | integer | — | Maximum runtime before timeout |
| `orchestrator` | string | — | Agent name for orchestrator |
| `orchestrator_trigger` | string | `"auto"` | Invocation mode: `"auto"` or `"manual"` |

Schema: `packages/core/src/config/subagents.ts`

## Development

```bash
bun dev          # Start the live TUI (run in tmux)
bun typecheck    # Type-check all source files
bun test         # Run the test suite
```

## Project Structure

```
src/
  agent/           # Agent definitions and prompts
  cli/             # CLI entrypoints
  config/          # Configuration loading and types
  effect/          # Effect runtime utilities
  session/         # Session management, prompt loop, tools
  subagent/        # Concurrency limiter, filesystem isolation
  tool/            # Tool definitions (task, bash, read, write, edit, ...)
  tui/             # Terminal UI components (via packages/tui)
```
