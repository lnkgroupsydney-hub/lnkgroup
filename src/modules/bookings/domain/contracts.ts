import type {DemoSnapshot,DemoSignature,DemoSubmissionStatus} from '../../enquiries/contracts.ts'
export type BookingSegment={id:string;startAt:string;endAt:string}
export type BookingStatus='requested'|'confirmed'
export type BookingSyncStatus='pending'|'synced'|'retrying'|'review_required'
export type BookingEmailStatus=DemoSubmissionStatus['emailStatus']
export interface BookingProposalSnapshot {
  mode:'demo';version:'booking-demo-v1';submissionId:string;reference:string;submission:DemoSnapshot;
  proposalId:string;proposalRevision:number;resource:'demo-single-resource';segments:BookingSegment[];notes:string;
}
export interface BookingProposal {
  id:string;revision:number;snapshot:BookingProposalSnapshot;snapshotHash:string;segments:BookingSegment[];notes:string;
  createdAt:string;signature:DemoSignature|null;consentedAt:string|null;emailStatus:BookingEmailStatus;emailError:string|null;confirmedAt:string|null;
}
export interface BookingState {
  id:string;revision:number;status:BookingStatus;syncStatus:BookingSyncStatus;confirmedProposalId:string|null;pendingProposalId:string|null;confirmedAt:string|null;
}
export interface BookingSummary extends BookingState {
  reference:string;clientName:string;preferredDate:string;submittedAt:string;proposalEmailStatus:BookingEmailStatus|null;
}
export interface BookingDetail {
  submission:{id:string;reference:string;snapshot:DemoSnapshot;snapshotHash:string;signature:DemoSignature;submittedAt:string;emailStatus:BookingEmailStatus;calendarStatus:DemoSubmissionStatus['calendarStatus']};
  booking:BookingState;proposals:BookingProposal[];
}
export interface BookingEmailWork {
  id:string;booking_id:string;snapshot:BookingProposalSnapshot;snapshot_hash:string;signature:DemoSignature;consented_at:string;created_at:string;
  email_status:BookingEmailStatus;email_payload:Record<string,unknown>|null;email_first_attempt_at:string|null;email_provider_id:string|null;
  lease_generation:number;lease_until:string;
}
