import { graph } from '@opencroft/server/graph'
import { type TerminalContext, terminal } from '@opencroft/server/terminal'

import { type ContainerProbe, type ContainerState, containerStates, PS_FORMAT } from './container-states'
import { terminalIndex } from './terminal-index'
import { sourceOf, type TerminalSourceInfo } from './terminal-source-info'

export type { TerminalSourceInfo }

// Core's types, qualified: the form graphs store and handles carry.
const TERMINAL_CONTEXT_HANDLE_TYPE = 'builtin.core.terminal-context'
// A router's outputs are terminals already on this list under their own name;
// offering them again would list each routed terminal once per router carrying it.
const TERMINAL_ROUTER_TYPE = 'builtin.core.terminal-router'

// Which space each terminal is in, for checking the refs callers name.
const known = terminalIndex(async () => await readTerminalSources())

/**
 * The terminals of the spaces in `spaces`: every terminal-context source
 * handle a node on one of their graphs declares, and every one an App
 * instance added to them exposes (a Git app's worktrees, say). A dynamic
 * handle is expanded to what its owner reports now: an Application's
 * replicas, running or not, the worktrees present.
 */
export async function listTerminalSources(spaces: ReadonlySet<string>): Promise<TerminalSourceInfo[]> {
  const sources = await readTerminalSources()
  known.remember(sources)
  return sources.filter((source) => spaces.has(source.space))
}

/** The space `ref` is a terminal of; rejects with NotATerminalError when no space lists it. */
export function terminalSpaceOf(ref: string): Promise<string> {
  return known.spaceOf(ref)
}

async function readTerminalSources(): Promise<TerminalSourceInfo[]> {
  const handles = await graph.listHandles({
    role: 'source',
    handleType: TERMINAL_CONTEXT_HANDLE_TYPE,
  })
  return handles.filter((handle) => handle.type !== TERMINAL_ROUTER_TYPE).map(sourceOf)
}

const TERM_PREFIX = 'term:'

// The Docker host a container's terminal reaches it through, as a key: the
// parent context's address and the docker context. Never sent anywhere; it
// only says which probes share one `docker ps`. It reads the first `via`
// level only: two Docker hosts behind different nested chains whose outer
// level is equal would share one `ps`, and one host's containers would show
// as not running.
function hostKey(ctx: TerminalContext): string {
  const via = ctx.via ?? { type: 'local' }
  return JSON.stringify([via.type, via.host, via.port, via.username, via.distro, ctx.contextName ?? ''])
}

/**
 * Whether each container terminal among `sources` is running, from one
 * `docker ps` per Docker host. A terminal whose context can't be resolved is
 * unreachable; terminals that are not containers are not asked about.
 */
export async function readContainerStates(
  sources: readonly TerminalSourceInfo[],
): Promise<Record<string, ContainerState>> {
  const states: Record<string, ContainerState> = {}
  const probes: ContainerProbe[] = []
  const parents = new Map<string, TerminalContext>()
  await Promise.all(
    sources
      .filter((source) => source.container)
      .map(async (source) => {
        const rest = source.ref.slice(TERM_PREFIX.length)
        const slash = rest.indexOf('/')
        try {
          const ctx = await terminal.getContext(rest.slice(0, slash), rest.slice(slash + 1))
          if (ctx.type !== 'docker-exec' || !ctx.containerId) {
            return
          }
          const host = hostKey(ctx)
          parents.set(host, ctx)
          probes.push({ ref: source.ref, host, containerId: ctx.containerId })
        } catch {
          states[source.ref] = 'unreachable'
        }
      }),
  )
  const answered = await containerStates(probes, async (host) => {
    const ctx = parents.get(host) as TerminalContext
    const contextArgs = ctx.contextName ? ['--context', ctx.contextName] : []
    const result = await terminal.runResult(
      ctx.via ?? { type: 'local' },
      ['docker', ...contextArgs, 'ps', '-a', '--format', PS_FORMAT],
      { timeoutMs: 10_000 },
    )
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `docker ps exited with ${result.exitCode}`)
    }
    return result.stdout
  })
  return { ...states, ...answered }
}
