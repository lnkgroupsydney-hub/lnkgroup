import { QuoteRequestError } from './contracts.ts'
/** Fixed application authority. Proxy headers corroborate it and never select it. */
export function quoteRequestTransport(req: Request, configuredUrl: string | undefined): URL {
  let configured: URL
  try {
    if (!configuredUrl) throw new Error()
    const local = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[1-9][0-9]{0,4})?\/?$/.test(configuredUrl)
    if (!local && !/^https:\/\/[^/?#]+\/?$/.test(configuredUrl)) throw new Error()
    configured = new URL(configuredUrl)
    if (configured.username || configured.password || (!local && (configured.hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(configured.hostname) || configured.hostname === 'localhost' || configured.hostname === '127.0.0.1'))) throw new Error()
  } catch { throw new QuoteRequestError(503, 'Live quote requests are not configured.') }
  const deny = () => { throw new QuoteRequestError(403, 'This application address is not allowed.') }
  const url = new URL(req.url), host = req.headers.get('host')
  if (!host || host.toLowerCase() !== configured.host.toLowerCase() || url.username || url.password || url.protocol !== configured.protocol || url.port !== configured.port) return deny()
  if (configured.protocol === 'http:') {
    // NextRequest normalizes 127.0.0.1 to localhost. The actual Host still has to
    // match the approved authority and the URL must remain loopback/same-port.
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return deny()
  } else if (url.origin !== configured.origin) return deny()
  const forwardedHost = req.headers.get('x-forwarded-host'), forwardedProto = req.headers.get('x-forwarded-proto'), forwardedPort = req.headers.get('x-forwarded-port'), forwarded = req.headers.get('forwarded')
  if (forwardedHost !== null && forwardedHost.toLowerCase() !== configured.host.toLowerCase()) return deny()
  if (forwardedProto !== null && forwardedProto !== configured.protocol.slice(0, -1)) return deny()
  if (forwardedPort !== null && forwardedPort !== (configured.port || (configured.protocol === 'https:' ? '443' : '80'))) return deny()
  if (forwarded !== null) {
    if (configured.protocol === 'http:' || forwarded.includes(',')) return deny()
    const values = new Map<string, string>()
    for (const parameter of forwarded.split(';')) {
      const match = /^\s*(host|proto|for|by)=(?:"([^"\\]*)"|([^\s"\\;]+))\s*$/i.exec(parameter)
      if (!match || values.has(match[1].toLowerCase())) return deny()
      values.set(match[1].toLowerCase(), match[2] ?? match[3])
    }
    if (values.has('host') && values.get('host')!.toLowerCase() !== configured.host.toLowerCase()) return deny()
    if (values.has('proto') && values.get('proto') !== 'https') return deny()
  }
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new QuoteRequestError(403, 'Same-origin request required.')
  return configured
}
