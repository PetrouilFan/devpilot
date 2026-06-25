import { createMemo, For, Show } from "solid-js"
import { useRoute, useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { Locale } from "../../util/locale"

export function BatchProgress() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))

  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    return sync.data.session
      .filter((x) => x.parentID === s.id)
      .toSorted((a, b) => a.time.created - b.time.created)
  })

  const progress = createMemo(() => {
    const kids = children()
    if (kids.length === 0) return null

    let running = 0
    let completed = 0
    let errored = 0
    let cancelled = 0
    let queued = 0
    let blocked = 0

    function kidHasError(kid: typeof kids[number]) {
      const msgs = sync.data.message[kid.id]
      if (!msgs) return false
      return msgs.some((msg) => {
        const parts = sync.data.part[msg.id]
        if (!parts) return false
        return parts.some((p) => p.type === "tool" && p.state.status === "error")
      })
    }

    function kidIsAborted(kid: typeof kids[number]) {
      const msgs = sync.data.message[kid.id]
      return msgs?.some((msg) => msg.role === "assistant" && msg.error?.name === "MessageAbortedError") ?? false
    }

    function kidHasMessages(kid: typeof kids[number]) {
      const msgs = sync.data.message[kid.id]
      return msgs !== undefined && msgs.length > 0
    }

    for (const kid of kids) {
      if ((sync.data.permission[kid.id]?.length ?? 0) > 0) {
        blocked++
      }
      const status = sync.data.session_status[kid.id]
      if (!status) {
        if (kidHasMessages(kid)) {
          if (kidHasError(kid)) {
            errored++
          } else if (kidIsAborted(kid)) {
            cancelled++
          } else {
            completed++
          }
        } else {
          queued++
        }
        continue
      }
      switch (status.type) {
        case "busy":
          running++
          break
        case "idle": {
          if (kidHasError(kid)) {
            errored++
          } else if (kidIsAborted(kid)) {
            cancelled++
          } else {
            completed++
          }
          break
        }
        case "retry":
          running++
          break
      }
    }

    return { total: kids.length, running, completed, errored, cancelled, queued, blocked, kids }
  })

  const { theme } = useTheme()

  return (
    <Show when={progress()}>
      {(p) => (
        <box flexShrink={0}>
          <box
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={1}
            {...SplitBorder}
            border={["left"]}
            borderColor={theme.border}
            flexShrink={0}
            backgroundColor={theme.backgroundPanel}
          >
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>Batch</b>
                </text>
                <text fg={theme.textMuted}>
                  {p().completed}/{p().total} complete
                </text>
                <Show when={p().errored > 0}>
                  <text fg={theme.error}>
                    {p().errored} failed
                  </text>
                </Show>
                <Show when={p().running > 0}>
                  <text fg={theme.warning}>
                    {p().running} running
                  </text>
                </Show>
                <Show when={p().cancelled > 0}>
                  <text fg={theme.textMuted}>
                    {p().cancelled} cancelled
                  </text>
                </Show>
                <Show when={p().queued > 0}>
                  <text fg={theme.textMuted}>
                    {p().queued} pending
                  </text>
                </Show>
                <Show when={p().blocked > 0}>
                  <text fg={theme.warning}>
                    {p().blocked} pending permissions
                  </text>
                </Show>
              </box>
            </box>
            <box flexDirection="row" gap={1} marginTop={0} flexWrap="wrap">
              <For each={p().kids}>
                {(kid) => {
                  const s = createMemo(() => sync.data.session_status[kid.id])
                  const msgs = createMemo(() => sync.data.message[kid.id] ?? [])
                  const hasMessages = createMemo(() => msgs().length > 0)

                  const agent = createMemo(() => {
                    const match = kid.title?.match(/@(\w+) subagent/)
                    return match ? Locale.titlecase(match[1]) : undefined
                  })
                  const description = createMemo(() => {
                    return (kid.title ?? "").replace(/ @\w+ subagent$/, "").slice(0, 28)
                  })
                  const label = createMemo(() => {
                    return agent() ? `${agent()} ${description()}` : description()
                  })

                  const failed = createMemo(() => {
                    const status = s()
                    if (status && status.type !== "idle") return false
                    if (!hasMessages()) return false
                    return msgs().some((msg) => {
                      const parts = sync.data.part[msg.id]
                      if (!parts) return false
                      return parts.some((p) => p.type === "tool" && p.state.status === "error")
                    })
                  })
                  const aborted = createMemo(() => {
                    const status = s()
                    if (status && status.type !== "idle") return false
                    if (!hasMessages()) return false
                    return msgs().some((msg) => msg.role === "assistant" && msg.error?.name === "MessageAbortedError")
                  })

                  const statusLabel = createMemo(() => {
                    const status = s()
                    if (status?.type === "busy" || status?.type === "retry") return "running"
                    if (failed()) return "failed"
                    if (aborted()) return "cancelled"
                    if (status?.type === "idle" || hasMessages()) return "done"
                    return "pending"
                  })
                  const statusColor = createMemo(() => {
                    if (failed()) return theme.error
                    const status = s()
                    if (status?.type === "busy" || status?.type === "retry") return theme.warning
                    if (aborted()) return theme.textMuted
                    if (status?.type === "idle" || hasMessages()) return theme.success
                    return theme.textMuted
                  })
                  return (
                    <box onMouseUp={() => navigate({ type: "session", sessionID: kid.id })}>
                      <text fg={theme.textMuted}>
                        {label()}: <span style={{ fg: statusColor() }}>{statusLabel()}</span>
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </box>
        </box>
      )}
    </Show>
  )
}
