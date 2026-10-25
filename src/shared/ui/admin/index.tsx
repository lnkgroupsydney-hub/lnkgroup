"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function AdminPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ems-panel ${className}`.trim()}>{children}</section>;
}

export function AdminEmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="ems-empty"><h3>{title}</h3><p>{description}</p>{children && <div className="ems-actions">{children}</div>}</div>;
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function AdminStatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`ems-status ems-status--${tone}`}>{children}</span>;
}

export function AdminPageHeader({ title, description, eyebrow, children }: { title: string; description: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="ems-page-header"><div>{eyebrow && <p className="ems-eyebrow">{eyebrow}</p>}<h1 tabIndex={-1} data-admin-heading>{title}</h1><p>{description}</p></div>{children}</header>;
}

export type AdminTabPanelProps = { id: string; role: "tabpanel"; "aria-labelledby": string; tabIndex: 0; hidden: boolean };
type TabItem = { id: string; label: string };
export function AdminTabs({ activeId, onChange, items, label = "Record details", children }: {
  activeId: string;
  onChange: (id: string) => void;
  items: readonly TabItem[];
  label?: string;
  children?: (activeId: string, panelProps: AdminTabPanelProps, getPanelProps: (id: string) => AdminTabPanelProps) => ReactNode;
}) {
  const baseId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterSelection = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfterSelection.current === activeId) {
      buttons.current.get(activeId)?.focus();
      focusAfterSelection.current = null;
    }
  }, [activeId]);
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const getPanelProps = (id: string): AdminTabPanelProps => ({ id: `${baseId}-panel-${id}`, role: "tabpanel", "aria-labelledby": tabId(id), tabIndex: 0, hidden: id !== activeId });
  return <><div className="ems-tabs" role="tablist" aria-label={label}>{items.map((item, index) => <button
    key={item.id} type="button" role="tab" id={tabId(item.id)} aria-selected={item.id === activeId}
    aria-controls={getPanelProps(item.id).id} tabIndex={item.id === activeId ? 0 : -1}
    ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }}
    onClick={() => { focusAfterSelection.current = null; onChange(item.id); }}
    onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      const destination = items[next].id;
      if (destination === activeId) { buttons.current.get(destination)?.focus(); return; }
      focusAfterSelection.current = destination;
      onChange(destination);
    }}
  >{item.label}</button>)}</div>{children?.(activeId, getPanelProps(activeId), getPanelProps)}</>;
}
