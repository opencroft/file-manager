import type { TerminalSourceInfo } from './types'

/** One level of a terminal's place in the tree: its space, its graph or App, its node when that has several. */
export interface TerminalGroupStep {
  id: string
  name: string
  level: 'space' | 'app' | 'owner'
  /** The node an `owner` step stands for, for drawing it as the node it is. */
  ownerId?: string
  /** Open before the person has opened or closed it. */
  defaultOpen: boolean
}

/**
 * Each terminal's groups, outermost first: Space, then the graph its node is
 * on or the App offering it, then the node itself when it offers several
 * terminals (an Application's replicas). An App's terminals sit straight
 * under the App, which is the thing offering them. The App's own space
 * (`ownSpace`) opens on first sight, the person's other spaces stay closed
 * until opened, and a node's terminals are folded under it.
 */
export function terminalGroups(
  sources: readonly TerminalSourceInfo[],
  spaces: readonly { slug: string; name: string }[],
  ownSpace: string,
): Map<string, TerminalGroupStep[]> {
  const spaceNames = new Map(spaces.map((space) => [space.slug, space.name]))
  const perOwner = new Map<string, number>()
  for (const source of sources) {
    perOwner.set(source.owner.id, (perOwner.get(source.owner.id) ?? 0) + 1)
  }
  return new Map(
    sources.map((source) => {
      const steps: TerminalGroupStep[] = [
        {
          id: `space:${source.space}`,
          name: spaceNames.get(source.space) ?? source.space,
          level: 'space',
          defaultOpen: source.space === ownSpace,
        },
        {
          id: `app:${source.space}:${source.app.id}`,
          name: source.app.name,
          level: 'app',
          defaultOpen: true,
        },
      ]
      if (source.app.kind === 'graph' && (perOwner.get(source.owner.id) ?? 0) > 1) {
        steps.push({
          id: `owner:${source.owner.id}`,
          name: source.owner.name,
          level: 'owner',
          ownerId: source.owner.id,
          defaultOpen: false,
        })
      }
      return [source.ref, steps]
    }),
  )
}
