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

export interface ListSourcesResult {
  connections: ProtocolConnection[]
  terminalSources: TerminalSourceInfo[]
  sourceSettings: Record<string, SourceSettings>
}
