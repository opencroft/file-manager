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

export interface TerminalSourceInfo {
  ref: string
  title: string
}

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
  terminalSources: TerminalSourceInfo[]
  sourceSettings: Record<string, SourceSettings>
}
