// Host-free, so it can be tested on its own: the host's listing is passed in.

/** A source ref that names no terminal any space lists. */
export class NotATerminalError extends Error {}

// Listing the terminals walks every graph and expands every dynamic handle
// (each Git worktree, each running container): seconds, where the file
// operation itself takes a fraction of one. So a listing serves the burst of
// calls that follows it. A terminal that is gone is still accepted until its
// listing is this old.
export const LISTING_TTL_MS = 60_000

/** One listed terminal: its source ref and the space it is in. */
export interface ListedTerminal {
  ref: string
  space: string
}

export interface TerminalIndex {
  /** Keep a listing just read elsewhere, so the next lookup needn't read it again. */
  remember(terminals: readonly ListedTerminal[]): void
  /** The space `ref` is a terminal of; rejects with NotATerminalError when no space lists it. */
  spaceOf(ref: string): Promise<string>
}

/**
 * Which space each terminal is in, as `list` answers, for checking the ref a
 * caller names. A ref missing from a listing still fresh is listed again
 * before it is refused, since the terminal may be newer than the listing.
 */
export function terminalIndex(
  list: () => Promise<readonly ListedTerminal[]>,
  now: () => number = Date.now,
): TerminalIndex {
  let listing: { at: number; spaces: Promise<Map<string, string>> } | undefined

  function keep(spaces: Promise<Map<string, string>>): Promise<Map<string, string>> {
    const entry = { at: now(), spaces }
    listing = entry
    // A listing that failed is not kept: the next lookup lists again.
    spaces.catch(() => {
      if (listing === entry) {
        listing = undefined
      }
    })
    return spaces
  }

  const bySpace = (terminals: readonly ListedTerminal[]) =>
    new Map(terminals.map((terminal) => [terminal.ref, terminal.space]))

  return {
    remember(terminals) {
      keep(Promise.resolve(bySpace(terminals)))
    },
    async spaceOf(ref) {
      if (listing && now() - listing.at < LISTING_TTL_MS) {
        const space = (await listing.spaces).get(ref)
        if (space !== undefined) {
          return space
        }
      }
      const space = (await keep(list().then(bySpace))).get(ref)
      if (space === undefined) {
        throw new NotATerminalError(`Source "${ref}" is not a terminal of any space`)
      }
      return space
    },
  }
}
