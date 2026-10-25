"use client";

export { QuotePhotoSummary } from "./presentation/quote-photo-summary";
export { quoteApiPath } from "./presentation/quote-workspace";

export { CurrentWorkClient, enquiryActions, parseEnquiryDetail, parseEnquiryList, parseEnquiryAssignees } from './presentation/enquiry-management-client';
export type { WorkClientState, WorkPhase, WorkClientError, WorkFieldErrors, WorkField } from './presentation/enquiry-management-client';
export type { EnquiryDetail, EnquiryRow, WorkMutation, WorkReceipt } from './domain/management';

export { EnquiryInbox, EnquiryRecord } from './presentation/enquiry-management';
