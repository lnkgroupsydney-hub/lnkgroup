import type { LiveQuoteRequest } from '../index';
import { displayTime, intentLabels, surfaceLabels } from './request-client';

export function LiveRequestDetails({ request }: { request: LiveQuoteRequest }) {
  const { contact, service } = request.payload;
  return <dl className="lq-details">
    <div><dt>Reference</dt><dd>{request.reference}</dd></div>
    <div><dt>Status</dt><dd>{request.status === 'review_requested' ? 'Company review requested' : 'In progress'}</dd></div>
    <div><dt>Contact</dt><dd>{contact.name}<br />{contact.email}<br />{contact.phone || 'No phone provided'}</dd></div>
    <div><dt>Site address</dt><dd>{contact.siteAddress}<br />{contact.suburb} {contact.postcode}</dd></div>
    <div><dt>Project details</dt><dd>{contact.details || 'No additional details'}</dd></div>
    <div><dt>Service</dt><dd>{service ? `Kitchen Cabinet Painting — ${intentLabels[service.intent] ?? service.intent}` : 'Not saved yet'}</dd></div>
    {service && <>
      <div><dt>Surfaces</dt><dd>{service.surfaces.map(value => surfaceLabels[value] ?? value).join(', ')}</dd></div>
      <div><dt>Quantities</dt><dd>Doors: {service.doorCount ?? 'Not known'} · Drawer fronts: {service.drawerCount ?? 'Not known'}</dd></div>
      <div><dt>Material / finish</dt><dd>{service.material || 'Not known'} / {service.colourPreference || 'Not decided'}</dd></div>
    </>}
    <div><dt>Last saved</dt><dd>{displayTime(request.savedAt)} (Sydney) · Revision {request.revision}</dd></div>
  </dl>;
}
