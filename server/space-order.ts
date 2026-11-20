// Host-free, so it can be tested on its own.

/**
 * The slugs of `visible` with `own` (the space the App is in) first, the rest
 * in the order the person's space list gives them.
 */
export function spaceOrder(own: string, visible: readonly { slug: string }[]): string[] {
  return [own, ...visible.map((space) => space.slug).filter((slug) => slug !== own)]
}

/** `items` grouped by space in `order`, keeping their order within a space; a space not in `order` is dropped. */
export function bySpace<T extends { space: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((slug, index) => [slug, index]))
  return items
    .filter((item) => rank.has(item.space))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(a.item.space) ?? 0) - (rank.get(b.item.space) ?? 0) || a.index - b.index)
    .map(({ item }) => item)
}
