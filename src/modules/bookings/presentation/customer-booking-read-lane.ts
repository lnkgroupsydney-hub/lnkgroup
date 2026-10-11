/** Polling and manual refresh share a read until it finishes, including slow responses. */
export class CustomerBookingReadLane {
  private pending: Promise<void> | null = null;

  run(read: () => Promise<void>): Promise<void> {
    if (this.pending) return this.pending;
    const pending = read().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  clear() { this.pending = null; }
}
