export * as ConfigToolOutput from "./tool-output"

import { Schema } from "effect"
import { PositiveInt, NonNegativeInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.ToolOutput")({
  max_lines: PositiveInt.pipe(Schema.optional),
  max_bytes: PositiveInt.pipe(Schema.optional),
  // Tool output externalization thresholds.
  // When output exceeds externalize_min_chars, the full content is written to
  // a file and replaced with a head+tail preview + file reference. The model
  // can read the full output via read_file.
  // Set externalize_min_chars to 0 to disable externalization.
  externalize_min_chars: PositiveInt.pipe(Schema.optional).annotate({
    description: "Minimum characters before tool output is externalized to file (default: 12000)",
  }),
  // Head preview length in characters (default: 2000).
  preview_head_chars: PositiveInt.pipe(Schema.optional),
  // Tail preview length in characters (default: 1000).
  preview_tail_chars: PositiveInt.pipe(Schema.optional),
  // Tools exempt from externalization to avoid persist-read-persist loops.
  exempt_tools: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Tool names exempt from output externalization (default: [read_file])",
  }),
}) {}
