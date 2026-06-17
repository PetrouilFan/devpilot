import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["DEVPILOT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["DEVPILOT_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("DEVPILOT_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  DEVPILOT_AUTO_HEAP_SNAPSHOT: truthy("DEVPILOT_AUTO_HEAP_SNAPSHOT"),
  DEVPILOT_GIT_BASH_PATH: process.env["DEVPILOT_GIT_BASH_PATH"],
  DEVPILOT_CONFIG: process.env["DEVPILOT_CONFIG"],
  DEVPILOT_CONFIG_CONTENT: process.env["DEVPILOT_CONFIG_CONTENT"],
  DEVPILOT_DISABLE_AUTOUPDATE: truthy("DEVPILOT_DISABLE_AUTOUPDATE"),
  DEVPILOT_ALWAYS_NOTIFY_UPDATE: truthy("DEVPILOT_ALWAYS_NOTIFY_UPDATE"),
  DEVPILOT_DISABLE_PRUNE: truthy("DEVPILOT_DISABLE_PRUNE"),
  DEVPILOT_DISABLE_TERMINAL_TITLE: truthy("DEVPILOT_DISABLE_TERMINAL_TITLE"),
  DEVPILOT_SHOW_TTFD: truthy("DEVPILOT_SHOW_TTFD"),
  DEVPILOT_DISABLE_AUTOCOMPACT: truthy("DEVPILOT_DISABLE_AUTOCOMPACT"),
  DEVPILOT_DISABLE_MODELS_FETCH: truthy("DEVPILOT_DISABLE_MODELS_FETCH"),
  DEVPILOT_DISABLE_MOUSE: truthy("DEVPILOT_DISABLE_MOUSE"),
  DEVPILOT_FAKE_VCS: process.env["DEVPILOT_FAKE_VCS"],
  DEVPILOT_SERVER_PASSWORD: process.env["DEVPILOT_SERVER_PASSWORD"],
  DEVPILOT_SERVER_USERNAME: process.env["DEVPILOT_SERVER_USERNAME"],
  DEVPILOT_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("DEVPILOT_DISABLE_FFF"),

  // Experimental
  DEVPILOT_EXPERIMENTAL_FILEWATCHER: Config.boolean("DEVPILOT_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  DEVPILOT_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("DEVPILOT_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  DEVPILOT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("DEVPILOT_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  DEVPILOT_MODELS_URL: process.env["DEVPILOT_MODELS_URL"],
  DEVPILOT_MODELS_PATH: process.env["DEVPILOT_MODELS_PATH"],
  DEVPILOT_DB: process.env["DEVPILOT_DB"],

  DEVPILOT_WORKSPACE_ID: process.env["DEVPILOT_WORKSPACE_ID"],
  DEVPILOT_EXPERIMENTAL_WORKSPACES: enabledByExperimental("DEVPILOT_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get DEVPILOT_DISABLE_PROJECT_CONFIG() {
    return truthy("DEVPILOT_DISABLE_PROJECT_CONFIG")
  },
  get DEVPILOT_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("DEVPILOT_EXPERIMENTAL_REFERENCES")
  },
  get DEVPILOT_TUI_CONFIG() {
    return process.env["DEVPILOT_TUI_CONFIG"]
  },
  get DEVPILOT_CONFIG_DIR() {
    return process.env["DEVPILOT_CONFIG_DIR"]
  },
  get DEVPILOT_PURE() {
    return truthy("DEVPILOT_PURE")
  },
  get DEVPILOT_PERMISSION() {
    return process.env["DEVPILOT_PERMISSION"]
  },
  get DEVPILOT_PLUGIN_META_FILE() {
    return process.env["DEVPILOT_PLUGIN_META_FILE"]
  },
  get DEVPILOT_CLIENT() {
    return process.env["DEVPILOT_CLIENT"] ?? "cli"
  },
}
