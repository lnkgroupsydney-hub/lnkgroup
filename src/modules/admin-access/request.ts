import { AdminAccessError, assertLocalPreviewRequest } from './index.ts'
import { assertStaffHttpsTransport, assertStaffMutationOrigin, type StaffTransport } from './domain/staff-transport.ts'

/** Staff sessions and the local preview exception retain separate transports. */
export function staffRequestTransport(req: Request): StaffTransport {
  const configuredUrl = process.env.APP_BASE_URL
  const transport = configuredUrl?.startsWith('http:')
    ? (() => {
      const context = localPreviewContext(req)
      assertLocalPreviewRequest(context)
      // Remote proxy headers cannot turn an incoming request into loopback.
      const configured = new URL(context.configuredUrl!)
      const host = configured.host
      if ((req.headers.has('x-forwarded-host') && req.headers.get('x-forwarded-host') !== host)
        || (req.headers.has('x-forwarded-proto') && req.headers.get('x-forwarded-proto') !== 'http')
        || (req.headers.has('x-forwarded-port') && req.headers.get('x-forwarded-port') !== (configured.port || '80'))
        || req.headers.has('forwarded')) throw new AdminAccessError('LOCAL_PREVIEW_ORIGIN_DENIED')
      return { origin: new URL(context.configuredUrl!).origin, secure: false, mode: 'local' as const }
    })()
    : assertStaffHttpsTransport({ configuredUrl, requestUrl: req.url, host: req.headers.get('host'),
      forwardedHost: req.headers.get('x-forwarded-host'), forwardedProto: req.headers.get('x-forwarded-proto'),
      forwardedPort: req.headers.get('x-forwarded-port'), forwarded: req.headers.get('forwarded') })
  assertStaffMutationOrigin({ method: req.method, origin: req.headers.get('origin'), fetchSite: req.headers.get('sec-fetch-site') }, transport.origin)
  return transport
}

export function localPreviewContext(req: Request) {
  const context = {
    enabled: process.env.LOCAL_OPERATIONS_ENABLED === 'true',
    configuredUrl: process.env.APP_BASE_URL,
    requestUrl: req.url,
  }
  // Validate the original feature flag and configuration before parsing either
  // request authority. Invalid configuration remains unavailable, not forbidden.
  assertLocalPreviewRequest({ ...context, requestUrl: context.configuredUrl ?? '' })
  const host = req.headers.get('host')
  if (host === null) return context

  const configured = new URL(context.configuredUrl!)
  const internal = new URL(req.url)
  // NextRequest normalizes loopback URLs to localhost, even when the browser
  // requested 127.0.0.1. Only that framework alias is reconciled: the actual Host
  // must still be the configured authority, and both URL ports must agree.
  if (host.toLowerCase() !== configured.host.toLowerCase()
    || internal.protocol !== 'http:'
    || (internal.hostname !== 'localhost' && internal.hostname !== '127.0.0.1')
    || internal.port !== configured.port
    || internal.username || internal.password) {
    throw new AdminAccessError('LOCAL_PREVIEW_ORIGIN_DENIED')
  }
  internal.hostname = configured.hostname
  return { ...context, requestUrl: internal.toString() }
}
