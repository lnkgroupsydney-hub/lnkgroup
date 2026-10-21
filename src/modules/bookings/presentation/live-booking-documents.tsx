'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveCompanyBookingState } from '../domain/live-contracts';
import { currentAcceptance } from './live-booking-client';

export function LiveCompanyBookingDocuments({state,staff=false,onAccessLost}:{state:LiveCompanyBookingState;staff?:boolean;onAccessLost:()=>void}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const mounted=useRef(false), generation=useRef(0), running=useRef(false), controller=useRef<AbortController|null>(null), callbacks=useRef({onAccessLost});
  const invalidate=useCallback(()=>{generation.current++;},[]);
  useEffect(()=>{callbacks.current={onAccessLost};},[onAccessLost]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;invalidate();controller.current?.abort();};},[invalidate,state.requestId]);
  async function download(kind:'proposal'|'acceptance'|'confirmation') {
    if(running.current)return;running.current=true;const version=++generation.current,abort=new AbortController();controller.current=abort;setBusy(true);setError('');
    const base=staff?`/api/admin/live-bookings/${encodeURIComponent(state.requestId)}`:'/api/quote/requests/company-booking';
    try {
      const response=await fetch(`${base}/documents/${kind}`,{credentials:'same-origin',cache:'no-store',headers:{'x-lk-quote-request-id':state.requestId},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(35_000)])});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/pdf')){if([401,403].includes(response.status)){callbacks.current.onAccessLost();return;}throw new Error('This frozen PDF is not ready yet. Refresh saved status and retry.');}
      const blob=await response.blob();if(!mounted.current||version!==generation.current)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${state.submission.reference}-${kind}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10_000);
    } catch(cause){if(mounted.current&&version===generation.current)setError(cause instanceof Error?cause.message:'The private PDF could not be downloaded.');}
    finally{running.current=false;if(mounted.current&&version===generation.current)setBusy(false);}
  }
  return <><div className="live-company-actions">{state.proposal&&state.proposal.confirmationBasis!=='signed_request'&&<button type="button" className="secondary" disabled={busy||!state.proposal.receiptReady} onClick={()=>void download('proposal')}>Download saved company proposal PDF</button>}{currentAcceptance(state)&&<button type="button" className="secondary" disabled={busy||!state.acceptance?.receiptReady} onClick={()=>void download('acceptance')}>Download saved acknowledgment PDF</button>}{state.booking&&['confirmed','cancel_pending','cancelled'].includes(state.booking.status)&&<button type="button" className="secondary" disabled={busy||!state.booking.receiptReady} onClick={()=>void download('confirmation')}>{state.booking.status==='confirmed'?'Download booking confirmation PDF':'Download original booking confirmation PDF'}</button>}</div>{error&&<p className="live-company-error" role="alert">{error}</p>}</>;
}
