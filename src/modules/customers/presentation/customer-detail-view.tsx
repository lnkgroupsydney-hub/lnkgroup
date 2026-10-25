import type { CustomerDetail, CustomerRecord } from "../domain/contracts";
import { AdminEmptyState, AdminStatusBadge } from "@/shared/ui/admin";
import { contact, filePath, quoteDetailPath, sourceLabel, time } from "./customer-record-view";
import { WorkspaceLink } from "@/shared/ui/admin-workspace-state";

export const customerTabs = [
  { id: "summary", label: "Summary" }, { id: "properties", label: "Properties" }, { id: "records", label: "Connected records" },
  { id: "documents", label: "Documents" }, { id: "photos", label: "Photos" }, { id: "activity", label: "Activity" },
];

type Props = { detail: CustomerDetail; tab: string; disabled: boolean; onPropose: (action: "link" | "unlink", record: CustomerRecord) => void };

export function CustomerDetailView({ detail, tab, disabled, onPropose }: Props) {
  if (tab === "summary") return <>
    <h3>Contact details</h3>{contact(detail.customer)}
    <div className="ems-detail-grid">
      <section><h3>Connected records</h3><p>{detail.records.length} source records linked to this client.</p><p className="ems-list-meta">Original details and documents are preserved when a record is linked.</p></section>
      <section><h3>Properties</h3><p>{detail.properties?.filter(property => property.status === "active").length || 0} active job locations. Open Properties to add or manage locations.</p></section>
      <section><h3>Purchases and billing</h3><p>Not available yet.</p></section>
    </div>
  </>;
  if (tab === "properties") return null;
  if (tab === "records") return <>
    <h3>Linked records</h3>
    {detail.records.length === 0 ? <AdminEmptyState title="No connected records" description="Compare an unlinked source below before linking it to this client." /> : <ul className="ems-list">{detail.records.map(record => <li className="ems-record-row" key={`${record.sourceType}:${record.sourceId}`}>
      <div className="ems-record-main"><h4>{record.reference}</h4><p>{sourceLabel(record)}</p><AdminStatusBadge>{record.status}</AdminStatusBadge>
        {record.booking && <p className="ems-list-meta">Booking: {record.booking.status} · Calendar sync: {record.booking.syncStatus} · Revision {record.booking.revision}</p>}
        <details><summary>Original contact details</summary>{contact(record)}</details>
      </div><div className="ems-record-actions">{quoteDetailPath(record) && <WorkspaceLink className="ems-button ems-button--secondary" href={quoteDetailPath(record)!}>Open operating quote</WorkspaceLink>}{record.sourceType !== "quote_request" && <button className="ems-button ems-button--secondary" type="button" disabled={disabled} onClick={() => onPropose("unlink", record)}>Review unlink</button>}</div>
    </li>)}</ul>}
    <p className="ems-list-meta">Enquiries, signed demo submissions and operating quotes keep their original details and private access rules.</p>
  </>;
  if (tab === "documents") {
    const records = detail.records.filter(record => filePath(record.links.quotePdf, "pdf") || filePath(record.links.agreementPdf, "pdf"));
    return <><h3>Documents</h3>{records.length === 0 ? <AdminEmptyState title="No linked documents" description="Documents appear here when a connected source has an authorized file available." /> : <ul className="ems-list">{records.map(record => <li className="ems-record-row" key={`${record.sourceType}:${record.sourceId}`}><div className="ems-record-main"><h4>{record.reference}</h4><p>{sourceLabel(record)}</p></div><div className="ems-record-actions">
      {filePath(record.links.quotePdf, "pdf") && <a className="ems-button ems-button--secondary" href={record.links.quotePdf!} target="_blank" rel="noreferrer">Open quote PDF</a>}
      {filePath(record.links.agreementPdf, "pdf") && <a className="ems-button ems-button--secondary" href={record.links.agreementPdf!} target="_blank" rel="noreferrer">Open agreement PDF</a>}
    </div></li>)}</ul>}<p className="ems-list-meta">Documents open through their existing private access checks. An unavailable file does not change the client link. A signed demo submission is not a verified operating contract.</p></>;
  }
  if (tab === "photos") {
    const records = detail.records.filter(record => record.photos.some(photo => filePath(photo.url, "photo")));
    return <><h3>Private photos</h3>{records.length === 0 ? <AdminEmptyState title="No linked photos" description="Available private photos from connected source records appear here." /> : <ul className="ems-list">{records.map(record => <li className="ems-record-row" key={`${record.sourceType}:${record.sourceId}`}><div className="ems-record-main"><h4>{record.reference}</h4><p>{sourceLabel(record)}</p></div><div className="ems-record-actions">{record.photos.map((photo, index) => filePath(photo.url, "photo") && <a className="ems-button ems-button--secondary" href={photo.url} key={photo.id} target="_blank" rel="noreferrer">Open private photo {index + 1}</a>)}</div></li>)}</ul>}<p className="ems-list-meta">Each photo opens through the source record’s private access check.</p></>;
  }
  return <><h3>Client activity</h3>{detail.audit.length === 0 ? <AdminEmptyState title="No activity available" description="Client and property changes appear here after they are saved." /> : <ol className="ems-list customers-audit">{detail.audit.map(event => <li className="ems-record-row" key={event.id}><div className="ems-record-main"><h4>{event.action.replaceAll("_", " ")}</h4><p>{event.reason}</p>{event.sourceId && <p>Source: {event.sourceType} · {event.sourceId}</p>}<p className="ems-list-meta">{time(event.createdAt)} (Sydney) · Revision {event.revision} · Staff account {event.actorUserId}</p></div></li>)}</ol>}</>;
}
