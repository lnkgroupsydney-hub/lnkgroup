interface DeferredAnalysisDependencies {
  schedule(callback: () => Promise<void>): void
  run(jobId: string): Promise<void>
  warn(message: string): void
}
const safeFailure = 'Saved photo analysis follow-up could not complete. The saved job remains available for explicit recovery.'
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null
}

/** Schedule only a successfully saved, current, queued live job. Execution still
 * requires the runner's atomic database claim; replay and browser recovery can
 * schedule the same job safely without starting another paid analysis. */
export async function scheduleQueuedQuoteAnalysis(response: Response, deps: DeferredAnalysisDependencies): Promise<void> {
  if (!response.ok) return
  try {
    const body = record(await response.clone().json())
    const request = record(body?.request), latest = record(body?.latest)
    if (request?.mode !== 'live' || request.companyId !== 'lk-group' || latest?.status !== 'queued' || latest.stale !== false || latest.requestId !== request.id || typeof latest.id !== 'string' || !uuid.test(latest.id)) return
    const jobId = latest.id
    deps.schedule(async () => {
      try { await deps.run(jobId) }
      catch { deps.warn(safeFailure) }
    })
  } catch {
    // Do not expose provider/storage errors, cookies or customer photo metadata.
    // The start response remains intact and existing recovery can claim the job.
    deps.warn(safeFailure)
  }
}
