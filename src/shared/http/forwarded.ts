/** Vercel-compatible single-element Forwarded parsing. This is deliberately not
 * a full RFC 7239 parser: proxy chains and escaped quoted values remain denied.
 * Extension values (including sig/exp) are opaque and never establish authority. */
export function parseSingleForwarded(value: string): Map<string,string> | null {
  if (value.includes(',')) return null
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code < 32 && code !== 9) || code === 127) return null
  }
  const values = new Map<string,string>(), seen = new Set<string>()
  for (const parameter of value.split(';')) {
    // Keep the existing value grammar, including unquoted base64 '=' padding.
    const match = /^\s*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)=(?:"([^"\\]*)"|([^\s"\\;]+))\s*$/.exec(parameter)
    if (!match) return null
    const name = match[1].toLowerCase()
    if (seen.has(name)) return null
    seen.add(name)
    if (name === 'host' || name === 'proto') values.set(name,match[2] ?? match[3])
  }
  return values
}
