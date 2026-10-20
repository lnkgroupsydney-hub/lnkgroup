import type { Customer, CustomerProperty } from '../../customers/index.ts';

export interface QuoteCrmRelation { requestId: string; crmRevision: number; customer: Customer | null; property: CustomerProperty | null }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function parseQuoteCrmRelation(value: unknown, requestId: string): QuoteCrmRelation {
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.crmRevision) || Number(value.crmRevision) < 0) throw new Error('The client relation could not be verified. Refresh before linking.');
  if (value.customer !== null && (!record(value.customer) || !uuid(value.customer.id) || value.customer.companyId !== 'lk-group' || typeof value.customer.name !== 'string' || !['active', 'archived'].includes(String(value.customer.status)) || !Number.isSafeInteger(value.customer.revision) || Number(value.customer.revision) < 1)) throw new Error('The linked client could not be verified.');
  if (value.property !== null && (!record(value.customer) || !record(value.property) || !uuid(value.property.id) || value.property.companyId !== 'lk-group' || value.property.customerId !== value.customer.id || !record(value.property.address) || typeof value.property.label !== 'string' || !Number.isSafeInteger(value.property.revision))) throw new Error('The linked property does not belong to this client.');
  return value as unknown as QuoteCrmRelation;
}
