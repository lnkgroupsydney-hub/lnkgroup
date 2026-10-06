export class AuthRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function authRequest<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin-auth/${path}`, {
    cache: "no-store", credentials: "same-origin", signal,
    ...(body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  });
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : `Administrator access is unavailable (HTTP ${response.status}).`;
    const code = result && typeof result === "object" && "code" in result && typeof result.code === "string" ? result.code : undefined;
    throw new AuthRequestError(message, response.status, code);
  }
  return result as T;
}
