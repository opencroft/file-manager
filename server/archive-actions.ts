import type { AppActionContext } from '@opencroft/server/apps'

import type { ArchiveRun } from './routes'
import { NotATerminalError } from './terminal-index'
import type { Provider } from './types'

// Host-free, so it can be tested on its own: the host's lookups are passed in.

/** What an App action needs from the host to reach a source. */
export interface ArchiveActionHost {
  /** The space a terminal ref is in; rejects with NotATerminalError when no space lists it. */
  terminalSpaceOf: (ref: string) => Promise<string>
  /** The provider for `ref` in `spaceSlug`, as a person's call (`byPerson`) or an agent's gets it. */
  providerFor: (spaceSlug: string, ref: string, byPerson: boolean) => Promise<Provider>
}

export type ArchiveActionContext = Pick<AppActionContext, 'spaceSlug' | 'callerPerson' | 'signal'>

// An agent names a terminal as it does everywhere else, `<nodeId>/<handleId>`;
// the refs the App's UI uses (`term:…`, `conn:…`) are taken as they are.
function sourceRef(source: unknown): string {
  if (typeof source !== 'string' || !source) {
    throw new Error('"source" is required: a terminal as <nodeId>/<handleId>')
  }
  return source.startsWith('term:') || source.startsWith('conn:') ? source : `term:${source}`
}

// Agents call these; a person reaches the same runs through the routes. A
// call with neither caller set is an agent's from a surface that cannot name
// it, so only a person's call skips the agents' refusal. An App action reaches
// the terminals of the App's own space only: the routes, which know the
// person, are what reach the person's other spaces.
export function archiveAction(host: ArchiveActionHost, run: ArchiveRun) {
  return async (ctx: ArchiveActionContext, params: Record<string, unknown>) => {
    const ref = sourceRef(params.source)
    if (ref.startsWith('term:') && (await host.terminalSpaceOf(ref)) !== ctx.spaceSlug) {
      throw new NotATerminalError(`Source "${ref}" is not a terminal of space "${ctx.spaceSlug}"`)
    }
    const provider = await host.providerFor(ctx.spaceSlug, ref, Boolean(ctx.callerPerson))
    return run(provider, params, { signal: ctx.signal })
  }
}
