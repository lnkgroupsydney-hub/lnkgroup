import type { PublicAnalysisJob } from '../domain/photo-workspace';
import { quotePricingDisplay } from '../domain/pricing-display.ts';
import { SavedPhotoAnalysis } from './saved-photo-analysis';
import { displayTime } from './request-client';

/** Administrator summary; the customer's full saved assessment remains unchanged. */
export function StaffPhotoAnalysis({ job, compact = false }: { job: PublicAnalysisJob; compact?: boolean }) {
  const pricing = job.pricing, analysis = job.analysis;
  const total = job.status === 'succeeded' ? pricing?.total : null;
  const status = job.status === 'succeeded' ? 'Assessment saved' : job.status === 'queued' ? 'Analysis queued' : job.status === 'running' ? 'Analysing photos' : job.status === 'uncertain' ? 'Analysis needs checking' : 'Analysis failed';
  return <section className="ems-panel" aria-label="Saved estimate summary">
    <h3>{job.stale ? 'Earlier estimate' : 'Saved estimate'}</h3>
    <span className="ems-status">{status}{job.stale ? ' · Earlier source' : ''}</span>
    {job.stale && <p className="ems-feedback">Saved details or photos have changed. This earlier assessment is not current.</p>}
    <p className="ems-estimate-amount"><strong>{total !== null && total !== undefined ? `${new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(total / 100)} ${quotePricingDisplay(pricing!.pricingVersion).amountSuffix}` : 'Estimate amount pending'}</strong></p>
    {total !== null && total !== undefined && <p>Photo-based painting amount. Confirm quantities, condition, scope and final price on site; additional work is excluded. This assessment does not confirm a contract or booking.</p>}
    {job.error && <p className="ems-feedback ems-feedback--error" role="alert">{job.error}</p>}
    {job.status === 'uncertain' && <p className="ems-feedback">The previous AI call may have completed. Check its saved status before requesting another analysis.</p>}
    {pricing?.status === 'awaiting_company_rates' && <p>Earlier assessment has no amount because company pricing setup was pending.</p>}
    {pricing && 'reviewReasons' in pricing && pricing.reviewReasons.length > 0 && <><h4>{total == null ? 'Information needed for pricing' : 'To confirm on site'}</h4><ul>{pricing.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></>}
    {pricing && 'exclusions' in pricing && pricing.exclusions.length > 0 && <><h4>Not priced in this amount</h4><ul>{pricing.exclusions.map(item => <li key={item.code}>{item.description}</li>)}</ul></>}
    {analysis && 'estimateScope' in analysis && analysis.estimateScope.extent === 'primary_view' && <p className="ems-feedback">Primary-photo scope only; unseen cabinets are excluded.</p>}
    {analysis && 'estimateScope' in analysis && analysis.estimateScope.conflictingPhotoIds.length > 0 && <p className="ems-feedback">Some views may show a different cabinet layout. Their quantities were not combined; confirm the whole project on site.</p>}
    <p className="ems-list-meta">Assessed {displayTime(job.createdAt)} (Sydney) · Input revision {job.inputRevision}</p>
    {!compact && <details><summary>Full assessment, price breakdown and photo evidence</summary><SavedPhotoAnalysis job={job} /></details>}
  </section>;
}
