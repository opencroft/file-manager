import type { Selection, SelectionItem } from '@opencroft/client/chat'

import type { FileEntry } from '../components/ui/file-manager/file-entry-row'
import { fullPath } from '../lib/format'

const TERMINAL = 'term:'

/** Where the listing is and what in it is selected, as the browser shows it. */
export interface ShownFiles {
  /** The source browsed: `term:<nodeId>/<handleId>`, `conn:<id>`, or "" with none open. */
  source: string
  /** The source's root path, as Copy path resolves entries against it. */
  rootPath?: string
  /** The open folder, in the listing's form ("/" for the source's root). */
  folder: string
  /** The selected entries, in listing order. */
  selected: readonly Pick<FileEntry, 'id' | 'kind'>[]
  /** The terminal's name as the sidebar shows it. */
  terminalName?: string
}

/**
 * What the file manager offers a chat as the reader's selection: each selected
 * entry, in listing order, as a `file` item on the source's terminal at its
 * full path (the path Copy path gives), or the open folder when nothing is
 * selected. Null on a connection source (S3, FTP), which no agent tool reads,
 * and with no source open.
 */
export function fileSelection(shown: ShownFiles): Selection | null {
  if (!shown.source.startsWith(TERMINAL)) {
    return null
  }
  const terminal = shown.source.slice(TERMINAL.length)
  const picked = shown.selected.length ? shown.selected : [{ id: shown.folder, kind: 'directory' as const }]
  const items = picked.map(
    (entry): SelectionItem => ({
      kind: 'file',
      terminal,
      path: fullPath(shown.rootPath, entry.id),
      ...(entry.kind === 'directory' ? { folder: true } : {}),
      ...(shown.terminalName ? { on: shown.terminalName } : {}),
    }),
  )
  return { items }
}
