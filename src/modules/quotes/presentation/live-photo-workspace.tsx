'use client';

import Image from 'next/image';
import { Check, CircleAlert, ImagePlus, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LiveQuoteRequest } from '../index';
import type { PhotoWorkspace, LivePhotoRole } from '../domain/photo-workspace';
import { liveRequest, LiveRequestError, isRecord } from './request-client';
import { canRequestPhotoAnalysis, parsePhotoWorkspace, photoRoleLabels, validatePhotoFile, photoAnalysisRequestBody } from './photo-workspace-client';
import { SavedPhotoAnalysis } from './saved-photo-analysis';
import { PhotoAnalysisProgress } from './photo-analysis-progress';
import styles from './live-photo-workspace.module.css';

const photoGuides: Record<LivePhotoRole, { title: string; tip: string }> = {
  overview: { title: 'Whole front', tip: 'Step back to show all cabinet doors.' },
  upper: { title: 'Upper cabinets', tip: 'Keep the full upper row in view.' },
  lower: { title: 'Lower & drawers', tip: 'Include the sink area and drawer fronts.' },
  side: { title: 'Side panels', tip: 'Show an exposed end or side panel.' },
  damage: { title: 'Surface & damage', tip: 'Take a close-up of wear or a typical surface.' },
};
function CabinetView({ role }: { role: LivePhotoRole }) {
  return <svg className={styles.cabinet} viewBox="0 0 100 64" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M8 35h84M82 35v24H8V35" />
      <rect x="8" y="5" width="23" height="22" rx="2" className={role === 'overview' || role === 'upper' ? styles.highlight : undefined} />
      <rect x="34" y="5" width="23" height="22" rx="2" className={role === 'overview' || role === 'upper' ? styles.highlight : undefined} />
      <rect x="60" y="5" width="22" height="22" rx="2" className={role === 'overview' || role === 'upper' ? styles.highlight : undefined} />
      <rect x="8" y="38" width="23" height="21" className={role === 'overview' || role === 'lower' ? styles.highlight : undefined} />
      <rect x="34" y="38" width="23" height="21" className={role === 'overview' || role === 'lower' ? styles.highlight : undefined} />
      <rect x="60" y="38" width="22" height="10" className={role === 'overview' || role === 'lower' ? styles.highlight : undefined} />
      <rect x="60" y="49" width="22" height="10" className={role === 'overview' || role === 'lower' ? styles.highlight : undefined} />
      <path d="m82 35 10 4v20H82" className={role === 'side' ? styles.highlight : undefined} />
      {role === 'damage' && <><circle cx="46" cy="48" r="11" className={styles.highlight} /><path d="m43 43 4 4-3 3 4 4" /></>}
    </g>
  </svg>;
}

type Mutation = { path: string; method: string; body: string; process?: boolean };
type UploadAttempt = { file: File; role: LivePhotoRole; body: string; photoId?: string; signedUrl?: string; finalizeBody?: string };
export function LivePhotoWorkspace({ request, onSaved, onAccessLost, onBusyChange, onInFlightChange, onDirtyChange, onAnalysisChange, readOnly = false, disabled = false, sessionBlocked = false }: { request: LiveQuoteRequest; onSaved: (request: LiveQuoteRequest) => void; onAccessLost: () => void; onBusyChange?: (busy: boolean) => void; onInFlightChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void; onAnalysisChange?: (latest: PhotoWorkspace['latest']) => void; readOnly?: boolean; disabled?: boolean; sessionBlocked?: boolean }) {
  const [workspace, setWorkspace] = useState<PhotoWorkspace | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [pending, setPending] = useState<Mutation | null>(null), [uploadPending, setUploadPending] = useState<UploadAttempt | null>(null);
  const [uploading, setUploading] = useState(false), [reading, setReading] = useState(false);
  const [role, setRole] = useState<LivePhotoRole>('overview'), [file, setFile] = useState<File | null>(null), [consent, setConsent] = useState(false), [upperNone, setUpperNone] = useState(false), [noDamage, setNoDamage] = useState(false);
  const alive = useRef(true), active = useRef(false), generation = useRef(0), scope = useRef(0), blocked = useRef(sessionBlocked), readController = useRef<AbortController | null>(null), requestRef = useRef(request), callbacks = useRef({ onSaved, onAccessLost, onBusyChange, onInFlightChange, onDirtyChange, onAnalysisChange });
  const fileInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { requestRef.current = request; callbacks.current = { onSaved, onAccessLost, onBusyChange, onInFlightChange, onDirtyChange, onAnalysisChange }; }, [request, onSaved, onAccessLost, onBusyChange, onInFlightChange, onDirtyChange, onAnalysisChange]);
  const accept = useCallback((value: PhotoWorkspace) => {
    if (!alive.current || blocked.current) return;
    setWorkspace(value); callbacks.current.onSaved(value.request); callbacks.current.onAnalysisChange?.(value.latest);
  }, []);
  const fail = useCallback((cause: unknown) => {
    if (!alive.current || blocked.current) return;
    if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) {
      setError('Your quote session changed. Reopen this quote to retry your saved photo request.'); callbacks.current.onAccessLost(); return;
    }
    if (cause instanceof LiveRequestError && cause.status === 409) setConflict(true);
    setError(cause instanceof Error ? cause.message : 'The saved result could not be confirmed. Reload to check its status.');
  }, []);
  const reload = useCallback(async () => {
    if (blocked.current) return;
    readController.current?.abort();
    const controller = new AbortController(), version = ++generation.current, epoch = scope.current, id = requestRef.current.id;
    readController.current = controller; setReading(true);
    try {
      const body = await liveRequest('/api/quote/requests/analysis', { headers: { 'x-lk-quote-request-id': id }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      if (alive.current && !blocked.current && epoch === scope.current && version === generation.current) { accept(parsePhotoWorkspace(body, id)); setConflict(false); }
    } catch (cause) { if (alive.current && !blocked.current && epoch === scope.current && version === generation.current && !controller.signal.aborted) fail(cause); }
    finally { if (readController.current === controller) { readController.current = null; if (alive.current) setReading(false); } }
  }, [accept, fail]);
  useLayoutEffect(() => {
    const wasBlocked = blocked.current; blocked.current = sessionBlocked;
    scope.current++; generation.current++; readController.current?.abort(); readController.current = null;
    let cancelled = false;
    void Promise.resolve().then(() => { if (cancelled) return; setReading(false); if (!active.current) { setBusy(false); setUploading(false); } if (wasBlocked && !sessionBlocked) return reload(); });
    return () => { cancelled = true; };
  }, [sessionBlocked, reload]);
  useEffect(() => {
    alive.current = true;
    const epochRef = scope, versionRef = generation, controllerRef = readController;
    return () => { alive.current = false; epochRef.current++; versionRef.current++; controllerRef.current?.abort(); };
  }, [reload, request.id]);
  useEffect(() => { if (!blocked.current) void reload(); }, [reload, request.id, request.revision]);
  const processing = Boolean(workspace?.latest && !workspace.latest.stale && ['queued', 'running'].includes(workspace.latest.status));
  const blocksAccessChange = busy || reading || Boolean(pending) || Boolean(uploadPending) || processing;
  useEffect(() => { callbacks.current.onBusyChange?.(blocksAccessChange); }, [blocksAccessChange]);
  useEffect(() => { callbacks.current.onInFlightChange?.(busy || reading); }, [busy, reading]);
  useEffect(() => { callbacks.current.onDirtyChange?.(Boolean(file) || consent || upperNone || noDamage); }, [file, consent, upperNone, noDamage]);
  useEffect(() => () => { callbacks.current.onBusyChange?.(false); callbacks.current.onInFlightChange?.(false); callbacks.current.onDirtyChange?.(false); }, []);
  useEffect(() => {
    if (!processing || sessionBlocked) return;
    // Reading the saved state remains safe while the process request is in flight.
    // It lets the queued → running state appear before the final response arrives.
    const timer = setInterval(() => { void reload(); }, 4000);
    return () => clearInterval(timer);
  }, [processing, reload, sessionBlocked]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  const locked = readOnly || disabled || sessionBlocked || busy || conflict || Boolean(pending) || Boolean(uploadPending) || processing;
  async function mutate(attempt: Mutation) {
    if (active.current || blocked.current || readOnly) return;
    const epoch = scope.current, id = requestRef.current.id;
    const current = () => alive.current && !blocked.current && epoch === scope.current && requestRef.current.id === id;
    active.current = true; generation.current++; setBusy(true); setError(''); setNotice(''); setPending(attempt);
    try {
      const body = await liveRequest(attempt.path, { method: attempt.method, headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': id }, body: attempt.body });
      if (!current()) return;
      let value = parsePhotoWorkspace(body, id);
      generation.current++; accept(value);
      if (attempt.path === '/api/quote/requests/analysis' && attempt.process && value.latest?.status === 'queued') {
        // The created job is durable. Keep this exact process retry if its outcome becomes uncertain.
        const processAttempt = { path: `/api/quote/requests/analysis/${value.latest.id}/process`, method: 'POST', body: '{}', process: true };
        setPending(processAttempt);
        const processed = await liveRequest(processAttempt.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': id }, body: processAttempt.body, signal: AbortSignal.timeout(180_000) });
        if (!current()) return;
        value = parsePhotoWorkspace(processed, id); generation.current++; accept(value);
      }
      setPending(null); setNotice(attempt.process ? '' : 'Your changes have been saved.');
    } catch (cause) {
      if (!current()) return;
      fail(cause);
      if (cause instanceof LiveRequestError && cause.status < 500 && ![401, 403].includes(cause.status)) setPending(null);
    } finally { active.current = false; if (alive.current) { setBusy(false); if (!current()) setError('Your photo request is kept here. Reopen this quote, then retry the same request or check its saved status.'); else if (attempt.process) void reload(); } }
  }
  async function upload(attempt: UploadAttempt) {
    if (active.current || blocked.current || readOnly) return;
    const epoch = scope.current, id = requestRef.current.id, revision = requestRef.current.revision;
    const current = () => alive.current && !blocked.current && epoch === scope.current && requestRef.current.id === id;
    active.current = true; generation.current++; setBusy(true); setUploading(true); setError(''); setNotice(''); setUploadPending(attempt);
    try {
      if (!attempt.photoId || !attempt.signedUrl) {
        const body = await liveRequest('/api/quote/requests/photos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': id }, body: attempt.body });
        if (!current()) return;
        if (!isRecord(body.photo) || typeof body.photo.id !== 'string' || !isRecord(body.upload) || typeof body.upload.signedUrl !== 'string') throw new Error('Private photo upload could not be prepared. Retry the same upload.');
        const url = new URL(body.upload.signedUrl);
        if (url.protocol !== 'https:') throw new Error('A secure private photo upload was not provided.');
        attempt = { ...attempt, photoId: body.photo.id, signedUrl: url.href }; setUploadPending(attempt);
      }
      if (!attempt.finalizeBody) {
        const response = await fetch(attempt.signedUrl!, { method: 'PUT', body: attempt.file, headers: { 'content-type': attempt.file.type, 'x-upsert': 'false' }, credentials: 'omit', signal: AbortSignal.timeout(90_000) });
        if (!current()) return;
        if (!response.ok && ![400, 409].includes(response.status)) throw new Error('Photo upload could not be confirmed. Retry the same photo.');
        attempt = { ...attempt, finalizeBody: JSON.stringify({ expectedRevision: revision, idempotencyKey: crypto.randomUUID() }) }; setUploadPending(attempt);
      }
      const body = await liveRequest(`/api/quote/requests/photos/${attempt.photoId}/finalize`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': id }, body: attempt.finalizeBody });
      if (!current()) return;
      accept(parsePhotoWorkspace(body, id));
      setUploadPending(null); setFile(null); if (fileInput.current) fileInput.current.value = ''; setNotice('Photo saved privately. You can add another view.');
    } catch (cause) { if (current()) fail(cause); }
    finally { active.current = false; if (alive.current) { setBusy(false); setUploading(false); if (!current()) setError('Your photo upload is kept here. Reopen this quote, then retry the same photo upload.'); } }
  }
  async function startUpload() {
    if (!file || !workspace || locked) return;
    const epoch = scope.current;
    try {
      validatePhotoFile(file);
      active.current = true; setBusy(true); setUploading(true);
      const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!alive.current || blocked.current || epoch !== scope.current) return;
      active.current = false;
      await upload({ file, role, body: JSON.stringify({ expectedRevision: workspace.request.revision, idempotencyKey: crypto.randomUUID(), role, mimeType: file.type, sizeBytes: file.size, sourceHash }) });
    }
    catch (cause) { if (!blocked.current && epoch === scope.current) fail(cause); }
    finally { active.current = false; if (alive.current) { setBusy(false); setUploading(false); } }
  }
  function command(path: string, method: string, extra: Record<string, unknown> = {}, process = false) {
    if (!workspace || locked) return;
    void mutate({ path, method, body: JSON.stringify({ expectedRevision: workspace.request.revision, idempotencyKey: crypto.randomUUID(), ...extra }), process });
  }
  function analyse() {
    if (!workspace || locked) return;
    try { void mutate({ path: '/api/quote/requests/analysis', method: 'POST', body: photoAnalysisRequestBody(workspace, consent, { upperNotApplicable: upperNone, damageNotPresent: noDamage }, crypto.randomUUID()), process: true }); }
    catch (cause) { fail(cause); }
  }
  const photos = workspace?.photos.filter(photo => photo.state !== 'deleted') ?? [];
  const latest = workspace?.latest;
  const readyCount = photos.filter(photo => photo.state === 'ready').length;
  const analysisSubmitting = busy && Boolean(pending?.process);
  const analysisLoading = processing || analysisSubmitting;
  const retryAnalysis = latest && !latest.stale && ['failed', 'uncertain'].includes(latest.status);
  return <section className={`lq-photo-workspace ${styles.workspace}`} aria-labelledby="live-photos-title">
    <div className={styles.heading}>
      <div><h3 id="live-photos-title" tabIndex={-1}>Show us your cabinets</h3><p>Clear photos help us estimate the doors, drawers and painting cost. Exact quantities, condition and the final price are checked on site.</p></div>
      <span className={styles.private}><ShieldCheck size={16} aria-hidden="true" /> Private photos</span>
    </div>
    <p className={styles.intro}>Start with the whole front, then add the other views below. Around five photos is helpful; one photo can cover more than one area.</p>
    {sessionBlocked && <p className="lq-notice" role="status">Your photo selection and pending request are kept here. Reopen this quote before continuing.</p>}
    {error && <div ref={errorBox} tabIndex={-1} className="lq-error" role="alert"><p>{error}</p>{pending && <button disabled={busy || sessionBlocked} type="button" onClick={() => void mutate(pending)}>Retry same request</button>}{uploadPending && !conflict && <button disabled={busy || sessionBlocked} type="button" onClick={() => void upload(uploadPending)}>Retry photo upload</button>}{uploadPending && <button disabled={busy || sessionBlocked} type="button" className="secondary" onClick={() => { setUploadPending(null); setError(''); void reload(); }}>Stop this upload attempt</button>}{conflict && <p>A newer version is saved. Check its status before making another change. Your selected photo remains here.</p>}<button disabled={busy || sessionBlocked} type="button" className="secondary" onClick={() => { setError(''); void reload(); }}>Check saved status</button></div>}
    <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
    {!workspace && !error && <div className={styles.activity} role="status"><LoaderCircle className={styles.spinner} size={22} aria-hidden="true" /><span>Loading your saved photos…</span></div>}
    {workspace && <>
      {photos.length > 0 && <div className={styles.savedPhotos}>
        <div className={styles.sectionHeading}><h4>Your photos</h4><span>{readyCount} saved · {photos.length}/8 photos</span></div>
        <ul className={`lq-photo-grid ${styles.photoGrid}`}>{photos.map(photo => <li key={photo.id}>
          {photo.state === 'ready' && photo.contentUrl ? <a href={photo.contentUrl} target="_blank" rel="noreferrer" aria-label={`Open ${photoRoleLabels[photo.role]} photo in a new tab`}><Image unoptimized src={photo.contentUrl} alt={`${photoRoleLabels[photo.role]} uploaded for this request`} width={320} height={240} /></a> : <div className={styles.photoWaiting}><ImagePlus size={28} aria-hidden="true" /><span>Upload not complete</span></div>}
          <div className={styles.photoCaption}><strong>{photoGuides[photo.role].title}</strong><span>{photo.state === 'ready' ? <><Check size={13} aria-hidden="true" /> Saved privately</> : 'Awaiting photo check'}</span></div>
          {!readOnly && workspace.request.status === 'draft' && <button className="secondary" type="button" disabled={locked} onClick={() => command(`/api/quote/requests/photos/${photo.id}`, 'DELETE')}>Remove<span className="sr-only"> {photoRoleLabels[photo.role]} photo</span></button>}
        </li>)}</ul>
      </div>}
      {readOnly ? <p className="lq-notice">Your photos and estimate are saved with the submitted reservation request.</p> : workspace.request.status === 'draft' ? <>
        <fieldset className={`lq-fields ${styles.uploadFields}`} disabled={locked || photos.length >= 8}><legend>{photos.length ? 'Add another view' : 'Add your first photo'}</legend>
          <p className={styles.helper} id="live-photo-role-help">Choose the view you are adding.</p>
          <div className={styles.roleGrid} role="radiogroup" aria-label="What does this photo show?" aria-describedby="live-photo-role-help">
            {(Object.entries(photoGuides) as [LivePhotoRole, { title: string; tip: string }][]).map(([value, guide]) => {
              const saved = photos.some(photo => photo.role === value && photo.state === 'ready');
              return <label className={styles.roleCard} key={value}>
                <input name="live-photo-role" type="radio" value={value} checked={role === value} onChange={() => setRole(value)} />
                <span className={styles.roleContent}><CabinetView role={value} /><strong>{guide.title}</strong><span className={styles.roleTip}>{guide.tip}</span>{saved && <span className={styles.roleSaved}><Check size={12} aria-hidden="true" /> Photo added</span>}</span>
              </label>;
            })}
          </div>
          <div className={styles.uploadBox}>
            <ImagePlus size={28} aria-hidden="true" />
            <div><label htmlFor="live-photo-file">Choose a {photoGuides[role].title.toLowerCase()} photo</label><p id="live-photo-file-help">JPEG, PNG or WebP · Up to 10 MB each</p><input ref={fileInput} id="live-photo-file" name="live-photo-file" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="live-photo-file-help live-photo-privacy" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></div>
          </div>
          <p className={styles.helper} id="live-photo-privacy">Avoid people, documents, addresses and other private details.</p>
          <div className="lq-actions"><button type="button" disabled={!file || photos.length >= 8} onClick={() => void startUpload()}>{uploading ? <><LoaderCircle className={styles.spinner} size={18} aria-hidden="true" /> Saving photo…</> : <><ImagePlus size={18} aria-hidden="true" /> Save photo privately</>}</button></div>
        </fieldset>
        {photos.length >= 8 && <p className="lq-notice">All eight photo spaces are used. Remove a photo to replace it with another view.</p>}
        {uploading && <div className={styles.activity} role="status"><LoaderCircle className={styles.spinner} size={22} aria-hidden="true" /><div><strong>Saving your photo privately…</strong><p>Keep this page open until the upload is confirmed.</p></div></div>}
        <fieldset className={`lq-fields ${styles.analysisFields}`} disabled={locked}><legend>Get your photo estimate</legend>
          <p className={styles.helper}>You can leave door and drawer counts blank — AI will estimate them from your photos.</p>
          <details className={styles.optionalDetails}><summary>Missing views or no visible damage?</summary><label className="lq-option"><input name="live-photo-upper-none" type="checkbox" checked={upperNone} onChange={event => setUpperNone(event.target.checked)} />There are no upper cabinets in this project.</label><label className="lq-option"><input name="live-photo-no-damage" type="checkbox" checked={noDamage} onChange={event => setNoDamage(event.target.checked)} />I have not noticed damage and included a typical surface photo.</label></details>
          <label className={`lq-option ${styles.consent}`}><input name="live-photo-ai-consent" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I agree to sending these photos and saved service details to OpenAI for AI cabinet analysis, and saving the result in L&amp;K Group’s company system. Contact details and the site address are excluded. AI observations may need correction or an on-site check.</span></label>
          {retryAnalysis && <p className={styles.helper}>Check the saved status first. A new analysis may make another AI call.</p>}
          <div className="lq-actions"><button type="button" disabled={!consent || !canRequestPhotoAnalysis(workspace)} onClick={analyse}>{analysisLoading ? <><LoaderCircle className={styles.spinner} size={18} aria-hidden="true" /> Analysing photos…</> : retryAnalysis ? 'Try a new photo analysis' : 'Analyse photos & get estimate'}</button></div>
          {!readyCount && <p className={styles.helper}>Save at least one photo to begin.</p>}
        </fieldset>
      </> : <div className="lq-notice"><p>Your request is with the company for review. Reopen it to change your photos or service details.</p><button type="button" disabled={locked} onClick={() => command('/api/quote/requests/reopen', 'POST')}>Reopen request for photos</button></div>}
      <PhotoAnalysisProgress job={latest} preparing={analysisSubmitting} />
      {latest && !analysisLoading && <>
        {!latest.stale && latest.status === 'succeeded' ? <div className={styles.complete} role="status"><Check size={22} aria-hidden="true" /><div><strong>{['estimate_ready', 'provisional_estimate'].includes(latest.pricing?.status ?? '') ? 'Your photo estimate is ready' : 'Your photo review is ready'}</strong><p>{['estimate_ready', 'provisional_estimate'].includes(latest.pricing?.status ?? '') ? 'Review the estimate below. The final scope and price are confirmed on site.' : 'Some details need a clearer photo or an on-site check. Review the saved assessment below.'}</p></div></div> : !latest.stale && ['failed', 'uncertain'].includes(latest.status) ? <div className={styles.analysisProblem} role="status"><CircleAlert size={22} aria-hidden="true" /><div><strong>{latest.status === 'uncertain' ? 'Let’s check your analysis status' : 'Your analysis could not be completed'}</strong><p>{latest.status === 'uncertain' ? 'The previous AI call may have finished. Check its saved status before starting another analysis.' : 'Your photos are still saved. Check the status, then try another analysis if needed.'}</p>{latest.error && <p>{latest.error}</p>}<button type="button" className="secondary" disabled={busy || sessionBlocked} onClick={() => { setError(''); void reload(); }}>Check saved status</button></div></div> : null}
        <details className={styles.resultDetails}><summary>{latest.stale ? 'Earlier photo assessment — details changed' : latest.status === 'succeeded' ? 'View saved analysis and estimate' : 'View saved analysis details'}</summary><SavedPhotoAnalysis job={latest} /></details>
      </>}
      {!readOnly && !disabled && !sessionBlocked && latest?.status === 'queued' && !latest.stale && <div className="lq-actions"><button type="button" className="secondary" disabled={busy || conflict || Boolean(pending) || Boolean(uploadPending)} onClick={() => void mutate({ path: `/api/quote/requests/analysis/${latest.id}/process`, method: 'POST', body: '{}', process: false })}>Continue saved analysis</button></div>}
      {workspace.jobs.length > 1 && <details className={styles.resultDetails}><summary>Previous analyses ({workspace.jobs.length - 1})</summary>{workspace.jobs.filter(job => job.id !== latest?.id).map(job => <SavedPhotoAnalysis key={job.id} job={job} />)}</details>}
    </>}
  </section>;
}
