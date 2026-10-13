import { Check, LoaderCircle } from 'lucide-react';
import type { PublicAnalysisJob } from '../domain/photo-workspace';
import styles from './live-photo-workspace.module.css';

export function PhotoAnalysisProgress({ job, preparing = false }: { job?: PublicAnalysisJob | null; preparing?: boolean }) {
  const processing = Boolean(job && !job.stale && ['queued', 'running'].includes(job.status));
  if (!preparing && !processing) return null;
  const running = processing && job?.status === 'running';
  return <div className={styles.analysisProgress} role="status" aria-live="polite" aria-atomic="true">
    <div className={styles.progressHeading}>
      <span className={styles.loadingIcon}><LoaderCircle className={styles.spinner} size={28} aria-hidden="true" /></span>
      <div><strong>{running ? 'AI is reviewing your cabinets…' : processing ? 'Your analysis is queued' : 'Preparing your photo analysis…'}</strong><p>{running ? 'Checking visible quantities, surfaces and condition.' : processing ? 'Your photos are saved. Waiting for the analysis to start.' : 'Saving your request before the review begins.'}</p></div>
    </div>
    <ol className={styles.analysisSteps} aria-label="Analysis stages">
      <li data-state="done"><Check size={16} aria-hidden="true" /><span>Photos saved</span></li>
      <li data-state="current"><LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /><span>{running ? 'AI photo review' : processing ? 'AI review queued' : 'Preparing AI review'}</span></li>
      <li><span className={styles.stepDot} aria-hidden="true" /><span>Estimate & next steps</span></li>
    </ol>
    {processing && <p className={styles.helper}>This may take a moment. Your saved progress will return if you refresh.</p>}
  </div>;
}
