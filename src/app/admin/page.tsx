import { connection } from "next/server";
import { OperationsConsole } from "@/modules/operations";
import { StaffAdminConsole } from "@/modules/admin-access/client";
import { AdminOverview } from "@/modules/admin-dashboard/client";
import { staffWorkspaceEnabled } from "@/modules/admin-dashboard/server";

export default async function AdminPage() {
  await connection();
  if (staffWorkspaceEnabled()) return <AdminOverview />;
  return process.env.STAFF_ADMIN_AUTH_ENABLED === "true" ? <StaffAdminConsole /> : <OperationsConsole />;
}
