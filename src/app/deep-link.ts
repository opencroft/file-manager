// Deep-linking: reflect the active source ref + path as `?source=&path=` so a
// view is shareable/bookmarkable. Read once on mount; written via replaceState
// (not pushState) so browsing folders doesn't spam history — same convention as
// the Git app.
export function readDeepLink(): { source: string; path: string } {
  if (typeof window === 'undefined') {
    return { source: '', path: '' }
  }
  const params = new URLSearchParams(window.location.search)
  return { source: params.get('source') ?? '', path: params.get('path') ?? '' }
}

// This page's URL showing `source` at `path` (its root when omitted): the
// same query the page itself reads on mount, keeping every other parameter.
export function deepLinkHref(source: string, path?: string): string {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  if (source) {
    params.set('source', source)
  } else {
    params.delete('source')
  }
  if (path && path !== '/') {
    params.set('path', path)
  } else {
    params.delete('path')
  }
  const qs = params.toString()
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  return qs ? `${pathname}?${qs}` : pathname
}

export function writeDeepLink(source: string, path: string): void {
  if (typeof window === 'undefined') {
    return
  }
  window.history.replaceState(null, '', deepLinkHref(source, path))
}
