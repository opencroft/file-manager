import { graph, type HandleInfo } from '@opencroft/server/graph'

import { spaceTerminals } from './space-terminals'

export interface TerminalSourceInfo {
  /** `term:<nodeId>/<handleId>` — the source ref every action and route takes. */
  ref: string
  /** The node, qualified by what distinguishes this handle on it. */
  title: string
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

// What each space lists, for checking the refs callers name.
const known = spaceTerminals(async (space) => (await readTerminalSources(space)).map((source) => source.ref))

/**
 * The terminals of `space`: every terminal-context source handle a node on one
 * of its graphs declares, and every one an App instance added to it exposes (a
 * Git app's worktrees, say). A dynamic handle is expanded to what is live now —
 * the containers running, the worktrees present — so a stopped one is not listed.
 */
export async function listTerminalSources(space: string): Promise<TerminalSourceInfo[]> {
  const sources = await readTerminalSources(space)
  known.remember(
    space,
    sources.map((source) => source.ref),
  )
  return sources
}

/**
 * Resolves when `ref` is a terminal `space` lists (`listTerminalSources`), and
 * rejects with NotInSpaceError when it is not: a space reaches its own
 * terminals and no others, however the ref was learnt.
 */
export function requireTerminalInSpace(space: string, ref: string): Promise<void> {
  return known.require(space, ref)
}

async function readTerminalSources(space: string): Promise<TerminalSourceInfo[]> {
  const handles = await graph.listHandles({
    role: 'source',
    handleType: TERMINAL_CONTEXT_HANDLE_TYPE,
  })
  return handles
    .filter((handle) => handle.spaceSlug === space)
    .filter((handle) => handle.type !== TERMINAL_ROUTER_TYPE)
    .map((handle) => ({ ref: `term:${handle.nodeId}/${handle.handleId}`, title: titleOf(handle) }))
}
