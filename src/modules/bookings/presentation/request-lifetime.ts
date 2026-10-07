export class StaleBookingRequest extends Error {}
/** Private booking requests share a scope across list, detail, changes and commands. */
export class BookingRequestLifetime {
  private active = true;
  private generation = 0;
  private pending = new Set<AbortController>();
  activate() { this.active = true; }
  dispose() {
    this.active = false; this.generation++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  async run<T>(request: (signal: AbortSignal) => Promise<T>, onAccessLost: () => void): Promise<T> {
    const version = this.generation;
    if (!this.active) throw new StaleBookingRequest();
    const controller = new AbortController();
    this.pending.add(controller);
    try {
      const value = await request(controller.signal);
      if (!this.active || version !== this.generation) throw new StaleBookingRequest();
      return value;
    } catch (failure) {
      if (!this.active || version !== this.generation) throw new StaleBookingRequest();
      if (failure && typeof failure === "object" && "status" in failure && (failure.status === 401 || failure.status === 403)) {
        this.dispose(); onAccessLost(); throw new StaleBookingRequest();
      }
      throw failure;
    } finally { this.pending.delete(controller); }
  }
}
