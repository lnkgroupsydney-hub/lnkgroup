import type { LiveQuoteRequest } from '../domain/contracts.ts';
import type { StatusTone } from '@/shared/ui/status-badge';

export function quoteRequestTone(status: LiveQuoteRequest['status']): StatusTone {
  switch (status) {
    case 'draft': return 'neutral';
    case 'review_requested': return 'warning';
  }
  const exhaustive: never = status;
  return exhaustive;
}

export function quoteRequestStatusLabel(status: LiveQuoteRequest['status']): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'review_requested': return 'Review requested';
  }
  const exhaustive: never = status;
  return exhaustive;
}
