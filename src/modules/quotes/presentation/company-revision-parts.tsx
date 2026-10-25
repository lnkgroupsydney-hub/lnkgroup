import type { CompanyRevision, CompanyRevisionComparison, CompanyRevisionQuantities } from '../domain/company-revision';
import { NO_GST_NOTICE } from '../domain/pricing-display.ts';
import './company-revision.css';

/** Shared, read-only pieces of the company revised quote. Server values are always the amounts shown here. */
const MONEY = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
export const revisionMoney = (cents: number) => MONEY.format(cents / 100);
export function revisionDelta(cents: number) {
  if (cents === 0) return 'No change';
  return `${cents > 0 ? '+' : '−'}${MONEY.format(Math.abs(cents) / 100)}`;
}
export const revisionStatusLabels: Record<CompanyRevision['status'], string> = {
  draft: 'Draft · not sent', published: 'Sent · awaiting customer', accepted: 'Accepted by customer', superseded: 'Replaced by a later version', withdrawn: 'Withdrawn',
};
export const revisionStatusTone: Record<CompanyRevision['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning', published: 'warning', accepted: 'success', superseded: 'neutral', withdrawn: 'danger',
};
const emailWords: Record<string, string> = {
  pending: 'queued, not sent yet', sending: 'sending now', provider_accepted: 'accepted by the email provider (inbox delivery is not confirmed)',
  retrying: 'result not confirmed yet; retrying automatically with the same message', failed: 'not sent; it failed', manual_review: 'automatic retries stopped; company review needed',
  cancelled: 'cancelled — the version was withdrawn before sending',
};
/** Accepted revisions carry the acceptance receipt email; published ones carry the notice email. */
export function revisionEmailLabel(revision: Pick<CompanyRevision, 'status' | 'emailStatus'>) {
  const subject = revision.status === 'accepted' || revision.status === 'superseded' ? 'Acceptance receipt email' : 'Revised quote notice email';
  if (!revision.emailStatus) return revision.status === 'draft' ? 'No email is sent for a draft' : revision.status === 'withdrawn' ? 'No email is sent when a revised quote is withdrawn' : `${subject}: not queued`;
  return `${subject}: ${emailWords[revision.emailStatus] ?? revision.emailStatus.replaceAll('_', ' ')}`;
}
export function revisionReceiptLabel(revision: Pick<CompanyRevision, 'status' | 'receiptReady'>) {
  if (revision.status === 'draft') return 'No document until it is sent';
  const document = revision.status === 'accepted' || revision.status === 'superseded' ? 'Acceptance PDF' : 'Revised quote PDF';
  return revision.receiptReady ? `${document} saved (saving it does not mean it was delivered)` : `${document} not prepared yet`;
}

const quantityRows: { key: keyof CompanyRevisionQuantities; label: string }[] = [
  { key: 'doorCount', label: 'Cabinet doors' }, { key: 'drawerCount', label: 'Drawer fronts' }, { key: 'moderateRepair', label: 'Moderate coating repair' },
];
const showQuantity = (value: unknown) => typeof value === 'boolean' ? (value ? 'Included' : 'Not included') : String(value);
const contactLabels: Record<string, string> = { 'contact.name': 'Contact name', 'contact.email': 'Contact email', 'contact.phone': 'Phone', 'contact.siteAddress': 'Site address', 'contact.suburb': 'Suburb', 'contact.postcode': 'Postcode', 'contact.details': 'Project details' };
const shown = (value: unknown) => typeof value === 'string' ? (value.trim() ? value : 'Empty') : String(value);

/**
 * Original signed request versus the company revision. Tables collapse to labelled rows on narrow
 * screens so every amount keeps its column name without horizontal scrolling.
 */
export function RevisionComparison({ comparison, idPrefix, heading = 'What changed', level = 4, originalLabel = 'Original signed request', revisedLabel = 'Revised quote' }: { comparison: CompanyRevisionComparison; idPrefix: string; heading?: string; level?: 3 | 4 | 5; originalLabel?: string; revisedLabel?: string }) {
  const Heading = `h${level}` as const, Sub = `h${Math.min(level + 1, 6)}` as 'h4' | 'h5' | 'h6';
  const originalItems = new Map(comparison.original.lineItems.map(item => [item.code, item]));
  const revisedItems = new Map(comparison.company.lineItems.map(item => [item.code, item]));
  const codes = [...new Set([...originalItems.keys(), ...revisedItems.keys()])];
  const contactChanges = comparison.changes.filter(change => change.field.startsWith('contact.'));
  // Server-provided subtotal and tax make a GST-inclusive original add up; the revised quote never charges GST.
  const originalTax = comparison.original.taxCents > 0;
  return <section className="cr-compare" aria-labelledby={`${idPrefix}-compare`}>
    <Heading id={`${idPrefix}-compare`}>{heading}</Heading>
    <dl className="cr-totals">
      <div><dt>{originalLabel} total</dt><dd>{revisionMoney(comparison.original.totalCents)}</dd></div>
      <div className="cr-totals-new"><dt>{revisedLabel} total</dt><dd>{revisionMoney(comparison.company.totalCents)}</dd></div>
      <div><dt>Difference{originalTax ? ' (includes removing the original GST)' : ''}</dt><dd>{revisionDelta(comparison.deltaCents)}</dd></div>
    </dl>
    <p className="cr-muted">{revisedLabel}: {NO_GST_NOTICE.charAt(0).toLowerCase() + NO_GST_NOTICE.slice(1)} {originalTax ? `${originalLabel}: included ${revisionMoney(comparison.original.taxCents)} GST, shown as signed.` : `${originalLabel}: shown as signed.`} All amounts are in Australian dollars.</p>
    <table className="cr-table">
      <caption><Sub>Quantities</Sub></caption>
      <thead><tr><th scope="col">Item</th><th scope="col">{originalLabel}</th><th scope="col">{revisedLabel}</th></tr></thead>
      <tbody>{quantityRows.map(row => { const before = comparison.original.quantities[row.key], after = comparison.company.quantities[row.key], changed = before !== after; return <tr key={row.key} data-changed={changed || undefined}>
        <th scope="row">{row.label}{changed && <span className="cr-tag">Changed</span>}</th><td data-label={originalLabel}>{showQuantity(before)}</td><td data-label={revisedLabel}>{showQuantity(after)}</td>
      </tr>; })}</tbody>
    </table>
    <table className="cr-table">
      <caption><Sub>Price breakdown</Sub></caption>
      <thead><tr><th scope="col">Line item</th><th scope="col">{originalLabel}</th><th scope="col">{revisedLabel}</th></tr></thead>
      <tbody>{codes.map(code => { const before = originalItems.get(code), after = revisedItems.get(code), item = after ?? before!, changed = before?.amount !== after?.amount; return <tr key={code} data-changed={changed || undefined}>
        <th scope="row">{item.label}{!before && <span className="cr-tag">Added</span>}{!after && <span className="cr-tag">Removed</span>}</th>
        <td data-label={originalLabel}>{before ? revisionMoney(before.amount) : <span aria-label="Not included">—</span>}</td><td data-label={revisedLabel}>{after ? revisionMoney(after.amount) : <span aria-label="Not included">—</span>}</td>
      </tr>; })}</tbody>
      <tfoot>{originalTax && <><tr><th scope="row">Subtotal</th><td data-label={originalLabel}>{revisionMoney(comparison.original.subtotalCents)}</td><td data-label={revisedLabel}>{revisionMoney(comparison.company.totalCents)}</td></tr><tr><th scope="row">GST (as signed)</th><td data-label={originalLabel}>{revisionMoney(comparison.original.taxCents)}</td><td data-label={revisedLabel}>No GST</td></tr></>}<tr className="cr-total-row"><th scope="row">Total</th><td data-label={originalLabel}>{revisionMoney(comparison.original.totalCents)}</td><td data-label={revisedLabel}>{revisionMoney(comparison.company.totalCents)}</td></tr></tfoot>
    </table>
    {contactChanges.length > 0 && <div className="cr-changes"><Sub>Contact and site details</Sub><ul>{contactChanges.map(change => <li key={change.field}><strong>{contactLabels[change.field] ?? change.field}:</strong> {shown(change.before)} → {shown(change.after)}</li>)}</ul></div>}
  </section>;
}

/** Extra items with the reason given to the customer, and the company note. */
export function RevisionNotes({ revision, level = 5 }: { revision: Pick<CompanyRevision, 'payload'>; level?: 4 | 5 | 6 }) {
  const Heading = `h${level}` as const, { extraItems, customerNote } = revision.payload;
  if (!extraItems.length && !customerNote) return null;
  return <div className="cr-notes">
    {extraItems.length > 0 && <><Heading>Additional items</Heading><ul>{extraItems.map(item => <li key={item.id}><strong>{item.description}</strong> · {revisionMoney(item.amountCents)}<br /><span>Why: {item.reason}</span></li>)}</ul></>}
    {customerNote && <><Heading>Note from the company</Heading><p className="cr-note-text">{customerNote}</p></>}
  </div>;
}
