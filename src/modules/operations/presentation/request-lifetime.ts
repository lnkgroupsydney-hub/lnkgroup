/** A private workspace response may only update the lifetime that requested it. */
export class StalePrivateRequest extends Error {
  constructor() { super("The private workspace request is no longer active."); }
}
export class PrivateRequestFailure extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export class PrivateRequestLifetime {
  generation = 0;
  private active = true;
  private pending = new Set<AbortController>();
  private readonly fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }
  activate() { this.active = true; }
  isCurrent(generation: number) { return this.active && generation === this.generation; }
  invalidate() {
    this.generation++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  dispose() { this.active = false; this.invalidate(); }
  async request<T>(path: string, init: RequestInit | undefined, onAccessLost?: () => void): Promise<T> {
    const generation = this.generation;
    if (!this.isCurrent(generation)) throw new StalePrivateRequest();
    const controller = new AbortController();
    this.pending.add(controller);
    try {
      const fetcher = this.fetcher;
      const response = await fetcher(path, { cache: "no-store", credentials: "same-origin", ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])]) });
      const result: unknown = await response.json().catch(() => null);
      if (!this.isCurrent(generation)) throw new StalePrivateRequest();
      if (onAccessLost && (response.status === 401 || response.status === 403)) {
        this.invalidate();
        onAccessLost();
        throw new StalePrivateRequest();
      }
      if (!response.ok) throw new PrivateRequestFailure(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : `Request failed (HTTP ${response.status}).`, response.status);
      return result as T;
    } catch (cause) {
      if (!this.isCurrent(generation)) throw new StalePrivateRequest();
      throw cause;
    } finally { this.pending.delete(controller); }
  }
}
