'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ValidatedInput, reportSectionValidity } from '@/shared/ui/validated-input';
import { SignaturePad, type SignaturePoint } from '@/shared/ui/signature-pad';
import { COMPANY_REVISION_ACK_VERSION, type CompanyRevision, type CompanyRevisionState } from '../domain/company-revision';
import { validateBookingSignature } from '../domain/booking-flow';
import { NO_GST_NOTICE } from '../domain/pricing-display.ts';
import { createCustomerCompanyRevisionClient } from './customer-company-revision-client';
import { RevisionComparison, RevisionNotes, revisionEmailLabel, revisionMoney, revisionReceiptLabel } from './company-revision-parts';
import { displayTime } from './request-client';

type Client = ReturnType<typeof createCustomerCompanyRevisionClient>;
type WorkState = ReturnType<Client['client']['snapshot']>;
type Review = { proof: string; expiresAt: string; revisionId: string; snapshotHash: string };
const proofCodes = ['review_proof_expired', 'review_proof_invalid', 'review_owner_mismatch', 'review_required'];
const changedCodes = ['revision_snapshot_changed', 'revision_conflict', 'revision_not_published', 'idempotency_conflict', 'revision_acceptance_invalid'];

/**
 * Customer re-confirmation of a company revised quote. Opening this view never accepts anything:
 * acceptance needs a fresh review, an explicit tick of the exact statement and a new signature.
 */
export function CustomerCompanyRevision({ requestId, onAccessLost }: { requestId: string; onAccessLost: () => void }) {
  const [api] = useState<Client>(() => createCustomerCompanyRevisionClient(requestId));
  const [work, setWork] = useState<WorkState>(() => api.client.snapshot());
  const [review, setReview] = useState<Review | null>(null), [reviewing, setReviewing] = useState(false), [expired, setExpired] = useState(false);
  const [name, setName] = useState(''), [method, setMethod] = useState<'drawn' | 'typed'>('drawn'), [strokes, setStrokes] = useState<SignaturePoint[][]>([]), [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'notice'; text: string } | null>(null), [ended, setEnded] = useState(false);
  const alive = useRef(false), access = useRef(onAccessLost), heading = useRef<HTMLHeadingElement>(null), signLegend = useRef<HTMLLegendElement>(null), messageRef = useRef<HTMLDivElement>(null), signatureField = useRef<HTMLDivElement>(null);
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);
  // Focus targets that appear only after the next render (signing form, result panels, new status heading).
  const pendingFocus = useRef<{ current: HTMLElement | null } | null>(null);
  useEffect(() => { const target = pendingFocus.current?.current; if (target) { target.focus(); pendingFocus.current = null; } });
  const clearSigning = useCallback(() => { setReview(null); setName(''); setStrokes([]); setAgreed(false); setMethod('drawn'); }, []);
  const lost = useCallback(() => { api.client.clear(); clearSigning(); setEnded(true); setMessage(null); access.current(); }, [api, clearSigning]);
  const apply = useCallback((snapshot: WorkState) => { if (!alive.current) return false; if (snapshot.phase === 'access_lost') { lost(); return false; } setWork(snapshot); return true; }, [lost]);
  const load = useCallback(async () => { const read = api.detail(); setWork(api.client.snapshot()); const snapshot = await read; apply(snapshot); return snapshot.data; }, [api, apply]);
  useEffect(() => { alive.current = true; let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void load(); }); return () => { cancelled = true; alive.current = false; api.client.clear(); }; }, [api, load]);
  useEffect(() => { if (!review) return; const timer = setTimeout(() => { clearSigning(); setExpired(true); setMessage({ tone: 'notice', text: 'Your review session ended after 15 minutes, so the signature was cleared. Review the revised quote again to sign.' }); }, Math.max(0, Date.parse(review.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [review, clearSigning]);
  useEffect(() => { if (message?.tone === 'error') messageRef.current?.focus({ preventScroll: false }); }, [message]);

  const phase = work.phase, state = work.data as CompanyRevisionState | null, current = state?.current ?? null, accepted = state?.effectiveAccepted ?? null;
  const pending = api.client.pendingRequest(), saving = phase === 'saving', locked = saving || reviewing || phase === 'unknown' || Boolean(pending);
  if (ended || phase === 'access_lost') return <section className="lq-revision" aria-label="Revised quote"><p role="alert">Your verified access ended. Verify your email again to see the revised quote.</p></section>;
  if (!current) return phase === 'error' ? <section className="lq-revision" aria-label="Revised quote"><p className="lq-error" role="alert">{work.error ?? 'We could not check for a revised quote.'}</p><div className="lq-actions"><button type="button" className="secondary" onClick={() => void load()}>Check again</button></div></section> : null;

  async function startReview(revision: CompanyRevision) {
    if (!revision.snapshotHash || locked) return;
    setReviewing(true); setMessage(null); setExpired(false);
    try {
      const value = await api.review(revision.id, revision.snapshotHash);
      if (!alive.current) return;
      setReview({ proof: String(value.reviewProof), expiresAt: String(value.expiresAt), revisionId: revision.id, snapshotHash: revision.snapshotHash });
      pendingFocus.current = signLegend;
    } catch (cause) {
      if (!alive.current) return;
      if (api.client.snapshot().phase === 'access_lost') { lost(); return; }
      setMessage({ tone: 'error', text: `${cause instanceof Error ? cause.message : 'The revised quote could not be checked.'} The latest version is shown below.` }); void load();
    } finally { if (alive.current) setReviewing(false); }
  }
  async function afterAccept(snapshot: WorkState) {
    if (!apply(snapshot)) return;
    if (snapshot.phase === 'saved') { clearSigning(); setMessage({ tone: 'notice', text: 'Thank you. Your acceptance and new signature are saved.' }); pendingFocus.current = heading; await load(); return; }
    if (snapshot.phase === 'unknown') { setMessage(null); pendingFocus.current = messageRef; return; }
    const code = snapshot.code ?? '';
    if (snapshot.phase === 'conflict' && proofCodes.includes(code) || code === 'review_required') { clearSigning(); setExpired(true); setMessage({ tone: 'error', text: 'Your review of this revised quote is no longer valid, so nothing was accepted. Review it again and sign again.' }); return; }
    if (snapshot.phase === 'conflict') { clearSigning(); setMessage({ tone: 'error', text: changedCodes.includes(code) ? 'This revised quote changed or is no longer waiting for your acceptance, so nothing was accepted. The latest version is shown below.' : `${snapshot.error ?? 'Nothing was accepted.'} The latest status is shown below.` }); await load(); return; }
    setMessage({ tone: 'error', text: `${snapshot.error ?? 'Your acceptance was not saved.'} Nothing was accepted. ${snapshot.fields ? 'Check the highlighted details and try again.' : 'You can try again.'}` });
  }
  async function accept() {
    if (!review || !current || locked || !agreed) return;
    if (!reportSectionValidity(signatureField.current)) return;
    let signature;
    try { signature = validateBookingSignature({ name, method, strokes: method === 'typed' ? [] : strokes, acknowledged: true }); }
    catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Enter your name and signature.' }); return; }
    setMessage(null);
    const call = api.accept({ revisionId: review.revisionId, expectedRevision: current.revision, reviewProof: review.proof, acknowledgmentVersion: COMPANY_REVISION_ACK_VERSION, acknowledged: true, signature });
    setWork(api.client.snapshot());
    await afterAccept(await call);
  }
  async function resolvePending(kind: 'check' | 'retry') {
    if (!api.client.pendingRequest()) return;
    const call = kind === 'check' ? api.check() : api.retry();
    setWork(api.client.snapshot());
    const snapshot = await call;
    if (kind === 'check' && snapshot.phase === 'unknown') setMessage({ tone: 'notice', text: 'No saved result was found yet. Send the same acceptance again, or check again shortly.' });
    await afterAccept(snapshot);
  }

  const fields = phase === 'error' ? work.fields ?? {} : {};
  const reviewCurrent = review && review.revisionId === current.id && review.snapshotHash === current.snapshotHash ? review : null;
  const canSign = Boolean(reviewCurrent && current.status === 'published');
  const ackId = `lq-revision-ack-${requestId}`;
  const messageBox = message && <div ref={messageRef} tabIndex={-1} className={message.tone === 'error' ? 'lq-error' : 'lq-notice'} role={message.tone === 'error' ? 'alert' : 'status'}><p>{message.text}</p></div>;

  return <section className="lq-revision" aria-labelledby={`lq-revision-title-${requestId}`}>
    {current.status === 'published' && <>
      <h3 id={`lq-revision-title-${requestId}`} ref={heading} tabIndex={-1}>The company revised your quote</h3>
      <p>After reviewing your booking request, the company changed the quote. Please review the changes below. <strong>Nothing changes until you accept and sign again.</strong></p>
      <p>New total: <strong>{revisionMoney(current.totalCents)}</strong>. {NO_GST_NOTICE}</p>
      <RevisionComparison comparison={current.comparison} idPrefix={`lq-revision-${requestId}`} heading="What changed" originalLabel="Your signed request" revisedLabel="Revised quote" />
      <RevisionNotes revision={current} level={4} />
      <p className="lq-muted">If you don’t agree with these changes, reply to the email we sent you about this revised quote. You don’t need to do anything here.</p>
      {messageBox}
      {phase === 'unknown' && pending && <div className="lq-notice" ref={messageRef} tabIndex={-1}><p role="alert">We couldn’t confirm whether your acceptance was saved. Check the result, or send exactly the same acceptance again. Don’t sign again until the result is known.</p><div className="lq-actions"><button type="button" onClick={() => void resolvePending('check')}>Check the result</button><button type="button" className="secondary" onClick={() => void resolvePending('retry')}>Send the same acceptance again</button></div></div>}
      {!canSign && !pending && <div className="lq-actions"><button type="button" disabled={locked} onClick={() => void startReview(current)}>{reviewing ? 'Checking the latest version…' : expired ? 'Review again to sign' : 'Review and accept the revised quote'}</button></div>}
      {canSign && reviewCurrent && <fieldset className="lq-revision-sign" disabled={locked}>
        <legend ref={signLegend} tabIndex={-1}>Accept and sign the revised quote</legend>
        <p className="lq-muted">This review stays open until {displayTime(reviewCurrent.expiresAt)} (Sydney). A new signature is required; your earlier signature is not reused.</p>
        <p className="lq-revision-ack" id={ackId}>{state!.acknowledgment.text}</p>
        <label className="lq-option"><input type="checkbox" name="revision-acknowledged" checked={agreed} aria-describedby={ackId} aria-invalid={fields.acknowledged ? true : undefined} onChange={event => setAgreed(event.target.checked)} />I have read the statement above and accept revised quote version {current.versionNo} for {revisionMoney(current.totalCents)}. *</label>
        {fields.acknowledged && <small className="lq-revision-field-error">{fields.acknowledged}</small>}
        <div ref={signatureField}><label>Your full name *<ValidatedInput validation="text" requireLetter required minLength={2} validationLabel="Your full name" name="revision-signature-name" autoComplete="name" maxLength={120} value={name} aria-invalid={fields.signature ? true : undefined} onChange={event => setName(event.target.value)} /></label></div>
        <fieldset><legend>Signature method</legend><label className="lq-option"><input type="radio" name={`revision-signature-method-${requestId}`} checked={method === 'drawn'} onChange={() => { setMethod('drawn'); setStrokes([]); }} />Draw signature</label><label className="lq-option"><input type="radio" name={`revision-signature-method-${requestId}`} checked={method === 'typed'} onChange={() => { setMethod('typed'); setStrokes([]); }} />Use my typed full name as my signature</label></fieldset>
        {method === 'drawn' && <SignaturePad label="Draw your signature *" strokes={strokes} onChange={setStrokes} disabled={locked} />}
        {fields.signature && <small className="lq-revision-field-error">{fields.signature}</small>}
        <div className="lq-actions"><button type="button" disabled={locked || !agreed || !name.trim() || (method === 'drawn' && !strokes.length)} onClick={() => void accept()}>{saving ? 'Saving your acceptance…' : 'Accept revised quote'}</button><button type="button" className="secondary" disabled={locked} onClick={() => { clearSigning(); setMessage(null); }}>Not now</button></div>
      </fieldset>}
    </>}

    {current.status === 'accepted' && <>
      <h3 id={`lq-revision-title-${requestId}`} ref={heading} tabIndex={-1}>Revised quote accepted</h3>
      {messageBox}
      <p>You accepted revised quote version {current.versionNo}{current.acceptedAt ? ` on ${displayTime(current.acceptedAt)} (Sydney)` : ''} with a new signature. Total: <strong>{revisionMoney(current.totalCents)}</strong>. {NO_GST_NOTICE}</p>
      <p className="lq-muted">{revisionEmailLabel(current)}. {revisionReceiptLabel(current)}.</p>
      <p className="lq-muted">The company confirms your booking separately. This acceptance is not a contract, work authorisation or payment obligation.</p>
      <details className="lq-optional-details"><summary>Show what you accepted</summary><RevisionComparison comparison={current.comparison} idPrefix={`lq-revision-${requestId}`} originalLabel="Your signed request" revisedLabel="Accepted quote" /><RevisionNotes revision={current} level={4} /></details>
      <div className="lq-actions"><button type="button" className="secondary" disabled={locked} onClick={() => void load()}>Refresh receipt status</button></div>
    </>}

    {current.status === 'withdrawn' && <>
      <h3 id={`lq-revision-title-${requestId}`} ref={heading} tabIndex={-1}>Revised quote withdrawn</h3>
      {messageBox}
      <p>This revised quote (version {current.versionNo}) was withdrawn{current.withdrawnAt ? ` on ${displayTime(current.withdrawnAt)} (Sydney)` : ''} and can no longer be accepted.</p>
      <p>{accepted ? `Your accepted revised quote version ${accepted.versionNo} (${revisionMoney(accepted.totalCents)}) still applies.` : 'Your original signed request is unchanged.'}</p>
      <p className="lq-muted">If you have questions, reply to an email you received from us about this booking.</p>
    </>}

    {current.status === 'superseded' && <>
      <h3 id={`lq-revision-title-${requestId}`} ref={heading} tabIndex={-1}>Revised quote replaced</h3>
      {messageBox}
      <p>Revised quote version {current.versionNo} was replaced by a later version.{accepted ? ` Accepted version ${accepted.versionNo} (${revisionMoney(accepted.totalCents)}) applies.` : ''}</p>
    </>}
  </section>;
}
