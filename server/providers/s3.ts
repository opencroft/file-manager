import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

import type { FileEntry, ListResult, Provider, ReadStreamResult, ResolvedS3Config } from '../types'

const MULTIPART_PART_SIZE = 5 * 1024 * 1024
const DELETE_BATCH_SIZE = 1000
const RENAME_CONCURRENCY = 8

function createClient(config: ResolvedS3Config): S3Client {
  const client = new S3Client({
    endpoint: config.endpoint || undefined,
    region: config.region || 'us-east-1',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  })

  // Some S3-compatible endpoints reject trailing slashes on bucket-only paths
  // like /{bucket}/ — strip before signing.
  client.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { path?: string }
      if (request?.path?.match(/^\/[^/]+\/(\?|$)/)) {
        request.path = request.path.replace(/\/+(\?|$)/, '$1')
      }
      return next(args)
    },
    { step: 'build', name: 'fixTrailingSlash', priority: 'low' },
  )

  return client
}

function normalizePrefix(path: string): string {
  const clean = path.replace(/^\/+/, '')
  return clean && !clean.endsWith('/') ? clean + '/' : clean
}

async function* listAllKeys(client: S3Client, bucket: string, prefix: string): AsyncGenerator<string> {
  let continuationToken: string | undefined
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    )
    for (const obj of response.Contents ?? []) {
      if (obj.Key) {
        yield obj.Key
      }
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)
}

async function deleteKeys(client: S3Client, bucket: string, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE)
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }))
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function worker() {
    while (index < items.length) {
      await fn(items[index++])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export function s3Provider(config: ResolvedS3Config): Provider {
  const client = createClient(config)

  return {
    async list(path, cursor): Promise<ListResult> {
      const prefix = normalizePrefix(path)
      const response = await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket, Delimiter: '/', Prefix: prefix || undefined, ContinuationToken: cursor }),
      )

      const entries: FileEntry[] = []
      for (const dir of response.CommonPrefixes ?? []) {
        if (!dir.Prefix) {
          continue
        }
        const name = dir.Prefix.slice(prefix.length).replace(/\/$/, '')
        if (name) {
          entries.push({ name, path: '/' + dir.Prefix, type: 'directory', size: 0, modified: '' })
        }
      }
      for (const obj of response.Contents ?? []) {
        if (!obj.Key) {
          continue
        }
        const name = prefix ? obj.Key.slice(prefix.length) : obj.Key
        if (name) {
          entries.push({ name, path: '/' + obj.Key, type: 'file', size: obj.Size ?? 0, modified: obj.LastModified?.toISOString() ?? '' })
        }
      }
      return { entries, nextCursor: response.NextContinuationToken }
    },

    async readStream(path): Promise<ReadStreamResult> {
      const key = path.replace(/^\/+/, '')
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      if (!response.Body) {
        throw new Error(`Object not found: ${key}`)
      }
      // The Node runtime's S3 client Body is a Node Readable — safe to stream directly.
      return { stream: response.Body as unknown as ReadStreamResult['stream'], size: response.ContentLength }
    },

    async writeStream(path, filename, stream): Promise<void> {
      const dir = normalizePrefix(path)
      const key = dir ? `${dir}${filename}` : filename
      const upload = new Upload({
        client,
        params: { Bucket: config.bucket, Key: key, Body: stream },
        partSize: MULTIPART_PART_SIZE,
      })
      await upload.done()
    },

    async delete(path): Promise<void> {
      const key = path.replace(/^\/+/, '')
      if (!key.endsWith('/')) {
        await deleteKeys(client, config.bucket, [key])
        return
      }
      let batch: string[] = []
      for await (const found of listAllKeys(client, config.bucket, key)) {
        batch.push(found)
        if (batch.length >= DELETE_BATCH_SIZE) {
          await deleteKeys(client, config.bucket, batch)
          batch = []
        }
      }
      if (batch.length > 0) {
        await deleteKeys(client, config.bucket, batch)
      }
    },

    async rename(oldPath, newPath): Promise<void> {
      const oldKey = oldPath.replace(/^\/+/, '')
      const newKey = newPath.replace(/^\/+/, '')
      const oldIsDir = oldKey.endsWith('/')
      if (oldIsDir !== newKey.endsWith('/')) {
        throw new Error('Cannot rename between a file path and a directory path')
      }

      if (!oldIsDir) {
        await client.send(new CopyObjectCommand({ Bucket: config.bucket, CopySource: `${config.bucket}/${oldKey}`, Key: newKey }))
        await deleteKeys(client, config.bucket, [oldKey])
        return
      }

      const oldKeys: string[] = []
      for await (const key of listAllKeys(client, config.bucket, oldKey)) {
        oldKeys.push(key)
      }
      await mapWithConcurrency(oldKeys, RENAME_CONCURRENCY, async (key) => {
        await client.send(
          new CopyObjectCommand({ Bucket: config.bucket, CopySource: `${config.bucket}/${key}`, Key: newKey + key.slice(oldKey.length) }),
        )
      })
      if (oldKeys.length > 0) {
        await deleteKeys(client, config.bucket, oldKeys)
      }
    },

    async mkdir(path): Promise<void> {
      // S3-compatible endpoints may reject trailing-slash keys — a .keep marker
      // file inside the directory establishes the prefix instead.
      const dir = normalizePrefix(path.replace(/^\/+/, ''))
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: `${dir}.keep`, Body: Buffer.from(' ') }))
    },
  }
}
