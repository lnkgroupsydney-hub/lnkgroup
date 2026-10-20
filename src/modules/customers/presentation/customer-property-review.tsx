import type { CustomerProperty } from "../domain/contracts";
import { AdminStatusBadge } from "@/shared/ui/admin";

export function CustomerPropertyReview({ properties, disabled, reason, confirmed, onConfirmed, onExisting }: {
  properties: CustomerProperty[]; disabled: boolean; reason: string; confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void; onExisting?: (property: CustomerProperty) => void;
}) {
  return <section className="ems-panel" aria-label="Review possible duplicate properties">
    <h3>Review possible property matches</h3>
    <p>The saved and entered addresses may describe the same location. Compare street details and unit numbers before continuing.</p>
    <ul className="ems-list">{properties.map(property => <li className="ems-record-row" key={property.id}>
      <div className="ems-record-main"><h4>{property.label}</h4><AdminStatusBadge tone={property.status === "archived" ? "warning" : "neutral"}>{property.status}</AdminStatusBadge>
        <p>Unit/apartment: {property.address.unit || "Not provided"}</p><p>{[property.address.line1, property.address.suburb, property.address.state, property.address.postcode, property.address.country].filter(Boolean).join(", ")}</p>
        <p className="ems-list-meta">Revision {property.revision}</p>
      </div>
      {onExisting && <div className="ems-record-actions"><button className="ems-button ems-button--secondary" type="button" disabled={disabled} onClick={() => onExisting(property)}>Use existing property</button></div>}
    </li>)}</ul>
    <label className="customers-checkbox"><input type="checkbox" checked={confirmed} disabled={disabled || !reason.trim()} onChange={event => onConfirmed(event.target.checked)} />I reviewed every candidate and verified this is a different property.</label>
    <p className="ems-list-meta">Enter the reason above before confirming a different property. Selecting an existing property creates no new record; an archived property must be restored before new work uses it.</p>
  </section>;
}
