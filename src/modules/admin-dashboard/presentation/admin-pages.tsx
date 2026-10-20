"use client";

import { ArrowRight, CalendarDays, ClipboardList, FileText, Layers3, UsersRound } from "lucide-react";
import { LiveQuoteRequestsPanel } from "@/modules/quotes/client";
import { CustomersConsole } from "@/modules/customers/client";
import { SessionSecurity, useStaffAdmin } from "@/modules/admin-access/client";
import { OperationsView } from "@/modules/operations/client";
import { LiveCompanyBookingSchedule } from "@/modules/bookings/client";
import { WorkspaceLink } from "@/shared/ui/admin-workspace-state";
import { AdminPanel, AdminStatusBadge } from "@/shared/ui/admin";
import type { AdminPageId } from "./admin-navigation";

const shortcuts = [
  { label: "Client records", description: "Search clients and connect their enquiry history.", href: "/admin/customers", Icon: UsersRound },
  { label: "Incoming enquiries", description: "Review website requests, signed reservation requests and Gmail conversations.", href: "/admin/enquiries", Icon: ClipboardList },
  { label: "Quote requests", description: "Review saved customer requests and previous documents.", href: "/admin/quotes", Icon: FileText },
  { label: "Booking review", description: "Review dates, confirmations and calendar changes.", href: "/admin/schedule", Icon: CalendarDays },
];
export function AdminOverview() {
  return <div className="admin-overview">
    <section className="admin-overview-intro" aria-labelledby="workspace-ready-title"><div><span className="admin-eyebrow">Your daily workspace</span><h2 id="workspace-ready-title">Everything starts with a clear view.</h2><p>Open a client record, review an enquiry or check a booking. Your existing tools are organised by the work you need to do.</p><WorkspaceLink href="/admin/schedule" className="admin-primary-link">Review bookings <ArrowRight size={17} aria-hidden="true" /></WorkspaceLink></div><div className="admin-intro-mark" aria-hidden="true"><Layers3 size={72} strokeWidth={1} /><span>Clients · Quotes · Schedule</span></div></section>
    <section aria-labelledby="admin-quick-title"><div className="admin-section-heading"><h2 id="admin-quick-title">Go to your work</h2><span>Existing company records</span></div><div className="admin-shortcuts">{shortcuts.map(({ label, description, href, Icon }) => <WorkspaceLink key={href} href={href} className="admin-shortcut"><span className="admin-shortcut-icon"><Icon size={22} aria-hidden="true" /></span><h3>{label}</h3><p>{description}</p><span className="admin-shortcut-link">Open workspace <ArrowRight size={16} aria-hidden="true" /></span></WorkspaceLink>)}</div></section>
    <div className="admin-overview-bottom"><section className="admin-card" aria-labelledby="admin-insights-title"><span className="admin-status">Preparing</span><h2 id="admin-insights-title">Daily insights</h2><p>Confirmed schedules, open requests, recent enquiries and records needing a client link will appear here once the full-data calculations are connected.</p><p className="admin-muted">Charts and totals are not available yet.</p></section><section className="admin-card" aria-labelledby="admin-next-title"><h2 id="admin-next-title">A connected operation</h2><p>Jobs, orders, stock and reporting will join this workspace as their workflows are ready.</p><WorkspaceLink href="/admin/jobs" className="admin-text-link">View what is planned <ArrowRight size={16} aria-hidden="true" /></WorkspaceLink><WorkspaceLink href="/admin/settings" className="admin-text-link">Manage connections & sessions <ArrowRight size={16} aria-hidden="true" /></WorkspaceLink></section></div>
  </div>;
}

const preparations = {
  jobs: { title: "Job management is next", body: "Work assignments, job progress and completion records need a dedicated workflow before they can be managed here.", href: "/admin/schedule", link: "Review existing bookings" },
  orders: { title: "Orders are being prepared", body: "Product orders, payments, deliveries and returns will appear here when the shop and order records are connected.", href: "/admin/customers", link: "Open client records" },
  inventory: { title: "Inventory is being prepared", body: "Stock items, quantities, movements and purchasing rules need to be set up before inventory can be tracked here.", href: "/admin", link: "Return to overview" },
  reports: { title: "Reports are being prepared", body: "Reports will use verified company records and defined reporting periods. Sales and job totals are not available yet.", href: "/admin", link: "Return to overview" },
};
export function AdminSection({ view, recordId }: { view: Exclude<AdminPageId, "overview">; recordId?: string }) {
  const { onAccessLost } = useStaffAdmin();
  if (view === "customers") return <CustomersConsole key={recordId ?? "list"} onSignedOut={onAccessLost} embedded initialCustomerId={recordId} />;
  if (view === "settings") return <div className="admin-settings"><section id="company-connections" aria-labelledby="company-connections-title"><h2 id="company-connections-title" className="admin-section-title">Company connections</h2><OperationsView view="settings" /></section><section aria-labelledby="admin-security-title"><h2 id="admin-security-title" className="admin-section-title">Session security</h2><SessionSecurity onAccessLost={onAccessLost} embedded /></section></div>;
  if (view === "quotes") return <><LiveQuoteRequestsPanel key={`${view}:${recordId ?? "list"}`} onAccessLost={onAccessLost} requestId={recordId} />{!recordId && <details className="ems-legacy"><summary>Previous signed demonstrations</summary><OperationsView view="quotes" /></details>}</>;
  if (view === "schedule") return <><LiveCompanyBookingSchedule onAccessLost={onAccessLost} initialRequestId={recordId} />{!recordId && <details className="ems-legacy"><summary>Previous company demonstration schedules</summary><OperationsView view="schedule" /></details>}</>;
  if (view === "enquiries") return <><LiveQuoteRequestsPanel key={`${view}:${recordId ?? "list"}`} onAccessLost={onAccessLost} requestId={recordId} listPath="/admin/enquiries" title="Website enquiries and reservation requests" description="Review incoming website requests, their saved details and the next step. Open a request for photos, estimates, booking and documents." />{!recordId && <details className="ems-legacy"><summary>Gmail enquiries and previous demonstrations</summary><OperationsView view={view} /></details>}</>;
  const preparation = preparations[view];
  return <AdminPanel className="admin-preparation"><AdminStatusBadge>Planned</AdminStatusBadge><Layers3 size={44} strokeWidth={1.4} aria-hidden="true" /><h2>{preparation.title}</h2><p>{preparation.body}</p><WorkspaceLink href={preparation.href} className="admin-primary-link">{preparation.link}<ArrowRight size={17} aria-hidden="true" /></WorkspaceLink></AdminPanel>;
}
