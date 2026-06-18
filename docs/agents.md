# Agents

DevPilot uses agents to handle different types of work. Each agent has a defined set of permissions, a system prompt, and an operational mode.

## Built-in Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **build** | primary | Default agent. Full tool access with configured permissions. |
| **plan** | primary | Read-only analysis agent. Denies file edits; asks before running bash. Ideal for exploration and planning. |
| **general** | subagent | General-purpose agent for complex searches and multi-step tasks. Invoked via `@general` or the task tool. |
| **explore** | subagent | Read-only codebase search specialist. Uses Glob, Grep, Read, and Bash. Supports thoroughness levels: quick, medium, very thorough. |
| **orchestrator** | subagent | Decomposes complex tasks into parallel subtasks and synthesizes results. Uses the task tool to launch specialist agents. |
| compaction | primary | (Hidden) Summarizes conversation history for context management. |
| title | primary | (Hidden) Generates brief session titles. |
| summary | primary | (Hidden) Generates PR-description-style summaries. |

## Agent Modes

- **primary** — User-facing agents. Switchable with the `Tab` key in the TUI. Visible in the agent selector.
- **subagent** — Invoked programmatically via the task tool or `@agent` mentions. Not directly selectable by the user.
- **all** — Available both as a primary agent and as a subagent.

## Custom Agents

Define custom agents in `devpilot.json` under the `agents` key, or create markdown files at `.devpilot/agent/<name>.md`.

### Inline definition

```jsonc
// devpilot.json
{
  "agents": {
    "my-agent": {
      "description": "Custom agent for project-specific tasks",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "system": "You are a specialized agent for this project...",
      "permission": {
        "task": { "*": "allow" },
        "edit": { "*.test.ts": "allow", "*": "deny" }
      }
    }
  }
}
```

### Markdown file definition

Create `.devpilot/agent/my-agent.md` with optional frontmatter:

```markdown
---
description: Custom agent for project-specific tasks
mode: subagent
model: anthropic/claude-sonnet-4-20250514
---

You are a specialized agent for this project.

When asked to make changes, always:
1. Read the relevant files first
2. Write tests before implementation
3. Run the test suite to verify
```

## Permissions

Permissions control what tools each agent can use. Rules are evaluated in order; the last matching rule wins.

### Actions

- **allow** — Tool executes without asking the user.
- **ask** — Tool prompts the user for confirmation before executing.
- **deny** — Tool is blocked entirely.

### Pattern matching

Permissions support wildcard patterns:

```jsonc
{
  "permission": {
    "edit": { "*.ts": "allow", "*.test.ts": "deny", "*": "ask" },
    "bash": { "npm test": "allow", "*": "ask" },
    "task": { "*": "allow" }
  }
}
```

### Per-agent tool deny

The task tool is denied by default for subagents unless the agent explicitly permits it. The `todowrite` tool is also denied by default for subagents.

## Orchestrator Agent

The orchestrator is a specialized subagent that decomposes complex tasks into parallel subtasks using the task tool, then synthesizes results.

### Trigger modes

Configure in `devpilot.json` under `subagents`:

```jsonc
{
  "subagents": {
    "orchestrator": "orchestrator",           // agent name
    "orchestrator_trigger": "auto"            // "auto" or "manual"
  }
}
```

- **auto** — The system automatically injects an orchestrator hint when a batch task is launched and an orchestrator is configured.
- **manual** — The orchestrator is only invoked when explicitly referenced (e.g., `@orchestrator`).

### Decision framework

The orchestrator follows these rules:

1. If the task can be done by a single subagent, do it directly — don't over-decompose.
2. If there are 3+ independent subtasks, parallelize them in a single task tool call.
3. If subtasks depend on each other, sequence them (launch A first, wait for result, then launch B).
4. If subtasks need different expertise, use specialist agents (`explore` for read-only, `general` for write).

### Synthesis

After all subtasks complete, the orchestrator:

- Cross-references findings across tasks
- Produces a coherent, complete answer
- Sources which subagent provided what
- Highlights conflicts or discrepancies between task results

### Permissions

The orchestrator has `task: { "*": "allow" }` — it can invoke any agent via the task tool. It has `todowrite: "deny"` by default.

## Subagent Permissions

When a subagent session is created, permissions are derived from the parent session:

1. The parent's `deny` rules and `external_directory` rules are inherited.
2. `todowrite` and `task` are denied by default unless the subagent explicitly permits them.
3. Agent-specific permission rules from the agent definition are merged on top.

This ensures subagents cannot escalate privileges beyond what the parent session and agent definition allow.

## Filesystem Isolation

Subagent sessions can be isolated from the parent's working directory. Configure in `devpilot.json`:

```jsonc
{
  "subagents": {
    "isolation": "worktree"  // "worktree" | "scope" | "none"
  }
}
```

- **none** — Subagent runs in the parent's working directory (default).
- **scope** — Subagent runs in `.opencode/scopes/<taskID>/`. A temporary directory is created and cleaned up after completion.
- **worktree** — Subagent runs in a git worktree at `.opencode/worktrees/<taskID>/`. Provides full git isolation on a separate branch (`subagent/<taskID>`).

When isolation is enabled, file-access tools (`edit`, `write`, `read`, `shell`) reject paths outside the isolation directory.

## Concurrency

Control how many subagents can run simultaneously:

```jsonc
{
  "subagents": {
    "max_concurrency": 5    // default: 5
  }
}
```

A semaphore-based limiter queues excess tasks until a slot opens.

## Configuration Reference

Full `subagents` config block in `devpilot.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | — | Default model for all subagents (e.g., `"anthropic/claude-haiku-3.5"`) |
| `max_concurrency` | integer | 5 | Maximum concurrent subagent sessions |
| `isolation` | string | `"none"` | Filesystem isolation mode: `"worktree"`, `"scope"`, or `"none"` |
| `timeout_ms` | integer | — | Maximum runtime in milliseconds before timeout |
| `orchestrator` | string | — | Agent name to use as orchestrator (e.g., `"orchestrator"`) |
| `orchestrator_trigger` | string | `"auto"` | How orchestrator is invoked: `"auto"` or `"manual"` |
