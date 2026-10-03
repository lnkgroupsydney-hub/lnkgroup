export type EnquiryStatus = 'submitted' | 'provisional'
export type CalendarSyncStatus = 'pending' | 'synced' | 'conflict' | 'retrying'

export interface EnquiryInput {
  serviceId: 'cabinet-painting'
  projectIntent: string
  targetSurfaces: string[]
  suburb: string
  postcode: string
  doorCount: number | null
  drawerCount: number | null
  material?: string
  colourPreference?: string
  notes?: string
  name: string
  email: string
  phone?: string
  siteAddress?: string
  preferredDate: string | null
  acknowledgement: true
  idempotencyKey: string
}

export interface Enquiry extends Omit<EnquiryInput, 'acknowledgement' | 'idempotencyKey'> {
  demoSubmissionId?: string
  id: string
  reference: string
  source: 'web' | 'gmail'
  acknowledgement: boolean
  senderReviewRequired: boolean
  attachmentCount: number
  gmail?: { threadId: string; messages: { messageId: string; receivedAt: string | null; senderName: string | null; senderEmail: string | null; subject: string; bodyText: string; bodyStatus: 'available' | 'empty' | 'invalid_encoding' | 'unavailable' | 'truncated'; attachmentCount: number }[]; historyTruncated: boolean }
  status: EnquiryStatus
  revision: number
  createdAt: string
  startAt: string | null
  endAt: string | null
  scheduleNotes: string | null
  calendarStatus: CalendarSyncStatus
  calendarError: string | null
}

export interface ChangeRequest {
  id: string
  enquiryId: string
  reference: string
  kind: 'move' | 'delete' | 'invalid'
  proposedStartAt: string | null
  proposedEndAt: string | null
  proposedPreferredDate: string | null
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
  revision: number
  createdAt: string
}

export type GoogleConnectionState = 'not_connected' | 'unverified' | 'ready' | 'target_required' | 'reconnect_required' | 'retrying' | 'configuration_error' | 'permission_denied' | 'partial'

export interface CalendarConnectionStatus {
  configured: boolean
  connected: boolean
  email: string | null
  selectedCalendarId: string | null
  lastSyncedAt: string | null
  error: string | null
  status?: GoogleConnectionState
  checkedAt?: string | null
}

export interface OperationsDashboard {
  enquiries: Enquiry[]
  calendar: CalendarConnectionStatus
  gmail: { configured: boolean; connected: boolean; selectedLabelId: string | null; lastSyncedAt: string | null; error: string | null; status?: GoogleConnectionState; checkedAt?: string | null; quarantine: { messageId:string; reason:'invalid_response'|'payload_too_large'; lastSeenAt:string }[] }
  changes: ChangeRequest[]
}
