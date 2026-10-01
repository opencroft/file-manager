import { getProviderForRef } from './connections'
import {
  addConnection,
  getAllSourceSettings,
  listConnections,
  removeConnection,
  setSourceSettings as setSourceSettingsStorage,
  updateConnection,
  type SourceSettings,
} from './storage'
import { listTerminalSources } from './terminal-sources'
import type { Provider, ProtocolConnection } from './types'

// Every action is scoped by the space its caller is in: connections and root
// paths are stored per space (server/storage.ts), so the space is as much part
// of addressing a source as the ref itself.

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`"${name}" is required`)
  }
  return value
}

function providerFor(space: unknown, source: unknown): Promise<Provider> {
  return getProviderForRef(requireString(space, 'space'), requireString(source, 'source'))
}

async function listAction(space: string, source: string, path: string, cursor?: string) {
  const provider = await providerFor(space, source)
  return provider.list(requireString(path, 'path'), cursor)
}

async function mkdirAction(space: string, source: string, path: string) {
  await (await providerFor(space, source)).mkdir(requireString(path, 'path'))
  return { ok: true }
}

async function renameAction(space: string, source: string, oldPath: string, newPath: string) {
  await (await providerFor(space, source)).rename(requireString(oldPath, 'oldPath'), requireString(newPath, 'newPath'))
  return { ok: true }
}

async function deleteAction(space: string, source: string, path: string) {
  await (await providerFor(space, source)).delete(requireString(path, 'path'))
  return { ok: true }
}

async function testConnectionAction(space: string, source: string) {
  await (await providerFor(space, source)).list('/')
  return { ok: true }
}

async function listSourcesAction(space: string): Promise<{
  connections: ProtocolConnection[]
  terminalSources: Awaited<ReturnType<typeof listTerminalSources>>
  sourceSettings: Record<string, SourceSettings>
}> {
  const scope = requireString(space, 'space')
  const [connections, terminalSources, sourceSettings] = await Promise.all([
    listConnections(scope),
    listTerminalSources(scope),
    getAllSourceSettings(scope),
  ])
  return { connections, terminalSources, sourceSettings }
}

async function addConnectionAction(space: string, input: Omit<ProtocolConnection, 'id'>) {
  return addConnection(requireString(space, 'space'), input)
}

async function updateConnectionAction(space: string, id: string, patch: Partial<Omit<ProtocolConnection, 'id'>>) {
  return updateConnection(requireString(space, 'space'), requireString(id, 'id'), patch)
}

async function removeConnectionAction(space: string, id: string) {
  await removeConnection(requireString(space, 'space'), requireString(id, 'id'))
  return { ok: true }
}

async function setSourceSettingsAction(space: string, ref: string, settings: SourceSettings | undefined) {
  await setSourceSettingsStorage(requireString(space, 'space'), requireString(ref, 'ref'), settings)
  return { ok: true }
}

export const actions = {
  list: listAction,
  mkdir: mkdirAction,
  rename: renameAction,
  delete: deleteAction,
  testConnection: testConnectionAction,
  listSources: listSourcesAction,
  addConnection: addConnectionAction,
  updateConnection: updateConnectionAction,
  removeConnection: removeConnectionAction,
  setSourceSettings: setSourceSettingsAction,
}
