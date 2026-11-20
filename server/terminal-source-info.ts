// Host-free, so it can be tested on its own: only the host's types are imported.
import type { HandleInfo } from '@opencroft/server/graph'

export interface TerminalSourceInfo {
  /** `term:<nodeId>/<handleId>` — the source ref every action and route takes. */
  ref: string
  /** The node, qualified by what distinguishes this handle on it. */
  title: string
  /** The space the terminal is in. */
  space: string
  /** Where it comes from in that space: the graph its node is on, or the App instance offering it. */
  app: { id: string; name: string; kind: 'graph' | 'app' }
  /** The node or App instance offering it. */
  owner: { id: string; name: string }
  /** An Application's replica: a container, which may not be running. */
  container: boolean
}

const APP_TYPE_PREFIX = 'app:'

// The host's one name for the terminal, the one its TerminalSelector and
// TerminalRef show, so a terminal reads the same here as everywhere else. A
// host older than `HandleInfo.title` gives none; its owner's name stands in.
function titleOf(handle: HandleInfo): string {
  return handle.title ?? handle.nodeName
}

function appOf(handle: HandleInfo): TerminalSourceInfo['app'] {
  if (handle.type.startsWith(APP_TYPE_PREFIX)) {
    return { id: handle.address ?? handle.nodeId, name: handle.nodeName, kind: 'app' }
  }
  // A host that names no graph (a core older than `HandleInfo.graph`) puts
  // every node of the space under one row rather than none.
  return {
    id: handle.graph?.address ?? `${handle.spaceSlug}.`,
    name: handle.graph?.name ?? 'Graph',
    kind: 'graph',
  }
}

/**
 * A terminal-context source handle as the sidebar lists it. Terminal
 * Routers' handles are left out before this: they repeat terminals listed
 * under their own nodes.
 */
export function sourceOf(handle: HandleInfo): TerminalSourceInfo {
  return {
    ref: `term:${handle.nodeId}/${handle.handleId}`,
    title: titleOf(handle),
    space: handle.spaceSlug,
    app: appOf(handle),
    owner: { id: handle.nodeId, name: handle.nodeName },
    // A node's dynamic terminals are an Application's replicas, routers (the
    // other node with dynamic terminals) being left out; an App's dynamic
    // terminals (a Git app's worktrees) are not containers.
    container: handle.dynamic && !handle.type.startsWith(APP_TYPE_PREFIX),
  }
}
