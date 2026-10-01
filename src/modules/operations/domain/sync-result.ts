function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A successful HTTP request can still contain failed integration operations. */
export function syncFailureMessage(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.gmail) || !isRecord(result.calendar)) {
    return 'Sync returned an invalid result. Please retry.'
  }
  const errors: string[] = []
  for (const [name, status] of [['Gmail', result.gmail], ['Calendar', result.calendar]] as const) {
    if (typeof status.error === 'string' && status.error.trim()) errors.push(status.error.trim())
    else if (typeof status.failed === 'number' && status.failed > 0) {
      errors.push(`${name} sync failed for ${status.failed} operation(s); retry available.`)
    }
  }
  return errors.length ? errors.join(' ') : null
}
