import type { ContainerState } from './container-states'
import { bySpace, spaceOrder } from './space-order'
import { getAllSourceSettings, listConnections, type SourceSettings } from './storage'
import { listTerminalSources, readContainerStates, type TerminalSourceInfo } from './terminal-sources'
import type { ProtocolConnection } from './types'

export interface ListSourcesResult {
  connections: ProtocolConnection[]
  /** The terminals of every space the person sees, the App's own space's first. */
  terminalSources: TerminalSourceInfo[]
  sourceSettings: Record<string, SourceSettings>
  /** Those spaces' names, in the same order. */
  spaces: { slug: string; name: string }[]
}

/**
 * What the sidebar lists for a person in the App added to `space`: that
 * space's S3/FTP connections and root paths, and the terminals of every space
 * in `visible`, the spaces the person sees.
 */
export async function listSources(
  space: string,
  visible: readonly { slug: string; name: string }[],
): Promise<ListSourcesResult> {
  const order = spaceOrder(space, visible)
  const [connections, terminals, sourceSettings] = await Promise.all([
    listConnections(space),
    listTerminalSources(new Set(order)),
    getAllSourceSettings(space),
  ])
  const names = new Map(visible.map((entry) => [entry.slug, entry.name]))
  return {
    connections,
    terminalSources: bySpace(terminals, order),
    sourceSettings,
    spaces: order.map((slug) => ({ slug, name: names.get(slug) ?? slug })),
  }
}

/** Whether each container terminal of the spaces in `visible` is running. */
export async function listContainerStates(
  visible: readonly { slug: string }[],
): Promise<Record<string, ContainerState>> {
  return readContainerStates(await listTerminalSources(new Set(visible.map((entry) => entry.slug))))
}
