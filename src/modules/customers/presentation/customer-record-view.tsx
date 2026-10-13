import type { CustomerRecord } from "../domain/contracts";

export function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(date);
}
export function sourceLabel(record: CustomerRecord) { return record.sourceType === "submission" ? "Signed demo submission" : record.sourceType === "quote_request" ? "Operating quote" : "Enquiry"; }
export function contact(value: { name: string | null; email: string | null; phone: string | null; address: string | null }) {
  return <dl className="customers-contact"><div><dt>Name</dt><dd>{value.name || "Not provided"}</dd></div><div><dt>Email</dt><dd>{value.email || "Not provided"}</dd></div><div><dt>Phone</dt><dd>{value.phone || "Not provided"}</dd></div><div><dt>Address</dt><dd>{value.address || "Not provided"}</dd></div></dl>;
}
// Only the existing independently authorized file API paths are actionable.
export function filePath(url: string | null, kind: "pdf" | "photo") {
  if (!url || !url.startsWith("/api/") || url.startsWith("//") || /[\\\u0000-\u001f]/.test(url)) return null;
  return kind === "pdf" && /^\/api\/operations\/bookings\/[0-9a-f-]{36}\/documents\/(quote|agreement)$/.test(url) ? url
    : kind === "photo" && (/^\/api\/operations\/bookings\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}$/.test(url) || /^\/api\/admin\/quote-requests\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}$/.test(url)) ? url : null;
}
export function quoteDetailPath(record: CustomerRecord) {
  return record.sourceType === "quote_request" && record.links.detail && /^\/admin\/quotes\/[0-9a-f-]{36}$/.test(record.links.detail) ? record.links.detail : null;
}
