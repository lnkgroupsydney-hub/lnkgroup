"use client";

import { useEffect, useRef, useState } from "react";
import { SignaturePad } from "@/shared/ui/signature-pad";
import { CustomerBookingReview } from "@/modules/bookings/client";
import { DEMO_PRICE, DEMO_TERMS, DEMO_VERSION, type DemoSignature, type DemoSnapshot, type DemoSubmissionStatus, type SignaturePoint } from "../domain/demo-submission";
import { validateQuoteDraft, type QuoteDraft } from "../domain/quote-draft";
import type { AvailabilityDay } from "../domain/availability";

type DemoConfiguration = { enabled: boolean; recipientEmail: string; submission: DemoSubmissionStatus | null };
type Availability = { days: AvailabilityDay[]; revision: string; checkedAt: string; expiresAt: string };
type Review = { snapshot: DemoSnapshot; reviewToken: string };
const EMAIL_STATES = ["pending", "sending", "provider_accepted", "retrying", "failed", "outcome_unknown"];
const CALENDAR_STATES = ["blocked", "pending", "synced", "retrying", "conflict"];
const INTENTS: Record<string,string> = { "full-repainting":"Full cabinet repainting", "partial-touch-ups":"Partial painting or touch-ups", "colour-change":"Colour change", advice:"I need advice" };
const SURFACES: Record<string,string> = { doors:"Cabinet doors", drawers:"Drawer fronts", frames:"Exposed frames", panels:"End panels", repairs:"Areas needing repair", unknown:"Not sure yet" };
const DATE_FORMAT = new Intl.DateTimeFormat("en-AU", { timeZone:"UTC", weekday:"long", day:"numeric", month:"long", year:"numeric" });
const MONEY_FORMAT = new Intl.NumberFormat("en-AU", { style:"currency", currency:"AUD" });
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function dateLabel(value: string) { return DATE_FORMAT.format(new Date(`${value}T12:00:00Z`)); }
function failureMessage(error: unknown) { return error instanceof Error ? error.message : "This request could not be completed. Please retry."; }
class DemoRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function request(path: string, init: RequestInit = {}): Promise<Record<string,unknown>> {
  const response = await fetch(path, { ...init, credentials:"same-origin", cache:"no-store", signal:AbortSignal.timeout(25_000) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new DemoRequestError(response.status, record(value) && typeof value.error === "string" ? value.error : "The service is unavailable. Please retry.");
  if (!record(value)) throw new Error("The server returned an incomplete response. Please retry.");
  return value;
}
function parseSubmission(value: unknown): DemoSubmissionStatus | null {
  if (value === null) return null;
  if (!record(value) || typeof value.id !== "string" || typeof value.reference !== "string" || typeof value.submittedAt !== "string" || !Number.isFinite(Date.parse(value.submittedAt)) || typeof value.preferredDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.preferredDate) || !EMAIL_STATES.includes(String(value.emailStatus)) || !CALENDAR_STATES.includes(String(value.calendarStatus)) || (value.error !== null && typeof value.error !== "string")) throw new Error("Your submission status could not be verified. Retry checking its status before making changes.");
  return value as unknown as DemoSubmissionStatus;
}
export async function loadDemoConfiguration(): Promise<DemoConfiguration> {
  const value = await request("/api/quote/demo");
  if (typeof value.enabled !== "boolean" || !("submission" in value) || (value.enabled && (typeof value.recipientEmail !== "string" || !value.recipientEmail))) throw new Error("The demo configuration could not be loaded. Please retry.");
  return { enabled:value.enabled, recipientEmail:typeof value.recipientEmail === "string" ? value.recipientEmail : "", submission:parseSubmission(value.submission) };
}
function parseAvailability(value: Record<string,unknown>): Availability {
  if (!Array.isArray(value.days) || !value.days.every(day => record(day) && typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && typeof day.selectable === "boolean" && typeof day.reason === "string") || typeof value.revision !== "string" || typeof value.checkedAt !== "string" || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt)) || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error("Available dates could not be verified. Please refresh the calendar.");
  return value as unknown as Availability;
}
function parseReview(value: Record<string,unknown>, draft: QuoteDraft, preferredDate: string): Review {
  const snapshot = value.snapshot;
  if (!record(snapshot) || snapshot.mode !== "demo" || snapshot.version !== DEMO_VERSION || snapshot.draftId !== draft.id || snapshot.draftRevision !== draft.revision || snapshot.preferredDate !== preferredDate || typeof value.reviewToken !== "string" || !value.reviewToken || !record(snapshot.price) || snapshot.price.currency !== DEMO_PRICE.currency || snapshot.price.totalCents !== DEMO_PRICE.totalCents || snapshot.price.label !== DEMO_PRICE.label || !Array.isArray(snapshot.terms) || JSON.stringify(snapshot.terms) !== JSON.stringify(DEMO_TERMS) || JSON.stringify(validateQuoteDraft(snapshot.payload)) !== JSON.stringify(draft.payload)) throw new Error("The saved details changed. Return to your service details and review the latest draft before signing.");
  return { snapshot:snapshot as unknown as DemoSnapshot, reviewToken:value.reviewToken };
}
function todayInSydney() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Australia/Sydney", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`;
}
function shiftMonth(month: string, amount: number) { const [year,number] = month.split("-").map(Number); return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0,7); }
function pending(submission: DemoSubmissionStatus) { return !["failed","outcome_unknown"].includes(submission.emailStatus) && !["synced","conflict"].includes(submission.calendarStatus); }


function SnapshotSummary({ snapshot }: { snapshot: DemoSnapshot }) {
  const { contact,service } = snapshot.payload;
  return <>
    <dl className="enquiry-review">
      <div><dt>Customer</dt><dd>{contact.name}</dd></div><div><dt>Email recipient</dt><dd>{contact.email}</dd></div>
      <div><dt>Phone</dt><dd>{contact.phone || "Not provided"}</dd></div><div><dt>Site address</dt><dd>{contact.siteAddress}, {contact.suburb} {contact.postcode}</dd></div>
      <div><dt>Project details</dt><dd>{contact.details || "Not provided"}</dd></div>
      <div><dt>Service</dt><dd>Kitchen Cabinet Painting · {service && (INTENTS[service.intent] ?? service.intent)}</dd></div>
      <div><dt>Surfaces</dt><dd>{service?.surfaces.map(surface => SURFACES[surface] ?? surface).join(", ")}</dd></div>
      <div><dt>Quantity</dt><dd>Doors: {service?.doorCount ?? "Unknown"} · Drawer fronts: {service?.drawerCount ?? "Unknown"}</dd></div>
      <div><dt>Material / finish</dt><dd>{service?.material || "Unknown"} / {service?.colourPreference || "Not specified"}</dd></div>
      <div><dt>Preferred start</dt><dd>{dateLabel(snapshot.preferredDate)} (Sydney) · pending company review</dd></div>
      <div><dt>Demo amount</dt><dd>{MONEY_FORMAT.format(snapshot.price.totalCents/100)} {snapshot.price.currency}<br />{snapshot.price.label}</dd></div>
    </dl>
    <div className="demo-terms"><h3>Demonstration terms · {snapshot.version}</h3><ul>{snapshot.terms.map(term => <li key={term}>{term}</li>)}</ul></div>
  </>;
}
function SubmissionResult({ submission, statusError, onRefresh, checking }: { submission: DemoSubmissionStatus; statusError: string; onRefresh: () => void; checking: boolean }) {
  const emails: Record<DemoSubmissionStatus["emailStatus"],string> = { pending:"Queued", sending:"Sending", provider_accepted:"Accepted by email provider", retrying:"Waiting to retry", failed:"Needs attention — email not sent", outcome_unknown:"Delivery outcome needs verification" };
  const calendars: Record<DemoSubmissionStatus["calendarStatus"],string> = { blocked:"Waiting for email acceptance", pending:"Queued", synced:"Saved to company Google Calendar", retrying:"Waiting to retry", conflict:"Date conflict — company review required" };
  return <div className="enquiry-step demo-result" aria-live="polite">
    <h2 tabIndex={-1}>Demonstration request saved</h2><p>Your original signed demonstration was stored privately. Company work proposals and confirmation status are shown below. This demonstration is not a real booking or a binding contract.</p>
    <dl className="enquiry-review"><div><dt>Reference</dt><dd>{submission.reference}</dd></div><div><dt>Preferred date</dt><dd>{dateLabel(submission.preferredDate)} (Sydney)</dd></div><div><dt>Email</dt><dd>{emails[submission.emailStatus]}</dd></div><div><dt>Google Calendar</dt><dd>{calendars[submission.calendarStatus]}</dd></div><div><dt>Original request</dt><dd>Preferred date only · see company work review below</dd></div></dl>
    {submission.emailStatus === "provider_accepted" && <p className="enquiry-hint">Email provider acceptance is not proof of delivery to the inbox. Check the company inbox and spam folder.</p>}
    {submission.calendarStatus === "synced" && <p className="enquiry-notice">The original calendar entry marks a preferred start date only. Confirmed demonstration work segments, when available, are listed separately below.</p>}
    {submission.error && <p className="enquiry-error">{submission.error}</p>}{statusError && <p className="enquiry-error" role="alert">{statusError}</p>}
    <button type="button" className="enquiry-button enquiry-button-secondary" disabled={checking} onClick={onRefresh}>{checking ? "Checking…" : "Refresh delivery status"}</button>
    <p className="enquiry-hint">Do not submit another request to retry email or calendar delivery. The saved request keeps the same reference.</p>
  </div>;
}

export function DemoQuoteFlow({ draft, recipientEmail, initialSubmission, onEdit, onProgress }: { draft: QuoteDraft; recipientEmail: string; initialSubmission: DemoSubmissionStatus | null; onEdit: () => void; onProgress: (step: number) => void }) {
  const [stage,setStage] = useState<"approve"|"date"|"review">("approve");
  const [approved,setApproved] = useState(false);
  const [month,setMonth] = useState(() => todayInSydney().slice(0,7));
  const [availability,setAvailability] = useState<Availability|null>(null);
  const [availabilityStale,setAvailabilityStale] = useState(false);
  const [preferredDate,setPreferredDate] = useState("");
  const [review,setReview] = useState<Review|null>(null);
  const [name,setName] = useState("");
  const [strokes,setStrokes] = useState<SignaturePoint[][]>([]);
  const [acknowledged,setAcknowledged] = useState(false);
  const [submission,setSubmission] = useState(initialSubmission);
  const [busy,setBusy] = useState(false);
  const [checking,setChecking] = useState(false);
  const [uncertain,setUncertain] = useState(false);
  const [error,setError] = useState("");
  const [statusError,setStatusError] = useState("");
  const headingRef = useRef<HTMLDivElement>(null);
  const statusRequest = useRef(false);
  const sendAttempt = useRef<{body:string}|null>(null);
  const monthRequest = useRef(0);
  const firstMonth = todayInSydney().slice(0,7), lastMonth = shiftMonth(firstMonth,3);
  const recipientMatches = draft.payload.contact.email.toLowerCase() === recipientEmail.toLowerCase();
  function focusHeading() { window.requestAnimationFrame(() => headingRef.current?.focus()); }
  useEffect(() => { headingRef.current?.focus(); },[]);
  function clearSignature() { setName(""); setStrokes([]); setAcknowledged(false); setReview(null); sendAttempt.current = null; }
  function changeStage(next: typeof stage) { clearSignature(); setError(""); setStage(next); onProgress(next === "approve" ? 2 : next === "date" ? 3 : 4); focusHeading(); }
  async function loadMonth(value: string) {
    const version = ++monthRequest.current;
    setMonth(value); setAvailability(null); setAvailabilityStale(false); setPreferredDate(""); clearSignature(); setBusy(true); setError("");
    try { const result = parseAvailability(await request(`/api/quote/availability?month=${encodeURIComponent(value)}`)); if (version === monthRequest.current) { setAvailability(result); setAvailabilityStale(Date.now() >= Date.parse(result.expiresAt)); } }
    catch (failure) { if (version === monthRequest.current) setError(failureMessage(failure)); }
    finally { if (version === monthRequest.current) setBusy(false); }
  }
  useEffect(() => {
    if (!availability) return;
    const delay = Date.parse(availability.expiresAt)-Date.now();
    const timer = window.setTimeout(() => setAvailabilityStale(true),Math.max(0,delay));
    return () => window.clearTimeout(timer);
  },[availability]);
  async function refreshStatus() {
    if (statusRequest.current) return;
    statusRequest.current = true; setChecking(true); setStatusError("");
    try { const result = parseSubmission((await request("/api/quote/submission")).submission); if (result) { setSubmission(result); setUncertain(false); onProgress(5); } else if (uncertain) setStatusError("No saved request is visible yet. Retry the same submission below; do not change the signed details."); }
    catch (failure) { setStatusError(failureMessage(failure)); }
    finally { statusRequest.current = false; setChecking(false); }
  }
  useEffect(() => {
    if (!submission || !pending(submission)) return;
    let active = true;
    const timer = window.setInterval(() => {
      if (statusRequest.current) return;
      statusRequest.current = true;
      request("/api/quote/submission").then(value => { if (active) { const latest = parseSubmission(value.submission); if (latest) { setSubmission(latest); setStatusError(""); } } }).catch(failure => { if (active) setStatusError(failureMessage(failure)); }).finally(() => { statusRequest.current = false; });
    },5000);
    return () => { active = false; window.clearInterval(timer); };
  },[submission]);
  async function prepareReview() {
    if (!availability || !preferredDate || availabilityStale || !approved || busy) return;
    setBusy(true); setError(""); clearSignature();
    try {
      const result = parseReview(await request("/api/quote/review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:draft.revision,preferredDate,availabilityRevision:availability.revision})}),draft,preferredDate);
      setReview(result); setStage("review"); onProgress(4); focusHeading();
    } catch (failure) { setAvailabilityStale(true); setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!review || busy) return;
    if (!sendAttempt.current) {
      const points = strokes.flat();
      if (name.trim().length < 2 || !acknowledged || points.length < 4 || Math.max(Math.max(...points.map(point => point.x))-Math.min(...points.map(point => point.x)), Math.max(...points.map(point => point.y))-Math.min(...points.map(point => point.y))) < .02) { setError("Enter your full name, draw a signature and acknowledge the demonstration terms before submitting."); return; }
      const signature: DemoSignature = {name:name.trim(),strokes,acknowledged:true};
      sendAttempt.current = {body:JSON.stringify({reviewToken:review.reviewToken,idempotencyKey:crypto.randomUUID(),signature})};
    }
    setBusy(true); setError(""); setStatusError(""); setUncertain(true);
    try {
      const result = parseSubmission((await request("/api/quote/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:sendAttempt.current.body})).submission);
      if (!result) throw new Error("The server has not confirmed your submission. Check its status or retry the same request.");
      setSubmission(result); setUncertain(false); onProgress(5); focusHeading();
    } catch (failure) {
      // A rejected request can be corrected. A missing/ambiguous response keeps the
      // exact signed body and idempotency key so retry cannot create a second request.
      if (failure instanceof DemoRequestError && [400,403,409,422].includes(failure.status)) {
        setUncertain(false); sendAttempt.current = null;
        if (failure.status === 409) { clearSignature(); setAvailabilityStale(true); setStage("date"); onProgress(3); focusHeading(); }
      }
      setError(failureMessage(failure));
    }
    finally { setBusy(false); }
  }
  if (submission) return <div ref={headingRef} tabIndex={-1} className="enquiry-step"><SubmissionResult submission={submission} statusError={statusError} onRefresh={() => void refreshStatus()} checking={checking} /><CustomerBookingReview submissionId={submission.id} /></div>;
  return <div className="enquiry-step" ref={headingRef} tabIndex={-1}>
    {error && <p className="enquiry-error-box" role="alert">{error}</p>}
    {stage === "approve" && <>
      <h2>3. Approve the demonstration quote</h2>
      <p>Your service details are saved. Photo upload and AI assessment have not been performed. The amount below is fixed demonstration data.</p>
      <p className="demo-price">{MONEY_FORMAT.format(DEMO_PRICE.totalCents/100)} <span>{DEMO_PRICE.currency} · DEMO ONLY</span></p><p>{DEMO_PRICE.label}</p>
      <div className="demo-terms"><h3>Demonstration terms</h3><ul>{DEMO_TERMS.map(term => <li key={term}>{term}</li>)}</ul></div>
      <p className="enquiry-notice">Trial emails can only be sent to {recipientEmail}. Your saved email is {draft.payload.contact.email}.{!recipientMatches && " Edit your details to use the company trial address before continuing."}</p>
      <label className="enquiry-confirm"><input type="checkbox" checked={approved} onChange={event => { setApproved(event.target.checked); clearSignature(); }} /> I approve this demonstration summary only. I understand this is not a real quote, contract or confirmed booking.</label>
      <div className="enquiry-actions"><button type="button" className="enquiry-button enquiry-button-secondary" onClick={onEdit}>Edit saved details</button><button type="button" className="enquiry-button" disabled={!approved || !recipientMatches || busy} onClick={() => { changeStage("date"); void loadMonth(month); }}>Approve demo and choose date</button></div>
    </>}
    {stage === "date" && <>
      <h2>4. Choose a preferred start date</h2><p>Dates already occupied in the company calendar cannot be selected. A selectable date is a preference only: the company must still review the full duration and confirm availability.</p>
      <div className="demo-calendar-nav"><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || month <= firstMonth} aria-label="Previous month" onClick={() => void loadMonth(shiftMonth(month,-1))}>←</button><h3>{new Intl.DateTimeFormat("en-AU",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T12:00:00Z`))}</h3><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || month >= lastMonth} aria-label="Next month" onClick={() => void loadMonth(shiftMonth(month,1))}>→</button></div>
      {busy && <p role="status">Checking company calendar…</p>}
      <div className="demo-calendar" aria-label="Preferred start date, Sydney time">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => <span className="demo-weekday" key={day} aria-hidden="true">{day}</span>)}
        {Array.from({length:(new Date(`${month}-01T12:00:00Z`).getUTCDay()+6)%7},(_,index) => <span key={`blank-${index}`} />)}
        {availability?.days.map(day => <button type="button" key={day.date} disabled={busy || !day.selectable || availabilityStale} aria-pressed={preferredDate === day.date} aria-label={`${dateLabel(day.date)}${day.reason === "busy" ? ", unavailable: booked" : !day.selectable ? ", unavailable" : availabilityStale ? ", refresh required" : ", available to request"}`} title={day.reason === "busy" ? "Already booked" : !day.selectable ? "Unavailable" : "Preferred date only"} onClick={() => { setPreferredDate(day.date); clearSignature(); setError(""); }}>{Number(day.date.slice(8))}{day.reason === "busy" && <span>Booked</span>}</button>)}
      </div>
      {availabilityStale && <p className="enquiry-notice" role="status">The availability check expired or changed. Refresh the calendar and choose the date again.</p>}
      {availability && !availability.days.some(day => day.selectable) && <p>No dates are currently available to request in this month.</p>}
      {preferredDate && <p role="status">Preferred date: <strong>{dateLabel(preferredDate)}</strong> (Sydney).</p>}
      <button type="button" className="enquiry-button enquiry-button-secondary demo-refresh" disabled={busy} onClick={() => void loadMonth(month)}>Refresh availability</button>
      <div className="enquiry-actions"><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy} onClick={() => changeStage("approve")}>Back to demo quote</button><button type="button" className="enquiry-button" disabled={busy || !preferredDate || availabilityStale} onClick={() => void prepareReview()}>{busy ? "Checking…" : "Continue to review and sign"}</button></div>
    </>}
    {stage === "review" && review && <>
      <h2>5. Final review and demonstration signature</h2><p>Check this saved summary before signing. Changing the details or preferred date requires a new review and signature.</p>
      <SnapshotSummary snapshot={review.snapshot} />
      <label>Full name for your signature *<input autoComplete="name" maxLength={120} value={name} disabled={busy || uncertain} onChange={event => setName(event.target.value)} /></label>
      <SignaturePad strokes={strokes} onChange={setStrokes} disabled={busy || uncertain} />
      <label className="enquiry-confirm"><input type="checkbox" checked={acknowledged} disabled={busy || uncertain} onChange={event => setAcknowledged(event.target.checked)} /> I have reviewed the details and demonstration terms above. My signature acknowledges this demo only. Submitting will email the signed demonstration to {recipientEmail} and request a pending calendar entry.</label>
      {uncertain && <div className="enquiry-notice"><p>Your submission was attempted. Keep these signed details unchanged while its saved status is checked. Retrying uses the same request.</p><button type="button" className="enquiry-button enquiry-button-secondary" disabled={checking || busy} onClick={() => void refreshStatus()}>{checking ? "Checking…" : "Check saved submission"}</button>{statusError && <p role="status">{statusError}</p>}</div>}
      <div className="enquiry-actions"><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || uncertain} onClick={() => changeStage("date")}>Change preferred date</button><button type="button" className="enquiry-button" disabled={busy || (!uncertain && (!acknowledged || !name.trim() || !strokes.length))} onClick={() => void submit()}>{busy ? "Submitting…" : uncertain ? "Retry same submission" : "Submit signed demo"}</button></div>
      <p className="enquiry-hint">The signed summary is saved first. Email acceptance is followed by automatic company Calendar saving. No payment is due.</p>
    </>}
  </div>;
}
