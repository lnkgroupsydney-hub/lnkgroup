"use client";

import { useSyncExternalStore } from "react";
import { ArrowRight, CalendarDays, ClipboardList, FileText, Layers3, Settings, UsersRound } from "lucide-react";
import { LiveQuoteRequestsPanel } from "@/modules/quotes/client";
import { CustomersConsole } from "@/modules/customers/client";
import { SessionSecurity, useStaffAdmin } from "@/modules/admin-access/client";
import { OperationsView } from "@/modules/operations/client";
import { LiveCompanyBookingSchedule } from "@/modules/bookings/client";
import { StatusBadge } from "@/shared/ui/status-badge";
import { WorkspaceLink } from "@/shared/ui/admin-workspace-state";
import { adminPages, type AdminPageId } from "./admin-navigation";
import { OverviewCountCards } from "./overview-count-cards";
import { useOverviewCounts } from "./use-overview-counts";

const shortcuts = [
  { label: "Client records", description: "Search clients and connect their enquiry history.", href: "/admin/customers", Icon: UsersRound, accent: "gold" },
  { label: "Incoming enquiries", description: "Review website requests, signed reservation requests and Gmail conversations.", href: "/admin/enquiries", Icon: ClipboardList, accent: "info" },
  { label: "Quote requests", description: "Review saved customer requests and previous documents.", href: "/admin/quotes", Icon: FileText, accent: "success" },
  { label: "Booking review", description: "Review dates, confirmations and calendar changes.", href: "/admin/schedule", Icon: CalendarDays, accent: "neutral" },
] as const;
const comingSoon = adminPages.filter((page) => page.group === "soon");
const todayFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" });
const todayIsoFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" });
const noSubscription = () => () => {};

function SydneyDate() {
  // Client-only snapshot (empty on the server) so hydration never compares two different days.
  const label = useSyncExternalStore(noSubscription, () => todayFormat.format(new Date()), () => "");
  const iso = useSyncExternalStore(noSubscription, () => todayIsoFormat.format(new Date()), () => "");
  return <p className="admin-overview-date">{label ? <time dateTime={iso}>{label}</time> : <time />}<span> · Australia/Sydney</span></p>;
}

export function AdminOverview() {
  const { onAccessLost } = useStaffAdmin();
  const { state, refresh } = useOverviewCounts({ onAccessLost });
  return <div className="admin-overview">
    <SydneyDate />
    <OverviewCountCards state={state} onRefresh={refresh} />
    <div className="admin-overview-top">
      <section className="admin-focus-card" aria-labelledby="admin-focus-title">
        <p className="admin-eyebrow">Today&apos;s focus</p>
        <h2 id="admin-focus-title">Review new booking requests and confirm work periods.</h2>
        <p>Signed requests and accepted proposals wait in Schedule until the company confirms their work periods.</p>
        <WorkspaceLink href="/admin/schedule" className="admin-primary-link">Review bookings <ArrowRight size={17} aria-hidden="true" /></WorkspaceLink>
      </section>
      <section className="admin-shortcut-area" aria-labelledby="admin-quick-title">
        <h2 id="admin-quick-title" className="sr-only">Go to your work</h2>
        <ul className="admin-shortcuts">{shortcuts.map(({ label, description, href, Icon, accent }) => <li key={href}><WorkspaceLink href={href} className="admin-shortcut" data-accent={accent}><span className="admin-shortcut-icon"><Icon size={20} aria-hidden="true" /></span><h3>{label}</h3><p>{description}</p><span className="admin-shortcut-link"><span className="admin-shortcut-open">Open</span> <ArrowRight size={16} aria-hidden="true" /></span></WorkspaceLink></li>)}</ul>
      </section>
    </div>
    <div className="admin-overview-bottom">
      <section className="admin-soon" aria-labelledby="admin-soon-title">
        <h2 id="admin-soon-title">Coming soon</h2>
        <ul>{comingSoon.map((page) => <li key={page.id}><WorkspaceLink href={page.href}>{page.label}</WorkspaceLink></li>)}</ul>
      </section>
      <WorkspaceLink href="/admin/settings" className="admin-settings-link"><Settings size={20} aria-hidden="true" /><span><strong>Settings</strong><small>Connections & sessions</small></span><ArrowRight size={16} aria-hidden="true" /></WorkspaceLink>
    </div>
  </div>;
}

const preparations = {
  jobs: { title: "Job management is next", body: "Work assignments, job progress and completion records need a dedicated workflow before they can be managed here.", href: "/admin/schedule", link: "Review existing bookings" },
  orders: { title: "Orders are being prepared", body: "Product orders, payments, deliveries and returns will appear here when the shop and order records are connected.", href: "/admin/customers", link: "Open client records" },
  inventory: { title: "Inventory is being prepared", body: "Stock items, quantities, movements and purchasing rules need to be set up before inventory can be tracked here.", href: "/admin", link: "Return to overview" },
  reports: { title: "Reports are being prepared", body: "Reports will use verified company records and defined reporting periods. Sales and job totals are not available yet.", href: "/admin", link: "Return to overview" },
};
export function AdminSection({ view }: { view: Exclude<AdminPageId, "overview"> }) {
  const { onAccessLost } = useStaffAdmin();
  if (view === "customers") return <CustomersConsole onSignedOut={onAccessLost} embedded />;
  if (view === "settings") return <div className="admin-settings"><section id="company-connections" aria-labelledby="company-connections-title"><h2 id="company-connections-title" className="admin-section-title">Company connections</h2><OperationsView view="settings" /></section><section aria-labelledby="admin-security-title"><h2 id="admin-security-title" className="admin-section-title">Session security</h2><SessionSecurity onAccessLost={onAccessLost} embedded /></section></div>;
  if (view === "quotes") return <><LiveQuoteRequestsPanel onAccessLost={onAccessLost} /><details><summary>Previous signed demonstrations</summary><OperationsView view="quotes" /></details></>;
  if (view === "schedule") return <><LiveCompanyBookingSchedule onAccessLost={onAccessLost} /><details><summary>Previous company demonstration schedules</summary><OperationsView view="schedule" /></details></>;
  if (view === "enquiries") return <><LiveQuoteRequestsPanel onAccessLost={onAccessLost} title="Website enquiries and reservation requests" description="Saved website details, photos and estimates appear here. Open a request to review the customer’s preferred date, signed reservation request and receipt, then prepare the final work periods and company confirmation." /><section aria-labelledby="gmail-enquiries-title"><h2 id="gmail-enquiries-title" className="admin-section-title">Gmail enquiries and previous demonstrations</h2><OperationsView view={view} /></section></>;
  const preparation = preparations[view];
  return <section className="admin-card admin-preparation"><StatusBadge tone="neutral">Coming soon</StatusBadge><Layers3 size={44} strokeWidth={1.4} aria-hidden="true" /><h2>{preparation.title}</h2><p>{preparation.body}</p><WorkspaceLink href={preparation.href} className="admin-primary-link">{preparation.link}<ArrowRight size={17} aria-hidden="true" /></WorkspaceLink></section>;
}
