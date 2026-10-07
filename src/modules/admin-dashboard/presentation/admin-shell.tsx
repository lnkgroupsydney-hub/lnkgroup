"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, Package, Settings, ShieldCheck, ShoppingBag, UsersRound, X, type LucideIcon } from "lucide-react";
import { useStaffAdmin } from "@/modules/admin-access/client";
import { OperationsWorkspaceProvider } from "@/modules/operations/client";
import { AdminWorkspaceStateProvider, useWorkspaceNavigation, WorkspaceLink } from "@/shared/ui/admin-workspace-state";
import { adminPages, compatibleAdminPath, type AdminPageId } from "./admin-navigation";
import "./admin-shell.css";

const icons: Record<AdminPageId, LucideIcon> = { overview: LayoutDashboard, customers: UsersRound, enquiries: ClipboardList, quotes: FileText, schedule: CalendarDays, jobs: ClipboardList, orders: ShoppingBag, inventory: Package, reports: ChartNoAxesCombined, settings: Settings };

export function AdminWorkspace({ children }: { children: ReactNode }) {
  const { onAccessLost } = useStaffAdmin();
  return <AdminWorkspaceStateProvider><OperationsWorkspaceProvider onAccessLost={onAccessLost} onSignedOut={onAccessLost}><AdminShell>{children}</AdminShell></OperationsWorkspaceProvider></AdminWorkspaceStateProvider>;
}

function Navigation({ onSelect }: { onSelect?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Administrator workspace"><p className="admin-nav-label">Workspace</p><ul className="admin-nav-list">
    {adminPages.map((page) => { const Icon = icons[page.id]; return <li key={page.id}>
      <WorkspaceLink href={page.href} aria-current={pathname === page.href ? "page" : undefined} onClick={onSelect}>
        <Icon size={19} aria-hidden="true" /><span>{page.label}</span>{"upcoming" in page && <span className="admin-nav-tag">Planned</span>}
      </WorkspaceLink>
    </li>; })}
  </ul></nav>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const { email, logout } = useStaffAdmin();
  const navigate = useWorkspaceNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const page = adminPages.find((item) => item.href === pathname) ?? adminPages[0];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const account = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const move = () => {
      const destination = compatibleAdminPath(window.location.pathname, window.location.search, window.location.hash);
      if (destination) router.replace(destination);
    };
    move(); window.addEventListener("hashchange", move);
    return () => window.removeEventListener("hashchange", move);
  }, [pathname, router]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      const target = id ? document.getElementById(id) : heading.current;
      if (target) { target.setAttribute("tabindex", "-1"); target.focus(); if (id) target.scrollIntoView(); }
    });
    if (account.current) account.current.open = false;
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const element = drawer.current;
    const trigger = menuButton.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    const media = window.matchMedia("(min-width: 901px)");
    const resize = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener("change", resize);
    return () => { media.removeEventListener("change", resize); element?.close(); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [mobileOpen]);

  function signOut() {
    navigate(() => {
      setSigningOut(true); setSignOutError("");
      void logout().catch((cause) => setSignOutError(cause instanceof Error ? cause.message : "Could not sign out. Please retry.")).finally(() => setSigningOut(false));
    }, { signOut: true });
  }
  return <div className="admin-workspace">
    <a className="skip-link" href="#admin-main">Skip to workspace content</a>
    <aside className="admin-sidebar">
      <WorkspaceLink href="/admin" className="admin-brand" aria-label="L&K Group overview"><span className="admin-monogram">LK</span><span><strong>L&K Group</strong><small>EMS · Private workspace</small></span></WorkspaceLink>
      <Navigation />
      <div className="admin-sidebar-foot"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Company administration</strong><p>Australia/Sydney</p></div></div>
    </aside>
    <div className="admin-workspace-body">
      <header className="admin-topbar">
        <div className="admin-breadcrumb"><button type="button" className="admin-menu-button" ref={menuButton} onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={mobileOpen} aria-controls="admin-mobile-menu"><Menu size={22} /></button><span>L&K Group</span><span aria-hidden="true">/</span><strong>{page.label}</strong></div>
        <details className="admin-account" ref={account} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary aria-label="Administrator account"><span className="admin-avatar">LK</span><span className="admin-account-label">Administrator</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="admin-account-panel"><p>{email ?? "Company administrator"}</p><WorkspaceLink href="/admin/settings">Account & sessions <ArrowUpRight size={16} aria-hidden="true" /></WorkspaceLink><button type="button" disabled={signingOut} onClick={signOut}><LogOut size={16} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button></div>
        </details>
      </header>
      <main className="admin-main operations-page operations-embedded" id="admin-main">
        <header className="admin-page-heading"><div><p className="admin-eyebrow">L&K Group · EMS</p><h1 ref={heading} tabIndex={-1}>{page.label}</h1><p>{page.description}</p></div><span className="admin-private-label"><ShieldCheck size={15} aria-hidden="true" />Private workspace</span></header>
        {signOutError && <p className="operations-error" role="alert">{signOutError}</p>}
        {children}
      </main>
    </div>
    <dialog ref={drawer} id="admin-mobile-menu" className="admin-mobile-drawer" aria-labelledby="admin-menu-heading" onCancel={(event) => { event.preventDefault(); setMobileOpen(false); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right) setMobileOpen(false); } }}>
      <div className="admin-drawer-heading"><strong id="admin-menu-heading">L&K Group</strong><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={22} /></button></div>
      <Navigation onSelect={() => setMobileOpen(false)} />
    </dialog>
  </div>;
}
