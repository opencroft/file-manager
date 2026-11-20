export interface S3ConnectionConfig {
  endpoint?: string
  region?: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface FtpConnectionConfig {
  host: string
  port?: number
  user: string
  password: string
  secure?: boolean
}

export interface ProtocolConnection {
  id: string
  name: string
  type: 's3' | 'ftp'
  config: S3ConnectionConfig | FtpConnectionConfig
}

/** One terminal, as the `sources` route lists it (server/terminal-sources.ts). */
export interface TerminalSourceInfo {
  ref: string
  title: string
  /** The space the terminal is in. */
  space: string
  /** The graph its node is on, or the App instance offering it. */
  app: { id: string; name: string; kind: 'graph' | 'app' }
  /** The node or App instance offering it. */
  owner: { id: string; name: string }
  /** An Application's replica: a container, which may not be running. */
  container: boolean
}

/** Whether a container terminal runs (server/container-states.ts). */
export type ContainerState = 'running' | 'stopped' | 'unreachable'

export interface SourceSettings {
  rootPath?: string
}

/** A folder on one terminal source by its full path, as the App's `places` actions answer it (server/place-lists.ts). */
export interface PlaceRef {
  source: string
  path: string
}

/** The signed-in person's Bookmarks and Recent folders, newest first. */
export interface Places {
  bookmarks: PlaceRef[]
  recent: PlaceRef[]
}

export interface ListSourcesResult {
  connections: ProtocolConnection[]
  /** The terminals of every space the person sees, the App's own space's first. */
  terminalSources: TerminalSourceInfo[]
  sourceSettings: Record<string, SourceSettings>
  /** Those spaces' names, in the same order. */
  spaces: { slug: string; name: string }[]
}
