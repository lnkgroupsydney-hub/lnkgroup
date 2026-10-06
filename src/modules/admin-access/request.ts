import { AdminAccessError, assertLocalPreviewRequest } from './index.ts'

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
