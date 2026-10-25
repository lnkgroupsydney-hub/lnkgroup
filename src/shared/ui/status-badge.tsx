import type { ReactNode } from "react";

/** Same union as StatusTone in the admin overview contract; shared UI must not import business modules. */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Display-only status label. Colour comes from `.ems-badge[data-tone]` in the admin theme; the text always carries the meaning. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className="ems-badge" data-tone={tone}>{children}</span>;
}
