// Public server entry point for the quote pipeline; it does not collect Gmail.
import { randomUUID } from 'node:crypto';
import { operationsCommand } from './infrastructure/supabase-client.ts';
import { getConnection } from './infrastructure/supabase-auth.ts';
import { pushPending } from './infrastructure/supabase-calendar.ts';

export async function syncQuoteCalendar() {
  const holder=randomUUID();
  if (!await operationsCommand<boolean>('sync_acquire',{holder})) return;
  try {
    const connection=await getConnection();
    if(connection?.selected_calendar_id) await pushPending(connection.selected_calendar_id,holder);
  } finally { await operationsCommand('sync_release',{holder}); }
}
