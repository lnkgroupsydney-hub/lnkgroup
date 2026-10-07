export type UnsavedEntry = { dirty: boolean; busy?: boolean; onDiscard: () => void };

/** A store belongs to one authenticated workspace, never to a module or browser storage. */
export function createWorkspaceStore() {
  const drafts = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  const guards = new Map<string, UnsavedEntry & { active: boolean }>();
  const guardListeners = new Set<() => void>();
  let guardVersion = 0;
  function notifyGuards() { guardVersion++; guardListeners.forEach((listener) => listener()); }
  return {
    get<T>(key: string, initial: T): T { return drafts.has(key) ? drafts.get(key) as T : initial; },
    set<T>(key: string, value: T) { drafts.set(key, value); listeners.get(key)?.forEach((listener) => listener()); },
    subscribe(key: string, listener: () => void) {
      let group = listeners.get(key);
      if (!group) { group = new Set(); listeners.set(key, group); }
      group.add(listener);
      return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
    },
    register(key: string, entry: UnsavedEntry) {
      const registered = { ...entry, active: true };
      if (entry.dirty || entry.busy) guards.set(key, registered); else guards.delete(key);
      notifyGuards();
      return () => {
        if (guards.get(key) !== registered) return;
        // Back/forward can unmount a dirty form. Keep the unload warning with its draft.
        guards.set(key, { ...registered, active: false });
        notifyGuards();
      };
    },
    entries(activeOnly = false) { return [...guards.values()].filter((entry) => !activeOnly || entry.active); },
    discardActive() {
      for (const [key, entry] of guards) {
        if (entry.active && !entry.busy) { entry.onDiscard(); guards.delete(key); }
      }
      notifyGuards();
    },
    subscribeGuards(listener: () => void) { guardListeners.add(listener); return () => { guardListeners.delete(listener); }; },
    guardSnapshot() { return guardVersion; },
    clear() { drafts.clear(); guards.clear(); listeners.forEach((group) => group.forEach((listener) => listener())); notifyGuards(); },
  };
}
