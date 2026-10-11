import type { PublicAnalysisJob } from '../domain/photo-workspace';
import type { AnalysisQuantity, EstimatedAnalysisQuantity } from '../domain/analysis';
import type { EstimatePricing } from '../domain/pricing';
import { displayTime, surfaceLabels } from './request-client.ts';
import { photoRoleLabels } from './photo-workspace-client.ts';
const outcomeLabels = { analysis_ready: 'Photo assessment ready', additional_photos_required: 'Additional photos needed', site_review_required: 'Details need confirmation or an on-site check' };
function isEstimatedQuantity(value: AnalysisQuantity): value is EstimatedAnalysisQuantity {
  return 'estimated' in value && 'note' in value && 'confidence' in value && 'basisPhotoIds' in value;
}
function money(cents: number) {
  return `A$${new Intl.NumberFormat('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100)}`;
}
function SavedEstimatePricing({ pricing }: { pricing: EstimatePricing }) {
  if (pricing.status === 'awaiting_company_rates') return <p className="lq-notice"><strong>Earlier analysis: pricing setup was pending.</strong> {pricing.notice} Request a new analysis for the current saved details to use the current pricing rules. This earlier result has no estimate amount.</p>;
  const provisional = pricing.status === 'provisional_estimate';
  const priced = pricing.status === 'estimate_ready' || provisional;
  return <div className="lq-estimate">
    <h5>{provisional ? 'Provisional painting estimate' : priced ? 'Photo-based estimate' : 'More information needed before an estimate'}</h5>
    {priced ? <>
      <p className="lq-estimate-total"><strong>{money(pricing.total!)} incl GST</strong><span>{provisional ? 'Based on AI-estimated cabinet-front quantities — subject to site inspection' : 'Estimated total for the saved scope'}</span></p>
      {provisional && <p className="lq-notice"><strong>Estimated painting cost, not a final project quote.</strong> We will check the exact quantities, condition and work scope on site before adjusting the final price. Unpriced work listed below is additional and is not included in this amount.</p>}
      <div className="lq-price-table" role="region" aria-label="Estimate price breakdown" tabIndex={0}>
        <table><caption>Work and price breakdown (AUD)</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">{provisional ? 'Estimated quantity' : 'Quantity'}</th><th scope="col">Unit price (ex GST)</th><th scope="col">Amount (ex GST)</th></tr></thead>
          <tbody>{pricing.lineItems.map(item => <tr key={item.code}><th scope="row">{item.label}</th><td>{provisional && ['doors', 'drawers'].includes(item.code) ? `Approx. ${item.quantity}` : item.quantity}</td><td>{money(item.unitAmount)}</td><td>{money(item.amount)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={3}>Subtotal (ex GST)</th><td>{money(pricing.subtotal!)}</td></tr><tr><th scope="row" colSpan={3}>GST (10%)</th><td>{money(pricing.tax!)}</td></tr><tr className="lq-price-total"><th scope="row" colSpan={3}>{provisional ? 'Provisional painting amount (incl GST)' : 'Estimated total (incl GST)'}</th><td><strong>{money(pricing.total!)}</strong></td></tr></tfoot>
        </table>
      </div>
    </> : <>
      <p className="lq-estimate-total"><strong>From A$1,650 incl GST</strong><span>(A$1,500 + GST) · Starting price only</span></p>
      <p className="lq-notice"><strong>Your estimate total is not available yet.</strong> The starting price is not a total for this request. Add or confirm the following details so the full scope can be assessed.</p>
      <ul>{pricing.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
    </>}
    {provisional && pricing.reviewReasons.length > 0 && <><h6>To confirm on site</h6><ul>{pricing.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></>}
    {'exclusions' in pricing && pricing.exclusions.length > 0 && <><h6>Not priced in this estimate</h6><ul>{pricing.exclusions.map(item => <li key={item.code}>{item.description}</li>)}</ul></>}
    <p className="lq-notice">{pricing.notice} This is an estimate based on photos and saved details. The work scope and price may change after an on-site inspection. It does not confirm a contract or booking.</p>
    <p className="lq-muted">Pricing version: {pricing.pricingVersion}</p>
  </div>;
}
export function SavedPhotoAnalysis({ job }: { job: PublicAnalysisJob }) {
  const analysis = job.analysis;
  return <section className="lq-analysis" aria-labelledby={`analysis-${job.id}`}>
    <h4 id={`analysis-${job.id}`}>{job.status === 'succeeded' && analysis ? job.pricing?.status === 'provisional_estimate' ? 'AI estimate ready — final price confirmed on site' : outcomeLabels[analysis.outcome] : job.status === 'queued' ? 'Analysis is ready to start' : job.status === 'running' ? 'Photos are being analysed' : job.status === 'uncertain' ? 'Analysis status needs checking' : 'Analysis could not be completed'}</h4>
    <p className="lq-muted">Saved analysis {job.id} · Input revision {job.inputRevision} · {displayTime(job.createdAt)} (Sydney)</p>
    {job.stale && <p className="lq-notice">This analysis belongs to an earlier version of your details or photos. Request a new analysis for the current saved version.</p>}
    {job.error && <p role="alert">{job.error}</p>}
    {['queued', 'running'].includes(job.status) && <p role="status">The job is saved. Refreshing this page will restore its status.</p>}
    {job.status === 'uncertain' && <p>The previous AI call may have completed. Check its saved status before requesting another analysis, which may incur a new call.</p>}
    {analysis && job.status === 'succeeded' && <>
      <p>{analysis.summary}</p>
      {job.pricing && <SavedEstimatePricing pricing={job.pricing} />}
      {'estimateScope' in analysis && <>
        <h5>Scope used for the estimate</h5>
        {analysis.estimateScope.extent === 'primary_view' && <p className="lq-notice"><strong>Primary-photo scope only.</strong> This amount covers the cabinet fronts estimated from the main whole-front view. It is not an estimate for unseen cabinets or a combined total of conflicting views.</p>}
        <p>{analysis.estimateScope.description}</p>
        {analysis.estimateScope.anchorPhotoId && <p className="lq-muted">Main reference: photo {analysis.photoQuality.findIndex(photo => photo.photoId === analysis.estimateScope.anchorPhotoId) + 1}. Other views are used to check context and condition without double-counting.</p>}
        {analysis.estimateScope.assumptions.length > 0 && <ul>{analysis.estimateScope.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>}
        {analysis.estimateScope.conflictingPhotoIds.length > 0 && <p className="lq-notice">Some views may show a different cabinet layout. Their quantities have not been added to the main scope. We will confirm the full project on site.</p>}
      </>}
      <h5>Photos and coverage</h5><ul>{analysis.coverage.map(item => <li key={item.role}><strong>{photoRoleLabels[item.role]}: {item.covered ? 'visible' : 'not established'}</strong> — {item.note}<span className="lq-muted">{item.photoIds.length ? ` Evidence photos: ${item.photoIds.join(', ')}` : ''}</span></li>)}</ul>
      {analysis.photoQuality.some(photo => !photo.usable || photo.retakeInstruction) && <><h5>Photo improvements</h5><ul>{analysis.photoQuality.filter(photo => !photo.usable || photo.retakeInstruction).map(photo => <li key={photo.photoId}>{photo.retakeInstruction ?? photo.issues.join('; ')}<span className="lq-muted"> Photo {photo.photoId}</span></li>)}</ul></>}
      <h5>{'estimateScope' in analysis ? 'AI-estimated quantities' : 'Quantities to check'}</h5><dl className="lq-details">{Object.entries(analysis.quantities).map(([kind, item]) => <div key={kind}><dt>{kind === 'doors' ? 'Cabinet doors' : 'Drawer fronts'}</dt><dd>{isEstimatedQuantity(item) ? <>
        <strong>AI estimate: {item.estimated === null ? 'not established' : `approx. ${item.estimated}`}</strong>
        <span> · Your input: {item.customer ?? 'not supplied'} · To be confirmed on site</span>
        <p>{item.note}</p><span className="lq-muted">Visual confidence: {item.confidence}. This is an estimate, not a verified count.</span>
      </> : <>Entered: {item.customer ?? 'unknown'} · Visible estimate: {item.observed ?? 'not established'}{item.needsConfirmation ? ' · Please confirm this quantity in service details or with the company.' : ''}</>}</dd></div>)}</dl>
      <h5>Visible condition and damage</h5>{analysis.observedDamage.length ? <ul>{analysis.observedDamage.map(item => <li key={item.id}><strong>{item.location} · {item.severity}</strong><p>{item.description}</p>{'surface' in item && typeof item.surface === 'string' && <p>Surface: {surfaceLabels[item.surface] ?? 'To confirm on site'}</p>}<span className="lq-muted">Evidence photos: {item.photoIds.join(', ')}</span></li>)}</ul> : <p>No specific damage was established from these photos. This does not rule out hidden damage.</p>}
      <h5>Proposed work</h5>{analysis.proposedWork.length ? <ul>{analysis.proposedWork.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.description}</p><span className="lq-muted">Evidence photos: {item.photoIds.join(', ')}</span></li>)}</ul> : <p>Work scope needs further information.</p>}
      {analysis.unknowns.length > 0 && <><h5>Information still needed</h5><ul>{analysis.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      {analysis.siteChecks.length > 0 && <><h5>Check on site</h5><ul>{analysis.siteChecks.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      <p className="lq-muted">These observations and the pricing status are saved in the company system. They do not confirm a contract or booking.</p>
    </>}
  </section>;
}
