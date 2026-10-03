"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingDetail, BookingProposal, BookingSummary } from "../domain/contracts";
import { BookingRequestError, bookingPost, bookingRequest, requestMessage, SignaturePreview, statusLabel, sydneyInput, sydneyTime } from "./booking-ui";
import "./bookings.css";

type SegmentInput = { startLocal: string; endLocal: string };
const emptySegment = (): SegmentInput => ({startLocal:"",endLocal:""});
type BookingCalendarChange = {id:string;kind:"move"|"delete"|"invalid";segment_id:string;proposed_start_at:string|null;proposed_end_at:string|null;created_at:string;booking_revision:number};
function bookingLabel(detail: Pick<BookingSummary,"status"|"syncStatus"|"pendingProposalId"|"confirmedProposalId">) {
  if (detail.syncStatus === "review_required") return "Review required — existing occupancy preserved";
  if (detail.confirmedProposalId && detail.pendingProposalId && detail.pendingProposalId!==detail.confirmedProposalId) return "Existing demo schedule preserved · revised proposal awaiting confirmation";
  if (detail.status === "confirmed" && detail.syncStatus === "synced") return "Demo confirmed · Google verified";
  if (detail.status === "confirmed") return "Confirmation saved · Google verification pending";
  return "Request only · awaiting company confirmation";
}
export function BookingSegments({ proposal }: { proposal: BookingProposal }) {
  return <ol className="booking-segments">{proposal.segments.map((segment,index) => <li key={segment.id}><strong>Work segment {index+1}</strong>{sydneyTime(segment.startAt)} → {sydneyTime(segment.endAt)} (Sydney)<br /><span className="operations-small">{Math.round((Date.parse(segment.endAt)-Date.parse(segment.startAt))/60_000)} minutes of actual work occupancy</span></li>)}</ol>;
}
function PdfLinks({ submissionId, proposal }: { submissionId: string; proposal?: BookingProposal }) {
  const base = `/api/operations/bookings/${encodeURIComponent(submissionId)}/documents/`;
  const query = proposal ? `?proposalId=${encodeURIComponent(proposal.id)}` : "";
  return <div className="booking-actions"><a className="operations-button operations-button-secondary" href={`${base}quote${query}`} target="_blank" rel="noopener noreferrer">Download {proposal ? "reconfirmed " : ""}demo quote PDF</a><a className="operations-button operations-button-secondary" href={`${base}agreement${query}`} target="_blank" rel="noopener noreferrer">Download signed demo terms PDF</a></div>;
}
function OriginalSubmission({ detail }: { detail: BookingDetail }) {
  const {submission} = detail, {contact,service} = submission.snapshot.payload;
  return <details className="booking-history" open><summary>Original signed submission · preserved</summary>
    <dl className="booking-definition"><div><dt>Submitted</dt><dd>{sydneyTime(submission.submittedAt)} (Sydney)</dd></div><div><dt>Customer</dt><dd>{contact.name} · {contact.email} · {contact.phone || "No phone"}</dd></div><div><dt>Site</dt><dd>{contact.siteAddress}, {contact.suburb} {contact.postcode}</dd></div><div><dt>Project</dt><dd>{contact.details || "Not provided"}</dd></div><div><dt>Service</dt><dd>Kitchen Cabinet Painting · {statusLabel(service?.intent)}</dd></div><div><dt>Surfaces</dt><dd>{service?.surfaces.join(", ")}</dd></div><div><dt>Doors / drawers</dt><dd>{service?.doorCount ?? "Unknown"} / {service?.drawerCount ?? "Unknown"}</dd></div><div><dt>Material / finish</dt><dd>{service?.material || "Unknown"} / {service?.colourPreference || "Not specified"}</dd></div><div><dt>Preferred start</dt><dd>{submission.snapshot.preferredDate} · date preference only</dd></div><div><dt>Sample amount</dt><dd>{new Intl.NumberFormat("en-AU",{style:"currency",currency:submission.snapshot.price.currency}).format(submission.snapshot.price.totalCents/100)} · {submission.snapshot.price.label}</dd></div><div><dt>Original email</dt><dd>{statusLabel(submission.emailStatus)} · provider acceptance does not prove inbox delivery</dd></div><div><dt>Original Calendar request</dt><dd>{statusLabel(submission.calendarStatus)} · transparent request marker</dd></div></dl>
    <ul>{submission.snapshot.terms.map(term => <li key={term}>{term}</li>)}</ul>
    <SignaturePreview name={submission.signature.name} strokes={submission.signature.strokes} label="Original demonstration signature" />
    <PdfLinks submissionId={submission.id} /><p className="operations-small">PDF downloads are private derivatives of this signed version. Downloading does not resend or change any previously sent document.</p>
  </details>;
}
function CalendarChangeReview({ submissionId }: {submissionId:string}) {
  const [changes,setChanges]=useState<BookingCalendarChange[]>([]), [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const load=()=>bookingRequest<{changes:BookingCalendarChange[]}>(`/api/operations/bookings/${submissionId}/changes`).then(result=>{if(active){setChanges(result.changes);setError("");}}).catch(failure=>{if(active)setError(requestMessage(failure));});
    void load();const timer=window.setInterval(()=>void load(),15_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[submissionId]);
  if(!changes.length&&!error)return null;
  return <section className="booking-history"><h4>Google changes awaiting review</h4>{error&&<p className="operations-error" role="alert">Change details could not be refreshed: {error}</p>}{changes.map(change=><div key={change.id} className="operations-notice"><p><strong>{statusLabel(change.kind)} · {change.segment_id}</strong> · received {sydneyTime(change.created_at)}</p><p>{change.kind==="delete"?"Google event was deleted. The previously confirmed work segment is still occupied in the app.":change.kind==="invalid"?"Google returned an unsupported or incomplete work time. No booking time was changed.":`Google proposed: ${sydneyTime(change.proposed_start_at)} → ${sydneyTime(change.proposed_end_at)} (Sydney).`}</p><p className="operations-small">Review these times against the preserved proposal above. Enter a revised full work proposal below and obtain a new customer signature before confirmation. A Google edit alone does not approve the new schedule.</p></div>)}</section>;
}
function ProposalEditor({ detail, disabled, onSaved }: { detail: BookingDetail; disabled: boolean; onSaved: (detail:BookingDetail)=>void }) {
  const [segments,setSegments] = useState<SegmentInput[]>([emptySegment()]);
  const [notes,setNotes] = useState("");
  const [revision,setRevision] = useState(detail.booking.revision);
  const [busy,setBusy] = useState(false), [uncertain,setUncertain] = useState(false);
  const [error,setError] = useState(""), [notice,setNotice] = useState("");
  const attempted = useRef<{expectedRevision:number;segments:SegmentInput[];notes:string;idempotencyKey:string}|null>(null);
  const stale = revision !== detail.booking.revision;
  const existing = detail.proposals.find(proposal => proposal.id === detail.booking.pendingProposalId) ?? detail.proposals.find(proposal => proposal.id === detail.booking.confirmedProposalId);
  function reloadVersion() { setRevision(detail.booking.revision); setUncertain(false); attempted.current = null; setError(""); setNotice("Current request version loaded. Your entered segments are preserved; review them before saving."); }
  async function save() {
    if (busy || disabled || (stale && !uncertain)) return;
    if (!attempted.current) {
      if (segments.some(segment => !segment.startLocal || !segment.endLocal || segment.endLocal <= segment.startLocal)) { setError("Enter a start and a later end for every work segment. Times are Sydney local time."); return; }
      attempted.current = {expectedRevision:revision,segments,notes,idempotencyKey:crypto.randomUUID()};
    }
    setBusy(true); setUncertain(true); setError(""); setNotice("");
    try {
      const result = await bookingPost<{detail:BookingDetail}>(`/api/operations/bookings/${detail.submission.id}/proposals`,attempted.current);
      onSaved(result.detail); setRevision(result.detail.booking.revision); setSegments([emptySegment()]); setNotes(""); setUncertain(false); attempted.current = null;
      setNotice("New work proposal saved. The customer must review and sign these exact segments before company confirmation.");
    } catch (failure) {
      if (failure instanceof BookingRequestError && [400,403,409,422].includes(failure.status)) { setUncertain(false); attempted.current = null; }
      setError(requestMessage(failure));
    } finally { setBusy(false); }
  }
  return <section className="operations-schedule"><h4>Create a work proposal</h4><p>Enter each actual work segment manually. No working hours or duration are assumed. Gaps between segments do not occupy the test resource. Every new version requires a new customer signature.</p>
    <p className="operations-small">Resource: single company test resource · DEMO ONLY. This is not an approved staffing or working-hours policy.</p>
    {stale && <div className="operations-error" role="alert">This booking changed. Your entered times are preserved. Load its current version before making a new proposal.<button type="button" className="operations-button-secondary" disabled={busy || disabled || uncertain} onClick={reloadVersion}>Load current version</button></div>}
    {error && <p className="operations-error" role="alert">{error}</p>}{notice && <p className="operations-notice" role="status">{notice}</p>}
    {segments.map((segment,index) => <fieldset className="booking-segment-editor" key={index} disabled={busy || disabled || uncertain}><legend>Work segment {index+1}</legend><div className="operations-grid"><label>Start (Sydney)<input type="datetime-local" value={segment.startLocal} onChange={event => setSegments(current => current.map((item,itemIndex) => itemIndex === index ? {...item,startLocal:event.target.value} : item))} /></label><label>End (Sydney)<input type="datetime-local" value={segment.endLocal} onChange={event => setSegments(current => current.map((item,itemIndex) => itemIndex === index ? {...item,endLocal:event.target.value} : item))} /></label></div><button type="button" className="operations-button-secondary" disabled={segments.length === 1} onClick={() => setSegments(current => current.filter((_,itemIndex) => itemIndex !== index))}>Remove segment {index+1}</button></fieldset>)}
    <div className="booking-actions"><button type="button" className="operations-button-secondary" disabled={busy || disabled || uncertain || segments.length >= 20} onClick={() => setSegments(current => [...current,emptySegment()])}>Add work segment</button>{existing && <button type="button" className="operations-button-secondary" disabled={busy || disabled || uncertain} onClick={() => { setSegments(existing.segments.map(segment => ({startLocal:sydneyInput(segment.startAt),endLocal:sydneyInput(segment.endAt)}))); setNotes(existing.notes); }}>Copy previous proposal times</button>}</div>
    <label>Notes shown to the customer<textarea rows={3} maxLength={2000} value={notes} disabled={busy || disabled || uncertain} onChange={event => setNotes(event.target.value)} /></label>
    {uncertain && <p className="operations-notice">The save outcome is being checked. Retry keeps exactly the same proposal and request key. Refresh the request before deciding it was not saved.</p>}
    <button type="button" disabled={busy || disabled || (stale && !uncertain)} onClick={() => void save()}>{busy ? "Saving proposal…" : uncertain ? "Retry same proposal" : "Save new proposal for customer review"}</button>
  </section>;
}
function BookingDetailPanel({ detail, onSaved, onRefresh, refreshing }: { detail:BookingDetail; onSaved:(detail:BookingDetail)=>void; onRefresh:()=>void; refreshing:boolean }) {
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const confirmAttempt = useRef<{expectedRevision:number;proposalId:string;idempotencyKey:string}|null>(null);
  const current = detail.proposals.find(proposal => proposal.id === detail.booking.pendingProposalId) ?? detail.proposals.find(proposal => proposal.id === detail.booking.confirmedProposalId);
  const confirmed = detail.proposals.find(proposal => proposal.id === detail.booking.confirmedProposalId);
  const canConfirm = current && current.signature && current.emailStatus === "provider_accepted" && !current.confirmedAt && current.id !== detail.booking.confirmedProposalId;
  async function confirm() {
    if (!current || busy) return;
    confirmAttempt.current ??= {expectedRevision:detail.booking.revision,proposalId:current.id,idempotencyKey:crypto.randomUUID()};
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await bookingPost<{detail:BookingDetail}>(`/api/operations/bookings/${detail.submission.id}/confirm`,confirmAttempt.current);
      onSaved(result.detail); confirmAttempt.current = null;
      setNotice(result.detail.booking.status === "confirmed" && result.detail.booking.syncStatus === "synced" ? "Demo confirmation and Google verification are complete." : "Confirmation command saved. Wait for the Google verification status before treating this demonstration as confirmed.");
    } catch (failure) { if (failure instanceof BookingRequestError && [400,403,409,422].includes(failure.status)) confirmAttempt.current = null; setError(requestMessage(failure)); }
    finally { setBusy(false); }
  }
  return <article className="booking-detail"><div className="bookings-header"><div><h3>{detail.submission.reference}</h3><p>{bookingLabel(detail.booking)}</p></div><button type="button" className="operations-button-secondary" disabled={busy || refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh this request"}</button></div>
    <p className="operations-small">Booking revision {detail.booking.revision} · All times below are Australia/Sydney. Submission and signed proposal versions are read-only.</p>
    {error && <p className="operations-error" role="alert">{error}</p>}{notice && <p className="operations-notice" role="status">{notice}</p>}
    {detail.booking.syncStatus === "review_required" && <p className="operations-error">Google changed or could not verify an accepted work segment. Existing occupied segments remain protected. Review the exact changes and create a revised proposal for customer reconfirmation; do not use the legacy schedule controls.</p>}
    <OriginalSubmission detail={detail} />
    {confirmed && confirmed.id!==current?.id && <details className="booking-history" open><summary>Existing confirmed segments · remain occupied during proposal review</summary><BookingSegments proposal={confirmed} /></details>}
    <CalendarChangeReview submissionId={detail.submission.id} />
    {current ? <section><h4>Current work proposal · revision {current.revision}</h4><BookingSegments proposal={current} /><p>{current.notes || "No additional notes."}</p><dl className="booking-definition"><div><dt>Customer reconfirmation</dt><dd>{current.signature ? `Signed by ${current.signature.name} · ${sydneyTime(current.consentedAt)}` : "Required — not signed"}</dd></div><div><dt>Reconfirmation email</dt><dd>{statusLabel(current.emailStatus)}{current.emailError && ` · ${current.emailError}`}</dd></div><div><dt>Company confirmation</dt><dd>{current.confirmedAt || current.id === detail.booking.confirmedProposalId ? bookingLabel(detail.booking) : "Not yet confirmed"}</dd></div></dl>
      {current.signature && <><SignaturePreview name={current.signature.name} strokes={current.signature.strokes} label={`Proposal ${current.revision} demonstration signature`} /><PdfLinks submissionId={detail.submission.id} proposal={current} /></>}
      {!current.signature && <p className="operations-notice">Open the original customer browser at <a href="/quote/start?service=cabinet-painting" target="_blank" rel="noopener noreferrer">the quote page</a> to review and sign this work proposal. The demo browser cookie is not customer identity verification.</p>}
      <button type="button" disabled={busy || !canConfirm} onClick={() => void confirm()}>{busy ? "Checking all segments…" : "Check conflicts and confirm demo"}</button><p className="operations-small">Enabled only after customer signature and email provider acceptance. The server checks all work segments against current Google busy and app occupancy. Google verification may remain pending.</p>
    </section> : <p>No work proposal exists yet. Enter the actual work segments below.</p>}
    <ProposalEditor detail={detail} disabled={busy} onSaved={onSaved} />
    {detail.proposals.length > 1 && <details className="booking-history"><summary>Previous proposal versions ({detail.proposals.length-1})</summary>{detail.proposals.filter(proposal => proposal.id !== current?.id).map(proposal => <section key={proposal.id}><h4>Proposal {proposal.revision} · {sydneyTime(proposal.createdAt)}</h4><BookingSegments proposal={proposal} /><p>{proposal.notes || "No notes"}</p><p>{proposal.signature ? `Signed by ${proposal.signature.name} on ${sydneyTime(proposal.consentedAt)}.` : "Not signed."} Email: {statusLabel(proposal.emailStatus)}.</p>{proposal.signature && <><SignaturePreview name={proposal.signature.name} strokes={proposal.signature.strokes} label={`Preserved proposal ${proposal.revision} signature`} /><PdfLinks submissionId={detail.submission.id} proposal={proposal} /></>}</section>)}</details>}
  </article>;
}
export function BookingOperationsPanel({ refreshKey }: {refreshKey?:string}) {
  const [bookings,setBookings] = useState<BookingSummary[]>([]), [detail,setDetail] = useState<BookingDetail|null>(null);
  const [loading,setLoading] = useState(true), [refreshing,setRefreshing] = useState(false), [error,setError] = useState("");
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const requestVersion = useRef(0);
  const loadList = useCallback(async () => {
    const result = await bookingRequest<{bookings:BookingSummary[]}>("/api/operations/bookings"); setBookings(result.bookings);
  },[]);
  useEffect(() => { let active = true; bookingRequest<{bookings:BookingSummary[]}>("/api/operations/bookings").then(result => { if(active) {setBookings(result.bookings);setError("");} }).catch(failure => {if(active)setError(requestMessage(failure));}).finally(() => {if(active)setLoading(false);}); return () => {active=false;}; },[refreshKey]);
  useEffect(() => {
    if(!selectedId)return;
    let active=true;
    const timer=window.setInterval(() => {
      if(refreshing)return;
      const version=++requestVersion.current;
      bookingRequest<{detail:BookingDetail}>(`/api/operations/bookings/${selectedId}`).then(result => {if(active&&version===requestVersion.current)setDetail(result.detail);}).catch(failure=>{if(active&&version===requestVersion.current)setError(requestMessage(failure));});
    },15_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[selectedId,refreshing]);
  async function select(id:string) {
    const version = ++requestVersion.current; setSelectedId(id); setRefreshing(true);setError("");
    if(detail?.submission.id !== id)setDetail(null);
    try { const result = await bookingRequest<{detail:BookingDetail}>(`/api/operations/bookings/${id}`); if(version===requestVersion.current)setDetail(result.detail); }
    catch(failure) {if(version===requestVersion.current)setError(requestMessage(failure));}
    finally {if(version===requestVersion.current)setRefreshing(false);}
  }
  function saved(value:BookingDetail) { requestVersion.current++; setDetail(value); void loadList().catch(failure => setError(requestMessage(failure))); }
  return <section className="operations-panel bookings-panel" id="signed-demo-requests"><div className="bookings-header"><h2>Signed demo requests and company confirmation</h2><button type="button" className="operations-button-secondary" disabled={loading || refreshing} onClick={() => { setError("");void loadList().catch(failure => setError(requestMessage(failure))); }}>Refresh signed requests</button></div><p className="booking-demo-note">Company-only demonstration. Review the immutable signed request, propose actual work segments, obtain a new signature, then check conflicts and confirm. Sample prices and terms do not authorise real work.</p>
    {error && <p className="operations-error" role="alert">{error}</p>}{loading && <p role="status">Loading signed requests…</p>}
    {!loading && !bookings.length && !error && <p>No signed demo submissions are available.</p>}
    {bookings.length > 0 && <div className="bookings-layout"><ul className="operations-list operations-inbox">{bookings.map(booking => <li key={booking.id}><button type="button" className={selectedId===booking.id ? "selected" : ""} aria-pressed={selectedId===booking.id} onClick={() => void select(booking.id)}><strong>{booking.reference}</strong><span>{booking.clientName}</span><span>Preferred: {booking.preferredDate}</span><span>{bookingLabel(booking)}</span></button></li>)}</ul><div>{refreshing && <p role="status">Loading the saved request…</p>}{detail ? <BookingDetailPanel key={detail.submission.id} detail={detail} onSaved={saved} onRefresh={() => void select(detail.submission.id)} refreshing={refreshing} /> : <p>Select a signed request to review its details.</p>}</div></div>}
  </section>;
}
