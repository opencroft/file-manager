// Host-free, so it can be tested on its own: the host's listing is passed in.

/** A source ref named for a space that does not hold it. */
export class NotInSpaceError extends Error {}

// Listing a space's terminals walks every graph and expands every dynamic
// handle (each Git worktree, each running container): seconds, where the file
// operation itself takes a fraction of one. So a listing serves the burst of
// calls that follows it. A terminal that leaves the space is still accepted
// until its listing is this old.
export const LISTING_TTL_MS = 60_000

export interface SpaceTerminals {
  /** Keep a listing of `space` just read elsewhere, so the next check needn't read it again. */
  remember(space: string, refs: readonly string[]): void
  /** Resolves when `ref` is one of `space`'s terminals; rejects with NotInSpaceError when it is not. */
  require(space: string, ref: string): Promise<void>
}

/**
 * The terminals each space holds, as `list` answers, for checking the ref a
 * caller names. A ref missing from a listing still fresh is listed again
 * before it is refused, since the terminal may be newer than the listing.
 */
export function spaceTerminals(
  list: (space: string) => Promise<readonly string[]>,
  now: () => number = Date.now,
): SpaceTerminals {
  const listings = new Map<string, { at: number; refs: Promise<Set<string>> }>()

  function keep(space: string, refs: Promise<Set<string>>): Promise<Set<string>> {
    const entry = { at: now(), refs }
    listings.set(space, entry)
    // A listing that failed is not kept: the next check lists again.
    refs.catch(() => {
      if (listings.get(space) === entry) {
        listings.delete(space)
      }
    })
    return refs
  }

  const read = (space: string) =>
    keep(
      space,
      list(space).then((refs) => new Set(refs)),
    )

  return {
    remember(space, refs) {
      keep(space, Promise.resolve(new Set(refs)))
    },
    async require(space, ref) {
      const listing = listings.get(space)
      if (listing && now() - listing.at < LISTING_TTL_MS && (await listing.refs).has(ref)) {
        return
      }
      if (!(await read(space)).has(ref)) {
        throw new NotInSpaceError(`Source "${ref}" is not a terminal of space "${space}"`)
      }
    },
  }
}
