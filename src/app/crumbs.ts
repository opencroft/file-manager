import type { Crumb } from '@/components/ui/file-manager/file-toolbar'

/**
 * The breadcrumb trail of `path` on place `placeId`, root first, in the
 * entry-id convention: a crumb's id is the path accumulated so far, always
 * with a trailing slash, the same id a directory entry carries. So the kit
 * hook's own navigation, which reads crumb ids straight from here, lines up
 * with what use-file-manager-host's onLocationChange expects.
 */
export function crumbsFor(placeId: string, placeName: string, path?: string): Crumb[] {
  const crumbs: Crumb[] = [{ id: placeId, name: placeName }]
  let accumulated = ''
  for (const segment of (path ?? '').split('/').filter(Boolean)) {
    accumulated += `${segment}/`
    crumbs.push({ id: `/${accumulated}`, name: segment })
  }
  return crumbs
}
