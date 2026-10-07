/** One read lane: only its newest response may replace the visible state. */
export class ReadLane {
  private generation = 0
  private controller: AbortController | null = null
  begin() {
    this.controller?.abort()
    const controller = new AbortController(), generation = ++this.generation
    this.controller = controller
    return { signal: controller.signal, current: () => generation === this.generation && !controller.signal.aborted }
  }
  cancel() { this.generation++; this.controller?.abort() }
}

export type MutationSnapshot<T extends object> = { signature: string; value: T & { idempotencyKey: string } };

/** Keep an uncertain mutation's exact payload/key for a safe retry. */
export class MutationAttempt<T extends object> {
  private pending: MutationSnapshot<T> | null
  constructor(snapshot: MutationSnapshot<T> | null = null) {
    this.pending = snapshot ? { signature: snapshot.signature, value: { ...snapshot.value } } : null
  }
  snapshot(): MutationSnapshot<T> | null {
    return this.pending ? { signature: this.pending.signature, value: { ...this.pending.value } } : null
  }
  prepare(value: T, newKey: () => string) {
    const signature = JSON.stringify(value)
    if (this.pending && this.pending.signature !== signature) throw new Error('The previous save could not be confirmed. Retry the unchanged details before starting another request.')
    if (!this.pending) this.pending = { signature, value: { ...value, idempotencyKey: newKey() } }
    return this.pending.value
  }
  clear() { this.pending = null }
}
