'use client';
import { useEffect, useRef, useState } from 'react';
import type { LiveQuoteRequest } from '../index';
import { customerMutation } from './customer-access-client';

export function LegacyQuoteRecovery({ request, companyBaseUrl }: { request: LiveQuoteRequest | null; companyBaseUrl: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function transfer() {
    if (!request || active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await customerMutation('handoff', { requestId: request.id, expectedRevision: request.revision, email: request.payload.contact.email });
      if (typeof response.url !== 'string') throw new Error('A secure quote recovery link could not be prepared. Please retry.');
      const destination = new URL(response.url), base = new URL(companyBaseUrl);
      if (destination.origin !== base.origin || destination.protocol !== 'https:' || destination.pathname !== '/quote/start' || !/^#restore=[a-f0-9]{64}$/.test(destination.hash)) throw new Error('The quote recovery destination could not be verified. Please contact the company.');
      if (alive.current) window.location.assign(destination.href);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Quote recovery could not be started. Please retry.'); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="lq-customer-access" aria-labelledby="legacy-quote-heading"><h2 id="legacy-quote-heading">Continue on our company website</h2><p>Quote writing has moved to the company domain. A saved request from this browser can be securely linked there after you verify its saved email.</p>{error && <p className="lq-error" role="alert">{error}</p>}{request ? <><p>Saved quote: <strong>{request.reference}</strong>. Verification will use <strong>{request.payload.contact.email}</strong>.</p><button type="button" disabled={busy} onClick={() => void transfer()}>{busy ? 'Preparing secure recovery…' : 'Move saved quote to company website'}</button></> : <p>No accessible saved quote was found in this browser. <a href={`${companyBaseUrl}/quote/start?service=cabinet-painting`}>Open the company quote form</a>. Contact the company for help with an older unlinked request.</p>}</section>;
}
