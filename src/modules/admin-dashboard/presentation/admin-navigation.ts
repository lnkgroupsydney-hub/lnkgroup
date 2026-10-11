export const adminPages = [
  { id: "overview", href: "/admin", label: "Overview", description: "Your workspace for clients, enquiries and schedules." },
  { id: "customers", href: "/admin/customers", label: "Clients", description: "Find client records, their enquiries and connected documents." },
  { id: "enquiries", href: "/admin/enquiries", label: "Enquiries", description: "Review incoming enquiries, conversations and proposed schedules." },
  { id: "quotes", href: "/admin/quotes", label: "Quotes", description: "Review customer quote requests and their saved details." },
  { id: "schedule", href: "/admin/schedule", label: "Schedule", description: "Review booking requests, proposed work periods and calendar changes." },
  { id: "jobs", href: "/admin/jobs", label: "Jobs", description: "Job management is being prepared.", upcoming: true },
  { id: "orders", href: "/admin/orders", label: "Orders", description: "Order management is being prepared.", upcoming: true },
  { id: "inventory", href: "/admin/inventory", label: "Inventory", description: "Inventory management is being prepared.", upcoming: true },
  { id: "reports", href: "/admin/reports", label: "Reports", description: "Reporting is being prepared.", upcoming: true },
  { id: "settings", href: "/admin/settings", label: "Settings", description: "Manage your session and company connections." },
] as const;
export type AdminPageId = typeof adminPages[number]["id"];
const oldHashes: Record<string, string> = {
  "#operations-content": "/admin/enquiries",
  "#customers-heading": "/admin/customers",
  "#staff-session-security-heading": "/admin/settings#staff-session-security-heading",
  "#signed-demo-requests": "/admin/schedule#signed-demo-requests",
};
export function compatibleAdminPath(pathname: string, search: string, hash: string): string | null {
  if (pathname !== "/admin") return null;
  if (new URLSearchParams(search).get("google") === "connected") return "/admin/settings#company-connections";
  return Object.hasOwn(oldHashes, hash) ? oldHashes[hash] : null;
}
