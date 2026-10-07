import host from '@ext/host'

export interface TerminalSourceInfo {
  /** `term:<nodeId>/<handleId>` — the source ref every action and route takes. */
  ref: string
  /** The node, qualified by what distinguishes this handle on it. */
  title: string
}

// The parts of the host's graph.listHandles this reads. @opencroft/server's
// HostGraphApi does not declare it, so nothing checks these against the host.
interface HandleInfo {
  nodeId: string
  spaceSlug: string
  /** The node's stored, qualified type. */
  type: string
  nodeName: string
  handleId: string
  /** The manifest id — the prefix form for a dynamic handle. */
  declaredId: string
  label?: string
  dynamic: boolean
}

interface GraphApiWithListHandles {
  listHandles: (filter?: { role?: 'source' | 'target'; handleType?: string }) => Promise<HandleInfo[]>
}

// Core's types, qualified: the form graphs store and handles carry.
const TERMINAL_CONTEXT_HANDLE_TYPE = 'builtin.core.terminal-context'
// A router's outputs are terminals already on this list under their own name;
// offering them again would list each routed terminal once per router carrying it.
const TERMINAL_ROUTER_TYPE = 'builtin.core.terminal-router'

// The same title the host's TerminalSelector gives a terminal, so a terminal
// reads the same here as everywhere else it can be picked. A dynamic handle's
// declared id is a prefix, and the expanded remainder (a container name) is
// what tells its siblings apart; a static handle is told apart by its label.
function titleOf(handle: HandleInfo): string {
  const detail = handle.dynamic ? handle.handleId.slice(handle.declaredId.length) : handle.label
  return detail ? `${handle.nodeName} · ${detail}` : handle.nodeName
}

/**
 * The terminals of `space`: every terminal-context source handle a node on one
 * of its graphs declares, and every one an App instance added to it exposes (a
 * Git app's worktrees, say). A dynamic handle is expanded to what is live now —
 * the containers running, the worktrees present — so a stopped one is not listed.
 */
export async function listTerminalSources(space: string): Promise<TerminalSourceInfo[]> {
  const handles = await (host.graph as unknown as GraphApiWithListHandles).listHandles({
    role: 'source',
    handleType: TERMINAL_CONTEXT_HANDLE_TYPE,
  })
  return handles
    .filter((handle) => handle.spaceSlug === space)
    .filter((handle) => handle.type !== TERMINAL_ROUTER_TYPE)
    .map((handle) => ({ ref: `term:${handle.nodeId}/${handle.handleId}`, title: titleOf(handle) }))
}
