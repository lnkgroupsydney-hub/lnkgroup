'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceDraft } from '@/shared/ui/admin-workspace-state';
import type { LiveCompanyBookingState } from '../domain/live-contracts';
import { companyBookingRequest, LiveCompanyRequestError, newerCompanyState, parseCompanyState } from './live-booking-client';

type Attempt = { path: string; method: string; payload: Record<string, unknown> };
export function useCompanyBookingState(requestId: string, staff: boolean, onAccessLost: () => void) {
  const [state,setState] = useState<LiveCompanyBookingState | null>(null), [loaded,setLoaded] = useState(false), [busy,setBusy] = useState(false), [refreshing,setRefreshing] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [attempt,setAttempt] = useWorkspaceDraft<Attempt | null>(`live-booking.${staff?'staff':'customer'}.${requestId}.attempt`,null);
  const active = useRef(false), generation = useRef(0), running = useRef(false), reading = useRef(false), abort = useRef<AbortController | null>(null), callbacks = useRef({onAccessLost});
  const failureStatus=useRef<number|null>(null);
  const base = staff ? `/api/admin/live-bookings/${encodeURIComponent(requestId)}` : '/api/quote/requests/company-booking';
  useEffect(()=>{callbacks.current={onAccessLost};},[onAccessLost]);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    if (cause instanceof LiveCompanyRequestError && [401,403].includes(cause.status)) { abort.current?.abort(); generation.current++; setState(null);setAttempt(null);setError('');callbacks.current.onAccessLost(); return; }
    setError(cause instanceof Error ? cause.message : 'This company booking could not be verified.');
  },[setAttempt]);
  const refresh = useCallback(async () => {
    if (running.current || reading.current) return;
    reading.current=true; const version=++generation.current, controller=new AbortController(); abort.current?.abort();abort.current=controller;
    // Status polling is read-only. It must not freeze unsaved price/period input
    // or a customer's signature while the saved status is checked in the background.
    if(active.current)setRefreshing(true);
    try {
      const value=parseCompanyState(await companyBookingRequest(staff?`/api/admin/live-bookings?requestId=${encodeURIComponent(requestId)}`:base,requestId,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35_000)])}),requestId);
      if(active.current && version===generation.current) {setState(old=>newerCompanyState(old,value));setLoaded(true);setError('');}
    } catch(cause) {if(active.current&&version===generation.current)fail(cause);}
    finally {reading.current=false;if(active.current&&version===generation.current)setRefreshing(false);}
  },[base,fail,requestId,staff]);
  const invalidateRequests=useCallback(()=>{generation.current++;},[]);
  useEffect(()=>{active.current=true;let cancelled=false;void Promise.resolve().then(()=>{if(!cancelled)return refresh();});const timer=setInterval(()=>void refresh(),15_000);return()=>{cancelled=true;active.current=false;invalidateRequests();abort.current?.abort();clearInterval(timer);};},[refresh,invalidateRequests]);
  async function send(value: Attempt) {
    if(running.current)return null;
    running.current=true;failureStatus.current=null;abort.current?.abort();const version=++generation.current;setRefreshing(false);setBusy(true);setError('');setNotice('');setAttempt(value);
    try {
      const next=parseCompanyState(await companyBookingRequest(value.path,requestId,{method:value.method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value.payload)}),requestId);
      if(!active.current||version!==generation.current)return null;
      setState(old=>newerCompanyState(old,next));setLoaded(true);setAttempt(null);setNotice('Saved company booking status has been verified.');return next;
    } catch(cause) {
      if(!active.current||version!==generation.current)return null;
      failureStatus.current=cause instanceof LiveCompanyRequestError?cause.status:null;
      if(cause instanceof LiveCompanyRequestError && [400,401,403,409,422].includes(cause.status))setAttempt(null);
      fail(cause);return null;
    } finally {running.current=false;if(active.current&&version===generation.current)setBusy(false);}
  }
  function command(action: string, payload: Record<string,unknown>, method='POST') { if(attempt||running.current)return Promise.resolve(null);return send({path:`${base}/${action}`,method,payload}); }
  return {state,loaded,busy,refreshing,error,notice,attempt,refresh,command,retry:()=>attempt?send(attempt):Promise.resolve(null),fail,failureStatus};
}
