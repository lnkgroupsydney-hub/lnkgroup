"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createWorkspaceStore, type UnsavedEntry } from "./workspace-store";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
type NavigationOptions = { signOut?: boolean };
type WorkspaceContextValue = { store: WorkspaceStore; requestNavigation: (action: () => void, options?: NavigationOptions) => void };
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const emptySubscribe = () => () => {};

export function AdminWorkspaceStateProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createWorkspaceStore);
  const [pending, setPending] = useState<{ action: () => void; signOut: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useSyncExternalStore(store.subscribeGuards, store.guardSnapshot, store.guardSnapshot);
  const busy = store.entries(true).some((entry) => entry.busy);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.entries().length) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [store]);

  useEffect(() => {
    if (!pending) return;
    const element = dialog.current;
    element?.showModal(); cancelButton.current?.focus();
    return () => { element?.close(); returnFocus.current?.focus(); };
  }, [pending]);

  const requestNavigation = useCallback((action: () => void, options?: NavigationOptions) => {
    if (!store.entries(!options?.signOut).length) { action(); return; }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({ action, signOut: Boolean(options?.signOut) });
  }, [store]);
  const context = useMemo(() => ({ store, requestNavigation }), [store, requestNavigation]);

  return <WorkspaceContext.Provider value={context}>
    {children}
    <dialog ref={dialog} className="admin-leave-dialog" aria-labelledby="admin-leave-title" onCancel={(event) => { event.preventDefault(); setPending(null); }}>
      <h2 id="admin-leave-title">{pending?.signOut ? "Sign out of your workspace?" : busy ? "A request is still in progress" : "You have unsaved changes"}</h2>
      <p>{pending?.signOut ? "Signing out clears your unsaved input on this device. A request already sent may still complete; check its result when you sign in again." : busy ? "Stay on this page until the result is known. If a request failed, review its result before trying again." : "Return to the form to save your changes, or discard them before leaving this page."}</p>
      <div className="admin-dialog-actions">
        <button type="button" ref={cancelButton} onClick={() => setPending(null)}>Return to form</button>
        <button type="button" disabled={busy && !pending?.signOut} onClick={() => {
          if (!pending?.signOut && store.entries(true).some((entry) => entry.busy)) return;
          if (!pending?.signOut) store.discardActive();
          setPending(null); pending?.action();
        }}>{pending?.signOut ? "Sign out and clear drafts" : "Discard and continue"}</button>
      </div>
    </dialog>
  </WorkspaceContext.Provider>;
}

export function useWorkspaceDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const workspace = useContext(WorkspaceContext);
  const store = workspace?.store;
  const [initialValue] = useState<T>(() => initial);
  const [fallback, setFallback] = useState<T>(() => initial);
  const subscribe = useCallback((listener: () => void) => store ? store.subscribe(key, listener) : emptySubscribe(), [store, key]);
  const snapshot = useCallback(() => store ? store.get(key, fallback) : fallback, [store, key, fallback]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setValue: Dispatch<SetStateAction<T>> = useCallback((update) => {
    if (!store) { setFallback(update); return; }
    const previous = store.get(key, initialValue);
    store.set(key, typeof update === "function" ? (update as (value: T) => T)(previous) : update);
  }, [store, key, initialValue]);
  return [value, setValue];
}

export function useUnsavedChanges(key: string, entry: UnsavedEntry) {
  const store = useContext(WorkspaceContext)?.store;
  const { dirty, busy, onDiscard } = entry;
  useEffect(() => store?.register(key, { dirty, busy, onDiscard }), [store, key, dirty, busy, onDiscard]);
}

export function useWorkspaceNavigation() {
  const workspace = useContext(WorkspaceContext);
  return workspace?.requestNavigation ?? ((action: () => void) => action());
}

export function WorkspaceLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const navigate = useWorkspaceNavigation();
  const router = useRouter();
  return <Link {...props} href={href} prefetch={false} onNavigate={(event) => {
    event.preventDefault();
    navigate(() => router.push(href));
  }} />;
}
