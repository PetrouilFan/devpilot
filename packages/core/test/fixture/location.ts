import { Location } from "@devpilot-ai/core/location"
import { Project } from "@devpilot-ai/core/project"
import { AbsolutePath } from "@devpilot-ai/core/schema"

export function location(ref: Location.Ref, input: { projectDirectory?: AbsolutePath; vcs?: Project.Vcs } = {}) {
  return {
    directory: ref.directory,
    workspaceID: ref.workspaceID,
    project: { id: Project.ID.global, directory: input.projectDirectory ?? ref.directory },
    vcs: input.vcs,
  } satisfies Location.Interface
}
