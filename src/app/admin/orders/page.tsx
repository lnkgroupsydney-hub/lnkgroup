import { connection } from "next/server";
import { AdminSection } from "@/modules/admin-dashboard/client";
import { requireStaffWorkspace } from "@/modules/admin-dashboard/server";

export default async function AdminSectionPage() {
  await connection();
  requireStaffWorkspace();
  return <AdminSection view="orders" />;
}
