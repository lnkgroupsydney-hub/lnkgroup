import type { Customer } from "../domain/contracts";
import { useId } from "react";
import { AdminStatusBadge } from "@/shared/ui/admin";
import "./customers-console.css";

export type Candidate = { customer: Customer; matchedBy: string[] };
export function CustomerCandidateReview({ candidates, disabled, onExisting, reason, onReason, confirmed, onConfirmed }: {
  candidates: Candidate[]; disabled: boolean; onExisting?: (customer: Customer) => void;
  reason: string; onReason: (reason: string) => void; confirmed: boolean; onConfirmed: (confirmed: boolean) => void;
}) {
  const reasonId = useId();
  return <section className="ems-panel customers-review" aria-label="Review possible duplicate clients">
    <h3>Review possible matches</h3><p>A shared email or phone may belong to different people. Compare these saved clients before continuing.</p>
    <ul className="ems-list">{candidates.map(({ customer, matchedBy }) => <li className="ems-record-row" key={customer.id}>
      <div className="ems-record-main"><h4>{customer.name}</h4><AdminStatusBadge tone={customer.status === "archived" ? "warning" : "neutral"}>{customer.status || "active"}</AdminStatusBadge><p>{customer.email || "No email"} · {customer.phone || "No phone"}</p><p>{customer.address || "No client address"}</p><p className="ems-list-meta">Matches: {matchedBy.join(", ")} · Revision {customer.revision}</p></div>
      {onExisting && <div className="ems-record-actions"><button className="ems-button ems-button--secondary" type="button" disabled={disabled} onClick={() => onExisting(customer)}>{customer.status === "archived" ? "Review and restore customer" : "Use existing client"}</button></div>}
    </li>)}</ul>
    <div className="ems-field"><label htmlFor={reasonId}>Client review reason</label><textarea id={reasonId} maxLength={500} rows={3} value={reason} disabled={disabled} onChange={event => { onReason(event.target.value); onConfirmed(false); }} /></div>
    <label className="customers-checkbox"><input type="checkbox" checked={confirmed} disabled={disabled || !reason.trim()} onChange={event => onConfirmed(event.target.checked)} />I reviewed every candidate and verified this is a different person or company.</label>
    <p className="ems-list-meta">An archived match for the same client must be restored. Use the different person option only after verifying a separate identity.</p>
  </section>;
}
