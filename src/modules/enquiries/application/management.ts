import type { WorkActor } from '../domain/management.ts'
export interface WorkStore { command<T>(command: string, args: Record<string, unknown>): Promise<T> }
export function currentWorkCommand<T>(store: WorkStore, actor: WorkActor, command: string, args: Record<string, unknown> = {}) {
  return store.command<T>(command, { ...args, companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId })
}
