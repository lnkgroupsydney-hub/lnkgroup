import type { Metadata } from "next";
import { connection } from "next/server";
import { StaffAdminBoundary } from "@/modules/admin-access/client";
import { AdminWorkspace } from "@/modules/admin-dashboard/client";
import { staffWorkspaceEnabled } from "@/modules/admin-dashboard/server";

export const metadata: Metadata = { title: "L&K Group EMS — Private workspace", description: "Private company administration.", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!staffWorkspaceEnabled()) return <main id="main-content">{children}</main>;
  return <StaffAdminBoundary authMain><AdminWorkspace>{children}</AdminWorkspace></StaffAdminBoundary>;
}
