// Deleting one or several listing entries: the one question asked first, and
// the deletes themselves. Free of host imports, so it runs under test as is.

export interface DeletedEntry {
  id: string
  name: string
  kind: 'file' | 'directory'
}

/** The confirmation asked once before deleting `entries`. Deleting a folder is recursive, so the question says so. */
export function deleteQuestion(entries: DeletedEntry[]): string {
  if (entries.length === 1) {
    const [entry] = entries
    const kind = entry.kind === 'directory' ? 'folder (and everything in it)' : 'file'
    return `Delete ${kind} "${entry.name}"?`
  }
  const folders = entries.some((entry) => entry.kind === 'directory')
  return `Delete ${entries.length} items?${folders ? ' Folders are deleted with everything in them.' : ''}`
}

export interface DeleteFailure {
  name: string
  message: string
}

/**
 * Deletes `entries` one at a time through `remove`, going on past a failure,
 * and answers the ones that failed with why. One at a time, as a person
 * deleting them would: no source is handed a burst of deletes at once.
 */
export async function deleteEntries(
  entries: DeletedEntry[],
  remove: (id: string) => Promise<unknown>,
): Promise<DeleteFailure[]> {
  const failures: DeleteFailure[] = []
  for (const entry of entries) {
    try {
      await remove(entry.id)
    } catch (err) {
      failures.push({ name: entry.name, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return failures
}

/** The toast for deletes that failed: how many of how many, and the first reason. */
export function deleteFailureNote(failures: DeleteFailure[], total: number): string {
  const [first] = failures
  if (total === 1) {
    return first.message
  }
  return `Could not delete ${failures.length} of ${total} items. "${first.name}": ${first.message}`
}
