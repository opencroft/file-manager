// Running a pack or an unpack through its route and following it: the route
// answers one JSON object per line (server/routes.ts): `progress` now and
// then, then `result` or `error`. Free of host imports, so it runs under test.

export interface ArchiveProgress {
  done: number
  total: number
}

// What the routes answer as `result`, as far as the App reads it
// (PackResult and UnpackResult in server/archive).
export interface PackAnswer {
  path: string
  name: string
}

export interface UnpackAnswer {
  path: string
  name: string
  skipped: { links: number; macMetadata: number }
}

interface ArchiveLine<T> {
  progress?: ArchiveProgress
  result?: T
  error?: string
}

/**
 * The run's result, from the route's answer. `onProgress` hears each progress
 * line. Rejects with the run's error, the route's refusal, or an answer that
 * stops before saying how the run ended.
 */
export async function readArchiveRun<T>(
  response: Response,
  onProgress: (progress: ArchiveProgress) => void,
): Promise<T> {
  if (!response.ok || !response.body) {
    const refusal = (await response.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(refusal?.error ?? `The request failed (${response.status})`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffered += value ?? ''
    const lines = buffered.split('\n')
    buffered = done ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      if (!line.trim()) {
        continue
      }
      const message = JSON.parse(line) as ArchiveLine<T>
      if (message.progress) {
        onProgress(message.progress)
      } else if (message.error !== undefined) {
        throw new Error(message.error)
      } else if ('result' in message) {
        return message.result as T
      }
    }
    if (done) {
      throw new Error('The connection ended before the server said how it went')
    }
  }
}
