import { dockerProvider } from './providers/docker'
import { ftpProvider } from './providers/ftp'
import { localProvider } from './providers/local'
import { s3Provider } from './providers/s3'
import { sshProvider } from './providers/ssh'
import { wslProvider } from './providers/wsl'
import type { Provider, Source } from './types'

export function getProvider(source: Source): Provider {
  if (source.kind === 's3') {
    return s3Provider(source.config)
  }
  if (source.kind === 'ftp') {
    return ftpProvider(source.config)
  }

  const ctx = source.ctx
  switch (ctx.type) {
    case 'ssh':
      return sshProvider(ctx)
    case 'wsl':
      return wslProvider(ctx)
    case 'docker-exec':
      return dockerProvider(ctx)
    default:
      return localProvider
  }
}
