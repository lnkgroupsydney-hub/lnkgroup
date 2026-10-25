import type { CustomerProperty, PropertyInput } from "../domain/contracts";
import { useId } from "react";
import { AdminStatusBadge } from "@/shared/ui/admin";
import "./customers-console.css";

const addressLine = (address: PropertyInput["address"]) => [address.line1, address.suburb, address.state, address.postcode, address.country].filter(Boolean).join(", ");

/**
 * Lists every saved property the server matched. Optional props let a caller show the entered
 * address, own the reason field and block archived properties; omitting them keeps the
 * customer-management behaviour unchanged.
 */
export function CustomerPropertyReview({ properties, disabled, reason, confirmed, onConfirmed, onExisting, entered, onReason, archivedSelectable = true }: {
  properties: CustomerProperty[]; disabled: boolean; reason: string; confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void; onExisting?: (property: CustomerProperty) => void;
  entered?: PropertyInput; onReason?: (reason: string) => void; archivedSelectable?: boolean;
}) {
  const reasonId = useId();
  return <section className="ems-panel customers-review" aria-label="Review possible duplicate properties">
    <h3>Review possible property matches</h3>
    <p>The saved and entered addresses may describe the same location. Compare street details and unit numbers before continuing.</p>
    {entered && <div className="customers-entered-property">
      <h4>Entered property (not saved)</h4>
      <p><strong>{entered.label || "No property label"}</strong></p>
      <p>Unit/apartment: {entered.address.unit || "Not provided"}</p>
      <p>{addressLine(entered.address)}</p>
    </div>}
    <ul className="ems-list">{properties.map(property => {
      const blocked = !archivedSelectable && property.status === "archived";
      return <li className="ems-record-row" key={property.id}>
        <div className="ems-record-main"><h4>{property.label}</h4><AdminStatusBadge tone={property.status === "archived" ? "warning" : "neutral"}>{property.status}</AdminStatusBadge>
          <p>Unit/apartment: {property.address.unit || "Not provided"}</p><p>{addressLine(property.address)}</p>
          <p className="ems-list-meta">Revision {property.revision}{blocked ? " · Restore this property from the client record before new work uses it." : ""}</p>
        </div>
        {onExisting && <div className="ems-record-actions"><button className="ems-button ems-button--secondary" type="button" disabled={disabled || blocked} aria-label={`Use existing property: ${property.label}${property.address.unit ? `, unit ${property.address.unit}` : ""}`} onClick={() => onExisting(property)}>Use existing property</button></div>}
      </li>;
    })}</ul>
    {onReason && <div className="ems-field"><label htmlFor={reasonId}>Property review reason</label><textarea id={reasonId} maxLength={500} rows={3} value={reason} disabled={disabled} onChange={event => { onReason(event.target.value); onConfirmed(false); }} /></div>}
    <label className="customers-checkbox"><input type="checkbox" checked={confirmed} disabled={disabled || !reason.trim()} onChange={event => onConfirmed(event.target.checked)} />I reviewed every candidate and verified this is a different property.</label>
    <p className="ems-list-meta">Enter the reason above before confirming a different property. Selecting an existing property creates no new record; an archived property must be restored before new work uses it.</p>
  </section>;
}
