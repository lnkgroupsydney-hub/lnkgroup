'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveQuoteRequest } from '../index';
import type { PhotoWorkspace, LivePhotoRole } from '../domain/photo-workspace';
import { liveRequest, LiveRequestError, isRecord } from './request-client';
import { canRequestPhotoAnalysis, parsePhotoWorkspace, photoRoleLabels, validatePhotoFile, photoAnalysisRequestBody } from './photo-workspace-client';
import { SavedPhotoAnalysis } from './saved-photo-analysis';

type Mutation = { path: string; method: string; body: string; process?: boolean };
type UploadAttempt = { file: File; role: LivePhotoRole; body: string; photoId?: string; signedUrl?: string; finalizeBody?: string };
export function LivePhotoWorkspace({ request, onSaved, onAccessLost, onBusyChange, disabled = false }: { request: LiveQuoteRequest; onSaved: (request: LiveQuoteRequest) => void; onAccessLost: () => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const [workspace, setWorkspace] = useState<PhotoWorkspace | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [pending, setPending] = useState<Mutation | null>(null), [uploadPending, setUploadPending] = useState<UploadAttempt | null>(null);
  const [role, setRole] = useState<LivePhotoRole>('overview'), [file, setFile] = useState<File | null>(null), [consent, setConsent] = useState(false), [upperNone, setUpperNone] = useState(false), [noDamage, setNoDamage] = useState(false);
  const alive = useRef(true), active = useRef(false), generation = useRef(0), requestRef = useRef(request), callbacks = useRef({ onSaved, onAccessLost, onBusyChange });
  const fileInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { requestRef.current = request; callbacks.current = { onSaved, onAccessLost, onBusyChange }; }, [request, onSaved, onAccessLost, onBusyChange]);
  const accept = useCallback((value: PhotoWorkspace) => {
    if (!alive.current) return;
    setWorkspace(value); callbacks.current.onSaved(value.request);
  }, []);
  const fail = useCallback((cause: unknown) => {
    if (!alive.current) return;
    if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) {
      setWorkspace(null); setFile(null); setConsent(false); setPending(null); setUploadPending(null); callbacks.current.onAccessLost(); return;
    }
    if (cause instanceof LiveRequestError && cause.status === 409) setConflict(true);
    setError(cause instanceof Error ? cause.message : 'The saved result could not be confirmed. Reload to check its status.');
  }, []);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const body = await liveRequest('/api/quote/requests/analysis', { headers: { 'x-lk-quote-request-id': requestRef.current.id } });
      const value = parsePhotoWorkspace(body, requestRef.current.id);
      if (alive.current && version === generation.current) { accept(value); setConflict(false); }
    } catch (cause) { if (version === generation.current) fail(cause); }
  }, [accept, fail]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return reload(); });
    return () => { cancelled = true; alive.current = false; };
  }, [reload, request.id, request.revision]);
  const processing = Boolean(workspace?.latest && !workspace.latest.stale && ['queued', 'running'].includes(workspace.latest.status));
  const blocksAccessChange = busy || Boolean(pending) || Boolean(uploadPending) || processing;
  useEffect(() => { callbacks.current.onBusyChange?.(blocksAccessChange); }, [blocksAccessChange]);
  useEffect(() => () => { callbacks.current.onBusyChange?.(false); }, []);
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => { if (!active.current) void reload(); }, 4000);
    return () => clearInterval(timer);
  }, [processing, reload]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  const locked = disabled || busy || conflict || Boolean(pending) || Boolean(uploadPending) || processing;
  async function mutate(attempt: Mutation) {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice(''); setPending(attempt);
    try {
      let value = parsePhotoWorkspace(await liveRequest(attempt.path, { method: attempt.method, headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': requestRef.current.id }, body: attempt.body }), requestRef.current.id);
      accept(value); if (!alive.current) return;
      setPending(null);
      if (attempt.process && value.latest?.status === 'queued') {
        setNotice('Analysing your photos. This saved analysis can be restored after a refresh.');
        value = parsePhotoWorkspace(await liveRequest(`/api/quote/requests/analysis/${value.latest.id}/process`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': requestRef.current.id }, body: '{}', signal: AbortSignal.timeout(180_000) }), requestRef.current.id);
        accept(value);
      }
      if (alive.current) setNotice(attempt.process ? 'The analysis status has been saved in the company system.' : 'Saved in the company system.');
    } catch (cause) {
      fail(cause);
      if (alive.current && cause instanceof LiveRequestError && cause.status < 500) setPending(null);
    } finally { active.current = false; if (alive.current) { setBusy(false); if (attempt.process) void reload(); } }
  }
  async function upload(attempt: UploadAttempt) {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setNotice('Uploading your photo privately…'); setUploadPending(attempt);
    try {
      if (!attempt.photoId || !attempt.signedUrl) {
        const body = await liveRequest('/api/quote/requests/photos', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': requestRef.current.id }, body: attempt.body });
        if (!isRecord(body.photo) || typeof body.photo.id !== 'string' || !isRecord(body.upload) || typeof body.upload.signedUrl !== 'string') throw new Error('Private photo upload could not be prepared. Retry the same upload.');
        const url = new URL(body.upload.signedUrl);
        if (url.protocol !== 'https:') throw new Error('A secure private photo upload was not provided.');
        attempt = { ...attempt, photoId: body.photo.id, signedUrl: url.href };
        if (alive.current) setUploadPending(attempt);
      }
      if (!attempt.finalizeBody) {
        const response = await fetch(attempt.signedUrl!, { method: 'PUT', body: attempt.file, headers: { 'content-type': attempt.file.type, 'x-upsert': 'false' }, credentials: 'omit', signal: AbortSignal.timeout(90_000) });
        if (!response.ok && ![400, 409].includes(response.status)) throw new Error('Photo upload could not be confirmed. Retry the same photo.');
        attempt = { ...attempt, finalizeBody: JSON.stringify({ expectedRevision: requestRef.current.revision, idempotencyKey: crypto.randomUUID() }) };
        if (alive.current) setUploadPending(attempt);
      }
      const body = await liveRequest(`/api/quote/requests/photos/${attempt.photoId}/finalize`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-quote-request-id': requestRef.current.id }, body: attempt.finalizeBody });
      accept(parsePhotoWorkspace(body, requestRef.current.id));
      if (!alive.current) return;
      setUploadPending(null); setFile(null); if (fileInput.current) fileInput.current.value = ''; setNotice('Photo checked and saved privately. The company can view the same photo.');
    } catch (cause) { fail(cause); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  async function startUpload() {
    if (!file || !workspace || locked) return;
    try {
      validatePhotoFile(file);
      active.current = true; setBusy(true);
      const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!alive.current) return;
      active.current = false;
      await upload({ file, role, body: JSON.stringify({ expectedRevision: workspace.request.revision, idempotencyKey: crypto.randomUUID(), role, mimeType: file.type, sizeBytes: file.size, sourceHash }) });
    }
    catch (cause) { fail(cause); }
    finally { active.current = false; if (alive.current) setBusy(false); }
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
  return <section className="lq-photo-workspace" aria-labelledby="live-photos-title">
    <h3 id="live-photos-title">Photos and cabinet estimate</h3>
    <p>AI will estimate the door and drawer-front quantities from your photos and calculate a provisional painting amount. You can leave unknown quantities blank. Exact counts, condition and the final price will be checked and adjusted on site.</p>
    <p>Add around five photos showing the whole front, upper and lower cabinets, an exposed side, and the worst damage. A clear photo may cover more than one area. You can add up to eight photos.</p>
    <p className="lq-muted">Use JPEG, PNG or WebP, up to 10 MB each. Avoid people, documents, addresses and other private details. Photos are saved privately for this request.</p>
    <details><summary>Photo checklist</summary><ul>{Object.values(photoRoleLabels).map(label => <li key={label}>{label}</li>)}</ul><p>Include the sink area and all surfaces you want painted. If an area is missing or unclear, the analysis will ask for more information.</p></details>
    {error && <div ref={errorBox} tabIndex={-1} className="lq-error" role="alert"><p>{error}</p>{pending && <button disabled={busy} type="button" onClick={() => void mutate(pending)}>Retry same request</button>}{uploadPending && !conflict && <button disabled={busy} type="button" onClick={() => void upload(uploadPending)}>Retry same photo upload</button>}{uploadPending && <button disabled={busy} type="button" className="secondary" onClick={() => { setUploadPending(null); setError(''); void reload(); }}>Stop this upload attempt</button>}{conflict && <p>A newer version is saved. Reload before making another change. Your selected photo remains here.</p>}<button disabled={busy} type="button" className="secondary" onClick={() => { setError(''); void reload(); }}>Check saved status</button></div>}
    <p role="status" aria-live="polite">{notice}</p>
    {!workspace && !error && <p role="status">Loading saved photos and analysis…</p>}
    {workspace && <>
      <ul className="lq-photo-grid">{photos.map(photo => <li key={photo.id}>
        {photo.state === 'ready' && photo.contentUrl ? <a href={photo.contentUrl} target="_blank" rel="noreferrer"><Image unoptimized src={photo.contentUrl} alt={`${photoRoleLabels[photo.role]} uploaded for this request`} width={320} height={240} /></a> : <p>Upload awaiting validation</p>}
        <strong>{photoRoleLabels[photo.role]}</strong><span>{photo.state === 'ready' ? 'Privately saved' : 'Upload not complete'}</span>
        {workspace.request.status === 'draft' && <button className="secondary" type="button" disabled={locked} onClick={() => command(`/api/quote/requests/photos/${photo.id}`, 'DELETE')}>Remove<span className="sr-only"> {photoRoleLabels[photo.role]} photo</span></button>}
      </li>)}</ul>
      {workspace.request.status === 'draft' ? <>
        <fieldset className="lq-fields" disabled={locked}><legend>Add a photo</legend><div className="lq-grid"><label>What does this photo show?<select name="live-photo-role" value={role} onChange={event => setRole(event.target.value as LivePhotoRole)}>{Object.entries(photoRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Photo file<input ref={fileInput} name="live-photo-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></label></div><div className="lq-actions"><button type="button" disabled={!file || photos.length >= 8} onClick={() => void startUpload()}>Upload and save photo</button></div></fieldset>
        <fieldset className="lq-fields" disabled={locked}><legend>Analysis details</legend><label className="lq-option"><input name="live-photo-upper-none" type="checkbox" checked={upperNone} onChange={event => setUpperNone(event.target.checked)} />There are no upper cabinets in this project.</label><label className="lq-option"><input name="live-photo-no-damage" type="checkbox" checked={noDamage} onChange={event => setNoDamage(event.target.checked)} />I have not noticed any damage. I have included a representative surface photo.</label><label className="lq-option"><input name="live-photo-ai-consent" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I agree to sending these photos and saved service details to OpenAI for AI cabinet analysis, and saving the result in L&amp;K Group’s company system. Contact details and the site address are excluded. AI observations may need correction or an on-site check.</label><div className="lq-actions"><button type="button" disabled={!consent || !canRequestPhotoAnalysis(workspace)} onClick={analyse}>{latest && ['failed', 'uncertain'].includes(latest.status) && !latest.stale ? 'Request another analysis (may incur a new AI call)' : 'Analyse saved photos'}</button></div></fieldset>
      </> : <div className="lq-notice"><p>This request was sent for company review. Reopen it to add photos or change service details. Previous review history is retained.</p><button type="button" disabled={locked} onClick={() => command('/api/quote/requests/reopen', 'POST')}>Reopen request for photos</button></div>}
      {latest && <SavedPhotoAnalysis job={latest} />}
      {latest?.status === 'queued' && <button type="button" disabled={busy} onClick={() => void mutate({ path: `/api/quote/requests/analysis/${latest.id}/process`, method: 'POST', body: '{}', process: false })}>Continue saved analysis</button>}
      {workspace.jobs.length > 1 && <details><summary>Previous analyses ({workspace.jobs.length - 1})</summary>{workspace.jobs.filter(job => job.id !== latest?.id).map(job => <SavedPhotoAnalysis key={job.id} job={job} />)}</details>}
    </>}
  </section>;
}
