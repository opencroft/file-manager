import { getProviderForRef } from './connections'
import {
  addConnection,
  removeConnection,
  type SourceSettings,
  setSourceSettings as setSourceSettingsStorage,
  updateConnection,
} from './storage'
import type { ProtocolConnection, Provider } from './types'

// Every action is scoped by the space its App is in: connections and root
// paths are stored per space (server/storage.ts), so the space is as much part
// of addressing a source as the ref itself. A terminal may be in any space;
// the list of them, which is filtered to the spaces the person sees, is the
// `sources` route's (server/routes.ts).

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

async function createFileAction(space: string, source: string, path: string) {
  await (await providerFor(space, source)).createFile(requireString(path, 'path'))
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
  createFile: createFileAction,
  rename: renameAction,
  delete: deleteAction,
  testConnection: testConnectionAction,
  addConnection: addConnectionAction,
  updateConnection: updateConnectionAction,
  removeConnection: removeConnectionAction,
  setSourceSettings: setSourceSettingsAction,
}
