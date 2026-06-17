import { run as runTui, type TuiInput } from "@devpilot-ai/tui"
import { Global } from "@devpilot-ai/core/global"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(Global.defaultLayer))
}
