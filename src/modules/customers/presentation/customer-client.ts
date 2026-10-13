export class CustomerRequestError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(message: string, status: number, data: unknown = null) { super(message); this.status = status; this.data = data; }
}

export async function customerRequest<T>(path: string, body?: object, signal?: AbortSignal, method = "POST"): Promise<T> {
  const response = await fetch(`/api/admin/customers${path}`, {
    cache: "no-store", credentials: "same-origin", signal,
    ...(body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) throw new CustomerRequestError(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `Customer service is unavailable (HTTP ${response.status}).`, response.status, value);
  return value as T;
}

export function reviewCandidates<T>(cause: unknown): T[] | null {
  if (!(cause instanceof CustomerRequestError) || cause.status !== 409 || !cause.data || typeof cause.data !== "object") return null;
  const data = cause.data as { code?: unknown; candidates?: unknown };
  return data.code === "needs_review" && Array.isArray(data.candidates) ? data.candidates as T[] : null;
}

export function reviewProperties<T>(cause: unknown): T[] | null {
  if (!(cause instanceof CustomerRequestError) || cause.status !== 409 || !cause.data || typeof cause.data !== "object") return null;
  const data = cause.data as { code?: unknown; properties?: unknown };
  return data.code === "needs_property_review" && Array.isArray(data.properties) ? data.properties as T[] : null;
}
