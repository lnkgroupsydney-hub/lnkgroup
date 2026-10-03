import type { SignaturePoint } from "@/shared/ui/signature-pad";

export class BookingRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function bookingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials:"same-origin", cache:"no-store", signal:AbortSignal.timeout(30_000) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new BookingRequestError(response.status, value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The booking request could not be completed. Refresh its status before retrying.");
  if (!value || typeof value !== "object") throw new Error("The server did not return a valid booking response. Refresh its status before retrying.");
  return value as T;
}
export function bookingPost<T>(path: string, value: unknown) {
  return bookingRequest<T>(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
}
export function requestMessage(value: unknown) { return value instanceof Error ? value.message : "The request could not be completed. Please retry."; }
export function sydneyTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",dateStyle:"medium",timeStyle:"short"}).format(date) : "Invalid date";
}
export function sydneyInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const part = (type:string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function validDrawnSignature(strokes: SignaturePoint[][]) {
  const points = strokes.flat();
  return points.length >= 4 && points.length <= 2000 && Math.max(Math.max(...points.map(point => point.x))-Math.min(...points.map(point => point.x)),Math.max(...points.map(point => point.y))-Math.min(...points.map(point => point.y))) >= .02;
}
export function SignaturePreview({ name, strokes, label = "Saved demonstration signature" }: { name: string; strokes: SignaturePoint[][]; label?: string }) {
  return <figure className="booking-signature-preview"><svg viewBox="0 0 800 240" role="img" aria-label={`${label}: ${name}`}><title>{label}: {name}</title>{strokes.map((stroke,index) => <polyline key={index} points={stroke.map(point => `${point.x*800},${point.y*240}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}</svg><figcaption>{name} · {label}</figcaption></figure>;
}
export function statusLabel(value: string | null | undefined) { return value ? value.replaceAll("_"," ") : "Not started"; }
