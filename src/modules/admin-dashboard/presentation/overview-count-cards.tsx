"use client";

import { useSyncExternalStore } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { AdminStatusBadge } from "@/shared/ui/admin";
import { WorkspaceLink } from "@/shared/ui/admin-workspace-state";
import type { OverviewCounts, OverviewCountsState } from "../application/overview-counts-contract";

type CountKey = Exclude<keyof OverviewCounts, "quotesAwaitingReviewIsPartial">;

const cards: readonly { key: CountKey; title: string; description: string; href: string; link: string }[] = [
  { key: "quotesAwaitingReview", title: "Quotes awaiting review", description: "Quote requests sent for company review.", href: "/admin/quotes", link: "Open quotes" },
  { key: "bookingsNeedingAction", title: "Bookings needing action", description: "Requests, drafts and accepted proposals waiting on the company, plus bookings being processed or reviewed.", href: "/admin/schedule", link: "Open schedule" },
  { key: "bookingsConfirmed", title: "Confirmed bookings", description: "Bookings with confirmed work periods.", href: "/admin/schedule", link: "Open schedule" },
];

const noSubscription = () => () => {};
const timeFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hour12: false });

/** Counts are taken from the current admin lists (no server report), so the copy says so. */
export function OverviewCountCards({ state, onRefresh }: { state: OverviewCountsState; onRefresh: () => void }) {
  // Times are formatted only after mount so server and client markup match.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const loading = state.status === "loading";
  return <section className="admin-counts" aria-labelledby="admin-counts-title" aria-busy={loading || undefined}>
    <div className="admin-section-heading">
      <h2 id="admin-counts-title">Current work</h2>
      <span>Counted from the current quote and booking lists</span>
    </div>
    <ul className="admin-count-cards">
      {cards.map((card) => {
        const partial = state.status === "ready" && card.key === "quotesAwaitingReview" && state.counts.quotesAwaitingReviewIsPartial;
        // Fixed grid areas: title + Open link, then the value, then the description. Desktop stacks them so
        // every value sits at the same height; phones put the value beside the title (see admin-shell.css).
        return <li key={card.key} className="admin-count-card" data-state={state.status}>
          <h3 className="admin-count-title">{card.title}</h3>
          <WorkspaceLink href={card.href} className="admin-count-link" aria-label={`${card.link}: ${card.title}`}>Open <ArrowRight size={15} aria-hidden="true" /></WorkspaceLink>
          {state.status === "loading" && <p className="admin-count-value" aria-hidden="true">—</p>}
          {state.status === "ready" && <p className="admin-count-value">{state.counts[card.key]}{partial ? "+" : ""}</p>}
          {state.status === "error" && <p className="admin-count-value admin-count-error"><AdminStatusBadge tone="danger">Could not count</AdminStatusBadge></p>}
          <p className="admin-count-meta">{state.status === "loading" ? "Counting…" : partial ? "Showing the first 500 requests" : card.description}</p>
        </li>;
      })}
    </ul>
    {state.status === "ready" && <div className="admin-count-foot">
      <p>Counted at {mounted ? <time dateTime={state.loadedAt}>{timeFormat.format(new Date(state.loadedAt))}</time> : <time dateTime={state.loadedAt} />}</p>
      <button type="button" className="secondary" onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
    </div>}
    {state.status === "error" && <div className="admin-count-foot admin-count-alert" role="alert">
      <p>{state.message}</p>
      <button type="button" className="secondary" onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Retry</button>
    </div>}
  </section>;
}
