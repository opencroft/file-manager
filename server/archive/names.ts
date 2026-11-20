// Names for packing and unpacking: what a new archive or folder is called, and
// where an archive's entry may land. Free of host imports, so it runs under
// test as is.

/** The name an archive of `items` (the packed entries) gets before any clash. */
export function archiveName(items: { name: string; kind: 'file' | 'directory' }[]): string {
  if (items.length !== 1) {
    return 'Archive.zip'
  }
  const [item] = items
  // A file's extension gives way to the archive's ("report.pdf" packs to
  // "report.zip"); a folder keeps its whole name, dots included ("v1.2").
  const dot = item.kind === 'file' ? item.name.lastIndexOf('.') : -1
  return `${dot > 0 ? item.name.slice(0, dot) : item.name}.zip`
}

/** The folder an archive unpacks into, before any clash: its name without `.zip`. */
export function unpackFolderName(archive: string): string {
  return archive.replace(/\.zip$/i, '') || 'Archive'
}

/**
 * `name` when `taken` does not hold it, else the first of "stem 2.ext",
 * "stem 3.ext", … that is free. The extension is the last dot's, so a folder
 * name with none ("photos") counts up as "photos 2".
 */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/** Why an archive is refused: one of its entries would land outside the folder it unpacks into. */
export class EntryOutsideError extends Error {
  constructor(entry: string) {
    super(
      `The archive is refused: its entry "${entry}" points outside the folder it unpacks into. Nothing was unpacked.`,
    )
  }
}

/**
 * The folders and name an archive entry unpacks to, relative to the folder it
 * unpacks into: `a/b/c.txt` is `["a", "b", "c.txt"]`. Backslashes (written by
 * some Windows tools) separate as slashes do, and `.` and empty segments are
 * dropped, so `./` is the folder itself (empty). Throws EntryOutsideError for
 * an absolute path, a drive letter or any `..`.
 */
export function entrySegments(entry: string): string[] {
  const path = entry.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new EntryOutsideError(entry)
  }
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) {
    throw new EntryOutsideError(entry)
  }
  return segments
}

/**
 * Whether an entry is under the `__MACOSX/` folder macOS's Finder adds to the
 * archives it makes: resource-fork metadata, not content, which Finder itself
 * leaves out when it unpacks.
 */
export function isMacMetadata(segments: string[]): boolean {
  return segments[0] === '__MACOSX'
}
