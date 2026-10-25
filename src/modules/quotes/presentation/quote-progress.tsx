'use client';

import { useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Lock, MailCheck } from 'lucide-react';

export interface QuoteProgressStage { title: string; description: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }> }
export type QuoteEmailProgress = 'done' | 'current' | 'todo';

/**
 * Six-step progress. Desktop shows the full list; at 700px and below the same
 * list opens from a one-line summary with a six-part bar. Locked steps keep
 * focus (aria-disabled) and explain why they are locked.
 */
export function QuoteProgress({ stages, step, accessOpen, lockReason, onSelect, email }: {
  stages: readonly QuoteProgressStage[]; step: number; accessOpen: boolean;
  lockReason: (index: number) => string | null; onSelect: (index: number) => void; email: QuoteEmailProgress | null;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const current = Math.min(step, stages.length - 1), received = step >= stages.length;
  const summary = accessOpen ? 'Saved quotes' : received ? 'Request received' : `Step ${current + 1} of ${stages.length} · ${stages[current].title}`;
  function listKey(event: KeyboardEvent<HTMLOListElement>) {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); toggle.current?.focus({ preventScroll: true }); }
  }
  return <nav className="lq-progress-nav" aria-label="Quote steps" data-open={open || undefined}>
    <button ref={toggle} type="button" className="lq-progress-toggle" aria-expanded={open} aria-controls="quote-progress-list" onClick={() => setOpen(value => !value)}>
      <span className="lq-progress-summary">{summary}</span>
      <span className="lq-progress-bar" aria-hidden="true">{stages.map((stage, index) => <span key={stage.title} data-state={received || index < step ? 'complete' : index === step && !accessOpen ? 'current' : undefined} />)}</span>
      <ChevronDown size={18} aria-hidden="true" className="lq-progress-chevron" />
      <span className="lq-sr-only">{open ? 'Hide all steps' : 'Show all steps'}</span>
    </button>
    <ol id="quote-progress-list" className="lq-progress" aria-label="Request progress" onKeyDown={listKey}>{stages.map(({ title, description, icon: Icon }, index) => {
      const reason = lockReason(index), state = !accessOpen && step === index ? 'current' : step > index ? 'complete' : reason ? 'locked' : 'open';
      const describedBy = `quote-step-${index}-note`;
      return <li key={title} aria-current={!accessOpen && step === index ? 'step' : undefined} data-complete={step > index || undefined} data-state={state}>
        <button type="button" aria-disabled={reason ? true : undefined} aria-describedby={describedBy} onClick={() => { if (reason) return; setOpen(false); onSelect(index); }}>
          <span className="lq-step-symbol">{state === 'complete' ? <Check size={16} aria-hidden="true" /> : state === 'locked' ? <Lock size={14} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />}</span>
          <span className="lq-step-text"><strong>{title}</strong><small id={describedBy}>{state === 'complete' ? (reason ? 'Done' : 'Done · Edit') : state === 'locked' ? reason : description}</small></span>
        </button>
        {index === 4 && email && <p className="lq-progress-sub" data-state={email}><MailCheck size={14} aria-hidden="true" /><span>Verify email</span><span className="lq-sr-only">{email === 'done' ? ' — done' : email === 'current' ? ' — needed now' : ' — part of this step'}</span></p>}
      </li>;
    })}</ol>
  </nav>;
}
