import type { Readable } from 'node:stream'

import type { TerminalContext } from '@opencroft/server'

export type { TerminalContext }

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: string
}

export interface ListResult {
  entries: FileEntry[]
  nextCursor?: string
}

export interface ReadStreamResult {
  stream: Readable
  size?: number
}

/** The one operation set every backend (local/wsl/ssh/docker, s3, ftp) implements. */
export interface Provider {
  list(path: string, cursor?: string): Promise<ListResult>
  readStream(path: string): Promise<ReadStreamResult>
  writeStream(path: string, filename: string, stream: Readable): Promise<void>
  delete(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface S3ConnectionConfig {
  endpoint?: string
  region?: string
  bucket: string
  /** Literal value, or "secret:NAME" resolved server-side via host.secrets. */
  accessKeyId: string
  /** Literal value, or "secret:NAME" resolved server-side via host.secrets. */
  secretAccessKey: string
}

export interface FtpConnectionConfig {
  host: string
  port?: number
  user: string
  /** Literal value, or "secret:NAME" resolved server-side via host.secrets. */
  password: string
  secure?: boolean
}

export interface ProtocolConnection {
  id: string
  name: string
  type: 's3' | 'ftp'
  config: S3ConnectionConfig | FtpConnectionConfig
}

/** Resolved (secrets already substituted) — never persisted, never sent to the client. */
export type ResolvedS3Config = S3ConnectionConfig
export type ResolvedFtpConfig = FtpConnectionConfig

export type Source =
  | { kind: 'terminal'; ctx: TerminalContext }
  | { kind: 's3'; config: ResolvedS3Config }
  | { kind: 'ftp'; config: ResolvedFtpConfig }
