/** Quote one argument for a POSIX shell — safe against embedded spaces, quotes, and glob chars. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
