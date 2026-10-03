"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SignaturePad, type SignaturePoint } from "@/shared/ui/signature-pad";
import type { BookingDetail, BookingProposal } from "../domain/contracts";
import { BookingRequestError, bookingPost, bookingRequest, requestMessage, SignaturePreview, statusLabel, sydneyTime, validDrawnSignature } from "./booking-ui";
import "./bookings.css";

function CustomerPdfLinks({ proposal }: {proposal?:BookingProposal}) {
  const query = proposal ? `?proposalId=${encodeURIComponent(proposal.id)}` : "";
  return <div className="booking-actions"><a className="enquiry-button enquiry-button-secondary" href={`/api/quote/booking/documents/quote${query}`} target="_blank" rel="noopener noreferrer">Download {proposal ? "reconfirmed " : "original "}demo quote PDF</a><a className="enquiry-button enquiry-button-secondary" href={`/api/quote/booking/documents/agreement${query}`} target="_blank" rel="noopener noreferrer">Download signed demo terms PDF</a></div>;
}
function ProposalTerms({ proposal }: {proposal:BookingProposal}) {
  const {submission} = proposal.snapshot, {contact,service} = submission.payload;
  return <>
    <dl className="booking-definition"><div><dt>Request</dt><dd>{proposal.snapshot.reference} · work proposal {proposal.revision}</dd></div><div><dt>Customer</dt><dd>{contact.name} · {contact.email}</dd></div><div><dt>Phone</dt><dd>{contact.phone || "Not provided"}</dd></div><div><dt>Site</dt><dd>{contact.siteAddress}, {contact.suburb} {contact.postcode}</dd></div><div><dt>Service</dt><dd>Kitchen Cabinet Painting · {statusLabel(service?.intent)} · {service?.surfaces.join(", ")}</dd></div><div><dt>Quantity / finish</dt><dd>{service?.doorCount ?? "Unknown"} doors · {service?.drawerCount ?? "Unknown"} drawer fronts · {service?.material || "Material unknown"} · {service?.colourPreference || "Finish not specified"}</dd></div><div><dt>Project details</dt><dd>{contact.details || "Not provided"}</dd></div><div><dt>Original preferred date</dt><dd>{submission.preferredDate} · replaced for this proposal by the exact segments below</dd></div><div><dt>Demonstration amount</dt><dd>{new Intl.NumberFormat("en-AU",{style:"currency",currency:submission.price.currency}).format(submission.price.totalCents/100)} · {submission.price.label}</dd></div></dl>
    <div><h3>Exact proposed work segments · Australia/Sydney</h3><ol className="booking-segments">{proposal.snapshot.segments.map((segment,index) => <li key={segment.id}><strong>Segment {index+1}</strong>{sydneyTime(segment.startAt)} → {sydneyTime(segment.endAt)} (Sydney)<br />{Math.round((Date.parse(segment.endAt)-Date.parse(segment.startAt))/60_000)} minutes</li>)}</ol><p>Only these work segments occupy the single test resource. Gaps between segments are not working time.</p></div>
    <p><strong>Company notes:</strong> {proposal.snapshot.notes || "None"}</p>
    <ul className="booking-terms">{submission.terms.map(term => <li key={term}>{term}</li>)}</ul>
    <p className="booking-demo-note">This new signature acknowledges the exact proposed segments and sample terms above. It preserves your earlier signature separately. This is a company-only demonstration, not a real contract or authorisation for work.</p>
  </>;
}
function ProposalConsent({ proposal, onSaved, onRefresh }: {proposal:BookingProposal;onSaved:(detail:BookingDetail)=>void;onRefresh:()=>void}) {
  const [name,setName] = useState(""), [strokes,setStrokes] = useState<SignaturePoint[][]>([]), [acknowledged,setAcknowledged] = useState(false);
  const [busy,setBusy] = useState(false), [uncertain,setUncertain] = useState(false), [error,setError] = useState("");
  const attempt = useRef<{proposalId:string;snapshotHash:string;idempotencyKey:string;signature:{name:string;strokes:SignaturePoint[][];acknowledged:true}}|null>(null);
  async function consent() {
    if (busy) return;
    if (!attempt.current) {
      if (name.trim().length < 2 || !acknowledged || !validDrawnSignature(strokes)) {setError("Enter your full name, draw your new signature and confirm the demonstration acknowledgement.");return;}
      attempt.current = {proposalId:proposal.id,snapshotHash:proposal.snapshotHash,idempotencyKey:crypto.randomUUID(),signature:{name:name.trim(),strokes,acknowledged:true}};
    }
    setBusy(true);setUncertain(true);setError("");
    try { const result = await bookingPost<{detail:BookingDetail}>("/api/quote/booking/consent",attempt.current);onSaved(result.detail);setUncertain(false);attempt.current=null; }
    catch(failure) {
      if(failure instanceof BookingRequestError && [400,403,409,422].includes(failure.status)) {setUncertain(false);attempt.current=null;if(failure.status===409){setName("");setStrokes([]);setAcknowledged(false);onRefresh();}}
      setError(requestMessage(failure));
    } finally {setBusy(false);}
  }
  return <>
    <ProposalTerms proposal={proposal} />
    {proposal.signature ? <><p className="enquiry-notice" role="status">This work proposal was signed by {proposal.signature.name} on {sydneyTime(proposal.consentedAt)} (Sydney). Company conflict checking and Google verification are separate steps.</p><SignaturePreview name={proposal.signature.name} strokes={proposal.signature.strokes} label={`Saved proposal ${proposal.revision} signature`} /><p>Email: {statusLabel(proposal.emailStatus)}. Provider acceptance is not proof of inbox delivery.</p>{proposal.emailError && <p className="enquiry-error">{proposal.emailError}</p>}<CustomerPdfLinks proposal={proposal} /></> : <>
      <label>Full name for this new signature *<input autoComplete="name" maxLength={120} value={name} disabled={busy || uncertain} onChange={event=>setName(event.target.value)} /></label>
      <SignaturePad strokes={strokes} onChange={setStrokes} disabled={busy || uncertain} />
      <label className="enquiry-confirm"><input type="checkbox" checked={acknowledged} disabled={busy || uncertain} onChange={event=>setAcknowledged(event.target.checked)} /> I reviewed every proposed work segment, the notes and demonstration terms above. My new signature confirms this demonstration version only. It will be saved and emailed to the company trial address; company confirmation is still required.</label>
      {error && <p className="enquiry-error-box" role="alert">{error}</p>}
      {uncertain && <p className="enquiry-notice">The result is being checked. Keep the signed version unchanged. Retrying sends the same request, so it cannot create a second acknowledgement.</p>}
      <div className="booking-actions"><button type="button" className="enquiry-button" disabled={busy || (!uncertain && (!acknowledged || !name.trim() || !strokes.length))} onClick={()=>void consent()}>{busy ? "Saving your acknowledgement…" : uncertain ? "Retry same acknowledgement" : "Sign and approve this demo schedule"}</button>{uncertain && <button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy} onClick={onRefresh}>Check saved acknowledgement</button>}</div>
    </>}
  </>;
}
export function CustomerBookingReview({submissionId}:{submissionId:string}) {
  const [detail,setDetail] = useState<BookingDetail|null>(null), [loading,setLoading] = useState(true), [checking,setChecking] = useState(false), [error,setError] = useState("");
  const requestGeneration = useRef(0);
  const invalidateRequests = useCallback(() => { requestGeneration.current++; },[]);
  const refresh = useCallback(() => {
    const generation=++requestGeneration.current;
    return bookingRequest<{detail:BookingDetail|null}>("/api/quote/booking").then(result => {
      if(result.detail && result.detail.submission.id!==submissionId)throw new Error("This browser is linked to a different saved request. Reload the quote page before continuing.");
      if(generation===requestGeneration.current){setDetail(result.detail);setError("");}
    }).catch(failure => {if(generation===requestGeneration.current)setError(requestMessage(failure));})
      .finally(() => {if(generation===requestGeneration.current){setChecking(false);setLoading(false);}});
  },[submissionId]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),15_000);return()=>{window.clearInterval(timer);invalidateRequests();};},[refresh,invalidateRequests]);
  const current=detail?.proposals.find(proposal=>proposal.id===detail.booking.pendingProposalId) ?? detail?.proposals.find(proposal=>proposal.id===detail.booking.confirmedProposalId);
  const confirmed=detail?.proposals.find(proposal=>proposal.id===detail.booking.confirmedProposalId);
  const revisedProposal=Boolean(confirmed && current && confirmed.id!==current.id);
  const confirmedVerified=detail?.booking.status==="confirmed"&&detail.booking.syncStatus==="synced";
  const revisedMessage=current?.confirmedAt
    ? "Your revised demonstration schedule is signed and the company confirmation command is saved. Google verification is pending; previously confirmed segments remain protected until the new segments are verified."
    : current?.signature
      ? "Your revised demonstration schedule is signed. Company email processing and confirmation are pending; previously confirmed segments remain occupied."
      : "Your previously confirmed demonstration segments remain occupied. Review and sign the revised proposal below before company confirmation.";
  function saved(value:BookingDetail){requestGeneration.current++;setDetail(value);setError("");}
  return <section className="booking-consent enquiry-step" aria-labelledby="customer-booking-title"><div className="bookings-header"><h2 id="customer-booking-title">Company work proposal and reconfirmation</h2><button type="button" className="enquiry-button enquiry-button-secondary" disabled={checking} onClick={()=>{setChecking(true);void refresh();}}>{checking?"Checking…":"Refresh proposal"}</button></div>
    {loading && <p role="status">Loading company review status…</p>}{error && <p className="enquiry-error-box" role="alert">{error}</p>}
    {detail && <><p className="booking-demo-note" role="status">{detail.booking.syncStatus==="review_required"?"The work schedule needs company review. Existing occupied segments remain protected; a Google change is not automatic customer approval.":revisedProposal?revisedMessage:confirmedVerified?"Demonstration booking confirmed and verified in Google Calendar. This remains a company-only demo, not a real booking.":detail.booking.status==="confirmed"?"Company confirmation has been saved. Google verification is pending; final demonstration confirmation is not complete.":"Awaiting company proposal or confirmation. Your original signed request remains preserved."}</p>
      <details className="booking-history"><summary>Original signed demonstration documents</summary><CustomerPdfLinks /></details>
      {confirmed && current?.id!==confirmed.id && <details className="booking-history" open><summary>Previously confirmed work segments · preserved during review</summary><ol className="booking-segments">{confirmed.segments.map(segment=><li key={segment.id}>{sydneyTime(segment.startAt)} → {sydneyTime(segment.endAt)} (Sydney)</li>)}</ol></details>}
      {current ? <ProposalConsent key={`${current.id}:${current.snapshotHash}`} proposal={current} onSaved={saved} onRefresh={()=>void refresh()} /> : <p>The company has not proposed work times yet. Return here after the company adds the exact segments. Your original preferred date does not reserve a working period.</p>}
      <p className="booking-refresh-note">This page checks for a revised proposal every 15 seconds. A changed proposal requires a fresh review and signature. Access is limited to this original demonstration browser.</p>
    </>}
    {!loading&&!detail&&!error&&<p>No company work proposal is available for this signed request yet.</p>}
  </section>;
}
