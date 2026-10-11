import { parseSingleForwarded } from '../../../shared/http/forwarded.ts'
import { AdminAccessError } from './errors.ts'

export type StaffTransport = { origin: string; secure: boolean; mode: 'https' | 'local' }

export function configuredStaffOrigin(value: string | undefined): URL {
  try {
    if (!value || !/^https:\/\/[^/?#]+\/?$/.test(value)) throw new Error()
    const url = new URL(value)
    if (url.username || url.password || url.hostname.length > 253
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(url.hostname) || url.hostname === 'localhost'
      || url.hostname === '127.0.0.1' || url.hostname === '[::1]') throw new Error()
    return url
  } catch { throw new AdminAccessError('ACCESS_UNAVAILABLE') }
}

/** Forwarded values may corroborate the configured authority, never replace it. */
export function assertStaffHttpsTransport(input: {
  configuredUrl: string | undefined; requestUrl: string; host: string | null;
  forwardedHost: string | null; forwardedProto: string | null;
  forwardedPort: string | null; forwarded: string | null;
}): StaffTransport {
  const configured = configuredStaffOrigin(input.configuredUrl)
  const denied = () => { throw new AdminAccessError('STAFF_ORIGIN_DENIED') }
  let request: URL
  try { request = new URL(input.requestUrl) } catch { return denied() }
  if (request.origin !== configured.origin || request.protocol !== 'https:' || request.username || request.password
    || input.host?.toLowerCase() !== configured.host.toLowerCase()) return denied()
  if (input.forwardedHost !== null && input.forwardedHost.toLowerCase() !== configured.host.toLowerCase()) return denied()
  if (input.forwardedProto !== null && input.forwardedProto !== 'https') return denied()
  if (input.forwardedPort !== null && input.forwardedPort !== (configured.port || '443')) return denied()
  if (input.forwarded !== null) {
    // Multiple proxy authorities and duplicate parameters are ambiguous. The
    // application deliberately does not infer an origin from a proxy chain.
    const values = parseSingleForwarded(input.forwarded)
    if (!values) return denied()
    if (values.has('host') && values.get('host')!.toLowerCase() !== configured.host.toLowerCase()) return denied()
    if (values.has('proto') && values.get('proto') !== 'https') return denied()
  }
  return { origin: configured.origin, secure: true, mode: 'https' }
}

export function assertStaffMutationOrigin(input: { method: string; origin: string | null; fetchSite: string | null }, origin: string): void {
  if (input.method === 'GET' || input.method === 'HEAD') return
  if (input.origin !== origin || input.fetchSite === 'cross-site') throw new AdminAccessError('STAFF_ORIGIN_DENIED')
}
