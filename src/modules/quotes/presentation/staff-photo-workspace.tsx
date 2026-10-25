'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoWorkspace } from '../domain/photo-workspace';
import { liveRequest, LiveRequestError } from './request-client';
import { parsePhotoWorkspace, photoRoleLabels } from './photo-workspace-client';
import { StaffPhotoAnalysis } from './staff-photo-analysis';

export function StaffPhotoWorkspace({ requestId, onAccessLost, active = true, compact = false }: { requestId: string; onAccessLost: () => void; active?: boolean; compact?: boolean }) {
  const [workspace, setWorkspace] = useState<PhotoWorkspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(false), denied = useRef(false), controller = useRef<AbortController | null>(null), callbacks = useRef(onAccessLost);
  useEffect(() => { callbacks.current = onAccessLost; }, [onAccessLost]);
  const load = useCallback(async () => {
    if (!alive.current || denied.current) return;
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    setBusy(true); setError('');
    try {
      const body = await liveRequest(`/api/admin/quote-requests/${encodeURIComponent(requestId)}/analysis`, { signal: next.signal });
      const saved = parsePhotoWorkspace(body, requestId);
      if (alive.current && !denied.current && !next.signal.aborted && controller.current === next) setWorkspace(saved);
    } catch (cause) {
      if (!alive.current || denied.current || controller.current !== next || next.signal.aborted) return;
      if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { denied.current = true; next.abort(); setWorkspace(null); setError(''); setBusy(false); callbacks.current(); return; }
      setError(cause instanceof Error ? cause.message : 'Photos and analysis could not be loaded.');
    } finally { if (alive.current && !denied.current && controller.current === next) setBusy(false); }
  }, [requestId]);
  useEffect(() => {
    alive.current = active; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled && active) { setWorkspace(previous => previous?.request.id === requestId ? previous : null); return load(); } });
    return () => { cancelled = true; alive.current = false; controller.current?.abort(); };
  }, [requestId, active, load]);
  const saved = workspace?.request.id === requestId ? workspace : null;
  const processing = Boolean(saved?.latest && !saved.latest.stale && ['queued', 'running'].includes(saved.latest.status));
  useEffect(() => {
    if (!active || !processing) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !busy) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [active, processing, busy, load]);
  return <section className="lq-photo-workspace" aria-label={compact ? 'Current estimate summary' : 'Saved customer photos and analysis'}>
    {!compact && <h3>Photos & estimate</h3>}
    <button type="button" className="ems-button ems-button--secondary" disabled={busy || !active} onClick={() => void load()}>{compact ? 'Refresh estimate' : 'Refresh photos and analysis'}</button>
    {busy && <p role="status">Loading {compact ? 'saved estimate' : 'private photos and analysis'}…</p>}
    {error && <p className="ems-feedback ems-feedback--error" role="alert">{error}{saved ? ' The content below is the last loaded version.' : ''}</p>}
    {saved && <>
      {!compact && <><ul className="lq-photo-grid">{saved.photos.filter(photo => photo.state !== 'deleted').map(photo => <li key={photo.id}>{photo.contentUrl ? <a href={photo.contentUrl} target="_blank" rel="noreferrer"><Image unoptimized src={photo.contentUrl} alt={`${photoRoleLabels[photo.role]} for request ${saved.request.reference}`} width={320} height={240} /></a> : <p>Awaiting photo validation</p>}<strong>{photoRoleLabels[photo.role]}</strong><span>{photo.state}</span></li>)}</ul>{saved.photos.every(photo => photo.state === 'deleted') && <p>No active photos saved.</p>}</>}
      {saved.latest ? <StaffPhotoAnalysis job={saved.latest} compact={compact} /> : <p>No AI assessment has been requested. Estimate amount pending.</p>}
      {!compact && saved.jobs.length > 1 && <details><summary>Earlier assessments</summary>{saved.jobs.filter(job => job.id !== saved.latest?.id).map(job => <StaffPhotoAnalysis key={job.id} job={job} />)}</details>}
    </>}
  </section>;
}
