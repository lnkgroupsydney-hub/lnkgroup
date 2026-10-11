/** The selector identifies a workspace; its HttpOnly cookie still grants access. */
export function quoteApiPath(path: string, search?: string): string {
  const selected = new URLSearchParams(search ?? (typeof window === "undefined" ? "" : window.location.search));
  if (!selected.has("quote")) return path;
  const target = new URL(path, "http://quote-workspace.invalid");
  target.searchParams.delete("quote");
  // Preserve malformed, empty and duplicate selectors for the server to reject.
  // Dropping one would silently switch ownership to the original workspace.
  for (const value of selected.getAll("quote")) target.searchParams.append("quote", value);
  return `${target.pathname}${target.search}${target.hash}`;
}

export function newQuoteHref(response: unknown, nextId: string): string {
  const expected = `/quote/start?service=cabinet-painting&quote=${nextId}`;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(nextId) ||
    !response || typeof response !== "object" || Array.isArray(response) ||
    !("ready" in response) || response.ready !== true || !("href" in response) || response.href !== expected) {
    throw new Error("The new quote could not be confirmed. Your saved request is unchanged. Retry opening the same new quote.");
  }
  return expected;
}
