export const adminNavGroups = [
  { id: "work", label: "Work" },
  { id: "soon", label: "Coming soon" },
  { id: "admin", label: "Admin" },
] as const;
export type AdminNavGroupId = typeof adminNavGroups[number]["id"];

export const adminPages = [
  { id: "overview", group: "work", href: "/admin", label: "Overview", description: "Your workspace for clients, enquiries and schedules." },
  { id: "customers", group: "work", href: "/admin/customers", label: "Clients", description: "Find client records, their enquiries and connected documents." },
  { id: "enquiries", group: "work", href: "/admin/enquiries", label: "Enquiries", description: "Review website enquiries, signed reservation requests and Gmail conversations." },
  { id: "quotes", group: "work", href: "/admin/quotes", label: "Quotes", description: "Review customer quote requests and their saved details." },
  { id: "schedule", group: "work", href: "/admin/schedule", label: "Schedule", description: "Review booking requests, proposed work periods and calendar changes." },
  { id: "jobs", group: "soon", href: "/admin/jobs", label: "Jobs", description: "Job management is being prepared.", upcoming: true },
  { id: "orders", group: "soon", href: "/admin/orders", label: "Orders", description: "Order management is being prepared.", upcoming: true },
  { id: "inventory", group: "soon", href: "/admin/inventory", label: "Inventory", description: "Inventory management is being prepared.", upcoming: true },
  { id: "reports", group: "soon", href: "/admin/reports", label: "Reports", description: "Reporting is being prepared.", upcoming: true },
  { id: "settings", group: "admin", href: "/admin/settings", label: "Settings", description: "Manage your session and company connections." },
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
