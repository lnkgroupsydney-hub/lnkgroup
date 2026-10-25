'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface QuoteMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  href?: string;
}

/** Header menu button: Esc/outside click close, arrow keys move, focus returns to the button. */
export function QuoteMenu({ label, icon, items }: { label: string; icon?: ReactNode; items: QuoteMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId(), root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const enabled = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  function focusItem(position: 'first' | 'last' | number) {
    const options = enabled(); if (!options.length) return;
    const index = position === 'first' ? 0 : position === 'last' ? options.length - 1 : (position + options.length) % options.length;
    options[index].focus();
  }
  function close(returnFocus: boolean) { setOpen(false); if (returnFocus) button.current?.focus({ preventScroll: true }); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function openWith(position: 'first' | 'last') { setOpen(true); requestAnimationFrame(() => focusItem(position)); }
  function buttonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openWith(event.key === 'ArrowDown' ? 'first' : 'last'); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
  }
  function menuKey(event: KeyboardEvent<HTMLDivElement>) {
    const options = enabled(), index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(index + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(index < 0 ? -1 : index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusItem('first'); }
    else if (event.key === 'End') { event.preventDefault(); focusItem('last'); }
    else if (event.key === 'Tab') setOpen(false);
  }
  function activate(item: QuoteMenuItem) {
    if (item.disabled) return;
    // Return focus first; an action that moves focus (a step heading) runs afterwards and wins.
    close(true); item.onSelect?.();
  }
  return <div className="lq-menu" ref={root}>
    <button ref={button} type="button" className="secondary lq-menu-button" aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => open ? close(false) : openWith('first')} onKeyDown={buttonKey}>{icon}<span>{label}</span><ChevronDown size={16} aria-hidden="true" className="lq-menu-chevron" /></button>
    <div ref={list} id={`${id}-menu`} role="menu" aria-label={label} className="lq-menu-list" hidden={!open} onKeyDown={menuKey}>
      {items.map(item => item.href
        ? <a key={item.key} role="menuitem" tabIndex={-1} href={item.href} onClick={() => setOpen(false)}>{item.icon}<span>{item.label}</span></a>
        : <button key={item.key} type="button" role="menuitem" tabIndex={-1} aria-label={item.label} aria-disabled={item.disabled || undefined} onClick={() => activate(item)}>{item.icon}<span>{item.label}</span></button>)}
    </div>
  </div>;
}
