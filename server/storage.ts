import host from '@ext/host'

import type { ProtocolConnection } from './types'

// Connections and per-source settings belong to the SPACE the File Manager app
// was added to: one storage entry per space, so two spaces never read each
// other's endpoints, credentials or root paths. Every entry point below takes
// the space it is acting in.
const connectionsKey = (space: string) => `connections:${space}`
const sourceSettingsKey = (space: string) => `sourceSettings:${space}`

export interface SourceSettings {
  rootPath?: string
}

export async function listConnections(space: string): Promise<ProtocolConnection[]> {
  return (await host.storage.get<ProtocolConnection[]>(connectionsKey(space))) ?? []
}

async function saveConnections(space: string, connections: ProtocolConnection[]): Promise<void> {
  await host.storage.set(connectionsKey(space), connections)
}

export async function getConnection(space: string, id: string): Promise<ProtocolConnection | undefined> {
  return (await listConnections(space)).find((c) => c.id === id)
}

export async function addConnection(space: string, connection: Omit<ProtocolConnection, 'id'>): Promise<ProtocolConnection> {
  const connections = await listConnections(space)
  const created: ProtocolConnection = { ...connection, id: crypto.randomUUID() }
  await saveConnections(space, [...connections, created])
  return created
}

export async function updateConnection(
  space: string,
  id: string,
  patch: Partial<Omit<ProtocolConnection, 'id'>>,
): Promise<ProtocolConnection> {
  const connections = await listConnections(space)
  const index = connections.findIndex((c) => c.id === id)
  if (index < 0) {
    throw new Error(`Unknown connection: ${id}`)
  }
  const updated: ProtocolConnection = { ...connections[index], ...patch, id }
  const next = [...connections]
  next[index] = updated
  await saveConnections(space, next)
  return updated
}

export async function removeConnection(space: string, id: string): Promise<void> {
  const connections = await listConnections(space)
  await saveConnections(space, connections.filter((c) => c.id !== id))
  await setSourceSettings(space, `conn:${id}`, undefined)
}

export async function getAllSourceSettings(space: string): Promise<Record<string, SourceSettings>> {
  return (await host.storage.get<Record<string, SourceSettings>>(sourceSettingsKey(space))) ?? {}
}

export async function getSourceSettings(space: string, ref: string): Promise<SourceSettings> {
  return (await getAllSourceSettings(space))[ref] ?? {}
}

// "/" is the same as "no root" (it doesn't scope anything) — treat it, and an
// empty string, as unset so a stored settings entry never lies about scoping
// something it doesn't.
function hasMeaningfulRootPath(settings: SourceSettings | undefined): boolean {
  return Boolean(settings?.rootPath && settings.rootPath !== '/')
}

export async function setSourceSettings(space: string, ref: string, settings: SourceSettings | undefined): Promise<void> {
  const all = await getAllSourceSettings(space)
  if (!hasMeaningfulRootPath(settings)) {
    delete all[ref]
  } else {
    all[ref] = settings as SourceSettings
  }
  await host.storage.set(sourceSettingsKey(space), all)
}
