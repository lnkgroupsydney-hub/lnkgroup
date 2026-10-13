"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, Package, Settings, ShieldCheck, ShoppingBag, UsersRound, X, type LucideIcon } from "lucide-react";
import { useStaffAdmin } from "@/modules/admin-access/client";
import { OperationsWorkspaceProvider } from "@/modules/operations/client";
import { AdminWorkspaceStateProvider, useWorkspaceNavigation, WorkspaceLink } from "@/shared/ui/admin-workspace-state";
import { adminPages, adminNavigationGroups, compatibleAdminPath, resolveAdminPage, type AdminPageId } from "./admin-navigation";
import { AdminPageHeader } from "@/shared/ui/admin";

const icons: Record<AdminPageId, LucideIcon> = { overview: LayoutDashboard, customers: UsersRound, enquiries: ClipboardList, quotes: FileText, schedule: CalendarDays, jobs: ClipboardList, orders: ShoppingBag, inventory: Package, reports: ChartNoAxesCombined, settings: Settings };

export function AdminWorkspace({ children }: { children: ReactNode }) {
  const { onAccessLost } = useStaffAdmin();
  return <div className="ems-root"><AdminWorkspaceStateProvider><OperationsWorkspaceProvider onAccessLost={onAccessLost} onSignedOut={onAccessLost}><AdminShell>{children}</AdminShell></OperationsWorkspaceProvider></AdminWorkspaceStateProvider></div>;
}

function Navigation({ onSelect }: { onSelect?: () => void }) {
  const pathname = usePathname();
  const current = resolveAdminPage(pathname);
  return <nav aria-label="Administrator workspace">{adminNavigationGroups.map((group) => <div className="admin-nav-group" key={group.label}>
    <p className="admin-nav-label">{group.label}</p><ul className="admin-nav-list">
      {group.pages.map((id) => { const page = adminPages.find((item) => item.id === id)!; const Icon = icons[id]; return <li key={id}>
        <WorkspaceLink href={page.href} aria-current={current?.id === id ? "page" : undefined} onClick={onSelect}>
          <Icon size={19} aria-hidden="true" /><span>{page.label}</span>{"upcoming" in page && <span className="admin-nav-tag">Planned</span>}
        </WorkspaceLink>
      </li>; })}
    </ul>
  </div>)}</nav>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const { email, logout } = useStaffAdmin();
  const navigate = useWorkspaceNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const page = resolveAdminPage(pathname) ?? adminPages[0];
  const isDetail = pathname !== page.href;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const workspaceMain = useRef<HTMLElement>(null);
  const [drawerPointer, setDrawerPointer] = useState(false);
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
      const target = id ? document.getElementById(id) : workspaceMain.current?.querySelector<HTMLElement>("[data-admin-heading]");
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
    return () => { media.removeEventListener("change", resize); element?.close(); document.body.style.overflow = previousOverflow; if (!media.matches) trigger?.focus(); };
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
        <nav className="admin-breadcrumb" aria-label="Breadcrumb"><button type="button" className="admin-menu-button" ref={menuButton} onClick={(event) => { setDrawerPointer(event.detail > 0); setMobileOpen(true); }} aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={mobileOpen} aria-controls="admin-mobile-menu"><Menu size={22} /></button><ol><li><WorkspaceLink href="/admin">L&K Group</WorkspaceLink><span aria-hidden="true">/</span></li><li>{isDetail ? <WorkspaceLink href={page.href}>{page.label}</WorkspaceLink> : <span aria-current="page">{page.label}</span>}</li>{isDetail && <li><span aria-hidden="true">/</span><span aria-current="page">Record</span></li>}</ol></nav>
        <details className="admin-account" ref={account} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary aria-label="Administrator account" onClick={(event) => { if (account.current) account.current.dataset.pointerOpen = String(event.detail > 0); }}><span className="admin-avatar">LK</span><span className="admin-account-label">Administrator</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="admin-account-panel"><p>{email ?? "Company administrator"}</p><WorkspaceLink href="/admin/settings">Account & sessions <ArrowUpRight size={16} aria-hidden="true" /></WorkspaceLink><button type="button" disabled={signingOut} onClick={signOut}><LogOut size={16} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button></div>
        </details>
      </header>
      <main ref={workspaceMain} className="admin-main" id="admin-main">
        <AdminPageHeader title={isDetail ? `${page.id === "customers" ? "Client" : page.id === "quotes" ? "Quote" : page.id === "enquiries" ? "Enquiry" : "Booking"} record` : page.label} description={isDetail ? `Review saved details and return to ${page.label.toLowerCase()} when you are done.` : page.description} eyebrow="L&K Group · EMS"><span className="admin-private-label"><ShieldCheck size={15} aria-hidden="true" />Private workspace</span></AdminPageHeader>
        {signOutError && <p className="ems-feedback ems-feedback--error" role="alert">{signOutError}</p>}
        {children}
      </main>
    </div>
    <dialog ref={drawer} id="admin-mobile-menu" className="admin-mobile-drawer" data-pointer-open={mobileOpen && drawerPointer} aria-labelledby="admin-menu-heading" onCancel={(event) => { event.preventDefault(); setMobileOpen(false); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right) setMobileOpen(false); } }}>
      <div className="admin-drawer-heading"><strong id="admin-menu-heading">L&K Group</strong><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={22} /></button></div>
      <Navigation onSelect={() => setMobileOpen(false)} />
    </dialog>
  </div>;
}
