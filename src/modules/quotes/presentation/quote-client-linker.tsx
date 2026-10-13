'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CustomerCandidate, CustomerDetail, CustomerPage, CustomerProperty, PropertyInput, ResolveCustomerInput, ResolveCustomerResult } from '@/modules/customers';
import { customerRequest, CustomerRequestError, reviewCandidates } from '@/modules/customers/client';
import { WorkspaceLink, useUnsavedChanges, useWorkspaceNavigation } from '@/shared/ui/admin-workspace-state';
import type { LiveQuoteRequest } from '../index';
import { parseQuoteCrmRelation, type QuoteCrmRelation } from './quote-crm-client';

export function QuoteClientLinker({ request, active, onAccessLost }: { request: LiveQuoteRequest; active: boolean; onAccessLost: () => void }) {
  const [relation, setRelation] = useState<QuoteCrmRelation | null>(null), [candidates, setCandidates] = useState<CustomerCandidate[]>([]), [properties, setProperties] = useState<CustomerProperty[]>([]);
  const [selected, setSelected] = useState(''), [propertyId, setPropertyId] = useState(''), [reason, setReason] = useState(''), [different, setDifferent] = useState(false);
  const [reviewedSource, setReviewedSource] = useState(()=>({revision:request.revision,contact:structuredClone(request.payload.contact)}));
  const [search, setSearch] = useState(''), [searchMatches, setSearchMatches] = useState<CustomerCandidate[]>([]), [searching,setSearching] = useState(false);
  const [error, setError] = useState(''), [result, setResult] = useState(''), [reading, setReading] = useState(false), [saving, setSaving] = useState(false), [uncertain, setUncertain] = useState(false);
  const [site, setSite] = useState<PropertyInput>({ label: '', address: { line1: request.payload.contact.siteAddress, unit: null, suburb: request.payload.contact.suburb, state: '', postcode: request.payload.contact.postcode, country: 'AU' }, contactName: null, notes: null });
  const alive = useRef(false), blocked = useRef(false), readAbort = useRef<AbortController | null>(null), selectedAbort = useRef<AbortController | null>(null), pending = useRef<ResolveCustomerInput | null>(null), access = useRef(onAccessLost);
  const searchAbort = useRef<AbortController | null>(null);
  const navigate = useWorkspaceNavigation(), sourceStale = request.revision !== reviewedSource.revision;
  const available = [...new Map([...candidates,...searchMatches].map(item=>[item.customer.id,item])).values()];
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);
  const lost = useCallback(() => { blocked.current = true; readAbort.current?.abort(); selectedAbort.current?.abort(); searchAbort.current?.abort(); pending.current = null; setRelation(null); setCandidates([]); setProperties([]); setSearch('');setSearchMatches([]);setSearching(false);setSelected(''); setPropertyId(''); setReason(''); setSite({label:'',address:{line1:'',unit:null,suburb:'',state:'',postcode:'',country:'AU'},contactName:null,notes:null}); setError(''); setResult(''); setSaving(false); setUncertain(false); access.current(); }, []);
  const fail = useCallback((cause: unknown) => { if (!alive.current || blocked.current || cause instanceof DOMException && cause.name === 'AbortError') return; if (cause instanceof CustomerRequestError && [401,403].includes(cause.status)) lost(); else setError(cause instanceof Error ? cause.message : 'The client relation could not be saved.'); }, [lost]);
  const load = useCallback(async () => {
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller; setReading(true); setError('');
    try {
      const value = parseQuoteCrmRelation(await customerRequest(`/quote-requests/${encodeURIComponent(request.id)}`, undefined, controller.signal), request.id);
      const matches = value.customer ? { candidates: [{ customer: value.customer, matchedBy: [] }] } : await customerRequest<{candidates:CustomerCandidate[]}>('/candidates', { name:reviewedSource.contact.name, email:reviewedSource.contact.email, phone:reviewedSource.contact.phone }, controller.signal);
      if (alive.current && !blocked.current && !controller.signal.aborted) { setRelation(value); setCandidates(matches.candidates); setSearchMatches([]); setSelected(value.customer?.id ?? ''); setPropertyId(value.property?.id ?? ''); }
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (alive.current && !blocked.current && readAbort.current === controller) setReading(false); }
  }, [fail, request.id, reviewedSource.contact]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readAbort.current?.abort(); selectedAbort.current?.abort(); searchAbort.current?.abort(); }; }, []);
  useEffect(() => { if (!active || relation || blocked.current) return; let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void load(); }); return () => { cancelled = true; readAbort.current?.abort(); }; }, [active, relation, load]);
  useEffect(() => {
    if (!selected || blocked.current) return;
    const controller = new AbortController(); selectedAbort.current?.abort(); selectedAbort.current = controller;
    void customerRequest<CustomerDetail>(`/${encodeURIComponent(selected)}`, undefined, controller.signal).then(value => {
      if (alive.current && !blocked.current && !controller.signal.aborted && value.customer.id === selected) { setProperties(value.properties); if (relation?.property?.customerId === selected) setPropertyId(relation.property.id); }
    }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  }, [selected, relation?.property, fail]);
  const discard = useCallback(() => { if (saving || pending.current) return; setSelected(relation?.customer?.id ?? ''); setPropertyId(relation?.property?.id ?? ''); setReason(''); setDifferent(false); setError(''); }, [relation, saving]);
  useUnsavedChanges(`quote-client:${request.id}`, { dirty: Boolean(uncertain || reason || different || selected && selected !== relation?.customer?.id || propertyId && propertyId !== relation?.property?.id), busy:saving || uncertain, onDiscard:discard });
  async function findExisting() {
    if (!search.trim() || saving || uncertain || blocked.current) return;
    searchAbort.current?.abort(); const controller = new AbortController(); searchAbort.current = controller; setSearching(true); setError('');
    try { const value = await customerRequest<CustomerPage>(`?${new URLSearchParams({q:search,status:'all',page:'1',pageSize:'20'})}`,undefined,controller.signal); if (alive.current && !blocked.current && !controller.signal.aborted) setSearchMatches(value.customers.map(customer=>({customer,matchedBy:[]}))); }
    catch(cause) { if (!controller.signal.aborted) fail(cause); }
    finally { if (alive.current && !blocked.current && searchAbort.current === controller) setSearching(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!relation || saving || blocked.current || sourceStale && !pending.current) return;
    const candidate = available.find(item=>item.customer.id === selected);
    if (selected && !candidate && !pending.current) {setError('The selected client is no longer in this review. Refresh and choose again.');return;}
    if (candidate?.customer.status === 'archived') { setError('Restore the client before creating a new relation.'); return; }
    if (!pending.current) pending.current = { name:reviewedSource.contact.name,email:reviewedSource.contact.email,phone:reviewedSource.contact.phone,idempotencyKey:crypto.randomUUID(),decision: candidate ? {kind:'existing',customerId:candidate.customer.id,expectedRevision:candidate.customer.revision,reason} : different ? {kind:'different_person',reason,reviewedCandidates:candidates.map(item=>({id:item.customer.id,revision:item.customer.revision}))} : {kind:'auto'}, ...(propertyId === 'new' ? {property:site} : propertyId ? {propertyId} : {}), source:{type:'quote_request',id:request.id,expectedCrmRevision:relation.crmRevision,expectedSourceRevision:reviewedSource.revision} };
    setSaving(true); setError(''); setResult('');
    try {
      const value = await customerRequest<ResolveCustomerResult>('/resolve', pending.current);
      if (!alive.current || blocked.current) return;
      const next = parseQuoteCrmRelation({ requestId:request.id,crmRevision:value.crmRevision,customer:value.customer,property:value.property }, request.id);
      setRelation(next); setCandidates([{customer:value.customer,matchedBy:[]}]); setSelected(value.customer.id); setPropertyId(value.property?.id ?? ''); setReason(''); setDifferent(false); pending.current = null; setUncertain(false); setResult(value.outcome === 'client_created' ? 'Client created and linked. The original quote and customer access were preserved.' : 'Existing client linked. The original quote and customer access were preserved.');
    } catch (cause) {
      if (!alive.current || blocked.current) return;
      const matches = reviewCandidates<CustomerCandidate>(cause);
      if (matches) setCandidates(matches);
      if (cause instanceof CustomerRequestError && cause.status < 500) { pending.current = null; setUncertain(false); } else setUncertain(true);
      fail(cause);
    } finally { if (alive.current && !blocked.current) setSaving(false); }
  }
  const frozen = saving || uncertain, chosen = available.find(item=>item.customer.id === selected)?.customer;
  return <section className="ems-panel" aria-labelledby={`quote-client-${request.id}`}><h3 id={`quote-client-${request.id}`}>Client and property</h3>
    <p>Review the client before linking this saved quote. Matching contact details are suggestions; they do not merge people. Customer email verification is required for a new quote relation.</p>
    {sourceStale && <div className="ems-feedback" role="alert"><p>The quote changed after this review began. Your input is preserved; review the latest source before saving.</p><p>Reviewed revision {reviewedSource.revision}: {reviewedSource.contact.name} · {reviewedSource.contact.email} · {reviewedSource.contact.siteAddress}</p><p>Latest revision {request.revision}: {request.payload.contact.name} · {request.payload.contact.email} · {request.payload.contact.siteAddress}</p><button type="button" className="ems-button ems-button--secondary" disabled={frozen} onClick={()=>{setReviewedSource({revision:request.revision,contact:structuredClone(request.payload.contact)});setRelation(null);setSelected('');setPropertyId('');setCandidates([]);setSearchMatches([]);setReason('');setDifferent(false);setSite({label:'',address:{line1:request.payload.contact.siteAddress,unit:null,suburb:request.payload.contact.suburb,state:'',postcode:request.payload.contact.postcode,country:'AU'},contactName:null,notes:null});}}>Review latest quote and restart linking</button><p>This restarts the client selection and new property form with the latest quote.</p></div>}
    {reading && <p role="status">Loading client relation…</p>}{error && <p role="alert" className="ems-feedback ems-feedback--error">{error}</p>}{result && <p role="status" className="ems-feedback">{result}</p>}
    {relation?.customer && <div className="ems-summary"><div><strong>{relation.customer.name}</strong><p>Client: {relation.customer.status} · CRM revision {relation.crmRevision}</p><p>{relation.property ? `${relation.property.label} · ${relation.property.address.line1}${relation.property.address.unit ? ` · Unit ${relation.property.address.unit}` : ''}` : 'No property linked yet.'}</p></div><WorkspaceLink className="ems-button ems-button--secondary" href={`/admin/customers/${relation.customer.id}`}>Open linked client</WorkspaceLink></div>}
    {relation && <form onSubmit={event=>void save(event)}><fieldset disabled={frozen} className="ems-grid">
      <legend>Review client selection</legend><label className="ems-field"><span>Find another existing client</span><input type="search" maxLength={120} value={search} onChange={event=>setSearch(event.target.value)}/></label><button type="button" className="ems-button ems-button--secondary" disabled={reading || searching || !search.trim()} onClick={()=>void findExisting()}>Find existing client</button>{available.length > 0 ? <label className="ems-field"><span>Existing client</span><select value={selected} onChange={event=>{setSelected(event.target.value);setPropertyId('');setDifferent(false);setProperties([]);}}><option value="">Choose a client or review a separate person</option>{available.map(item=><option key={item.customer.id} value={item.customer.id}>{item.customer.name} · {item.customer.email || item.customer.phone || 'Name match'} · {item.customer.status}</option>)}</select></label> : <p>No matching client found. Saving creates a client for {reviewedSource.contact.name}. Search above to use a client with different contact details.</p>}
      {chosen?.status === 'archived' && <p>This client is archived. <WorkspaceLink href={`/admin/customers/${chosen.id}`}>Review and restore client</WorkspaceLink> before linking.</p>}
      {!selected && candidates.length > 0 && <label className="ems-field"><span><input type="checkbox" checked={different} onChange={event=>setDifferent(event.target.checked)}/> I reviewed these candidates and this is a different person or company</span></label>}
      <label className="ems-field"><span>Review reason{selected || different ? ' (required)' : ''}</span><textarea maxLength={500} required={Boolean(selected || different)} value={reason} onChange={event=>setReason(event.target.value)} /></label>
      <label className="ems-field"><span>Property</span><select value={propertyId} onChange={event=>setPropertyId(event.target.value)}><option value="">No property selected</option>{properties.filter(item=>item.status === 'active').map(item=><option key={item.id} value={item.id}>{item.label} · {item.address.line1}{item.address.unit ? ` · Unit ${item.address.unit}` : ''}</option>)}<option value="new">Add a new property</option></select></label>
      {propertyId === 'new' && <><label className="ems-field"><span>Property label</span><input required maxLength={120} value={site.label} onChange={event=>setSite({...site,label:event.target.value})}/></label>{(['line1','unit','suburb','state','postcode'] as const).map(key=><label className="ems-field" key={key}><span>{{line1:'Street address',unit:'Unit / apartment',suburb:'Suburb',state:'State',postcode:'Postcode'}[key]}</span><input required={key !== 'unit'} maxLength={key === 'line1' ? 250 : key === 'postcode' ? 4 : 120} value={site.address[key] ?? ''} onChange={event=>setSite({...site,address:{...site.address,[key]:event.target.value}})}/></label>)}</>}
    </fieldset><p className="ems-list-meta">Editing a property changes its current record. Signed documents, bookings and customer permissions retain their existing records.</p><div className="ems-actions"><button className="ems-button" disabled={saving || reading || sourceStale && !uncertain || chosen?.status === 'archived' || !selected && candidates.length > 0 && !different}>{saving ? 'Saving client relation…' : uncertain ? 'Retry unchanged client relation' : 'Save client relation'}</button><button type="button" className="ems-button ems-button--secondary" disabled={frozen || reading} onClick={()=>navigate(()=>{discard();void load();})}>Refresh client relation</button></div>{uncertain && <p role="alert">The result is unknown. Retry the same saved details to recover the result without creating another client or property.</p>}</form>}
    {!relation && !reading && <button type="button" className="ems-button ems-button--secondary" onClick={()=>void load()}>Retry client relation</button>}
  </section>;
}
