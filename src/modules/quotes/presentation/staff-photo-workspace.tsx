'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { PhotoWorkspace } from '../domain/photo-workspace';
import { liveRequest, LiveRequestError } from './request-client';
import { parsePhotoWorkspace, photoRoleLabels } from './photo-workspace-client';
import { SavedPhotoAnalysis } from './saved-photo-analysis';
export function StaffPhotoWorkspace({ requestId, onAccessLost }: { requestId: string; onAccessLost: () => void }) {
  const [workspace, setWorkspace] = useState<PhotoWorkspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), controller = useRef<AbortController | null>(null), callbacks = useRef(onAccessLost);
  useEffect(() => { callbacks.current = onAccessLost; }, [onAccessLost]);
  async function load(id: string) {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    setBusy(true); setError('');
    try {
      const body = await liveRequest(`/api/admin/quote-requests/${encodeURIComponent(id)}/analysis`, { signal: next.signal });
      const saved = parsePhotoWorkspace(body, id);
      if (alive.current && controller.current === next) setWorkspace(saved);
    } catch (cause) {
      if (!alive.current || controller.current !== next || next.signal.aborted) return;
      if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { setWorkspace(null); callbacks.current(); return; }
      setError(cause instanceof Error ? cause.message : 'Photos and analysis could not be loaded.');
    } finally { if (alive.current && controller.current === next) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) { setWorkspace(null); return load(requestId); } });
    return () => { cancelled = true; alive.current = false; controller.current?.abort(); };
  }, [requestId]);
  return <section className="lq-photo-workspace"><h4>Saved customer photos and analysis</h4><p>The customer and EMS read the same saved assessment. AI observations require confirmation where indicated.</p><button type="button" className="secondary" disabled={busy} onClick={() => void load(requestId)}>Refresh photos and analysis</button>{busy && <p role="status">Loading private photos and analysis…</p>}{error && <p className="lq-error" role="alert">{error}{workspace ? ' The content below is the last loaded version.' : ''}</p>}{workspace && <><ul className="lq-photo-grid">{workspace.photos.filter(photo => photo.state !== 'deleted').map(photo => <li key={photo.id}>{photo.contentUrl ? <a href={photo.contentUrl} target="_blank" rel="noreferrer"><Image unoptimized src={photo.contentUrl} alt={`${photoRoleLabels[photo.role]} for request ${workspace.request.reference}`} width={320} height={240} /></a> : <p>Awaiting photo validation</p>}<strong>{photoRoleLabels[photo.role]}</strong><span>{photo.id} · {photo.state}</span></li>)}</ul>{workspace.photos.every(photo => photo.state === 'deleted') && <p>No active photos saved.</p>}{workspace.latest ? <SavedPhotoAnalysis job={workspace.latest} /> : <p>No AI analysis has been requested.</p>}{workspace.jobs.length > 1 && <details><summary>Analysis history</summary>{workspace.jobs.filter(job => job.id !== workspace.latest?.id).map(job => <SavedPhotoAnalysis key={job.id} job={job} />)}</details>}</>}</section>;
}
