import type { CustomerActor } from '../domain/contracts.ts'
export interface CustomerStore { command<T>(action: string, args: Record<string, unknown>): Promise<T> }
/** Actor fields come from a current staff grant, never request JSON. */
export function customerCommand<T>(store: CustomerStore, actor: CustomerActor, action: string, args: Record<string, unknown> = {}) {
  return store.command<T>(action, { ...args, companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId })
}
