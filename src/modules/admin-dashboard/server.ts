import "server-only";
import { notFound } from "next/navigation";

export function staffWorkspaceEnabled() {
  return process.env.STAFF_ADMIN_AUTH_ENABLED === "true" && process.env.STAFF_ADMIN_WORKSPACE_UI !== "legacy";
}
export function requireStaffWorkspace() {
  if (!staffWorkspaceEnabled()) notFound();
}

export { isAdminRecordId } from "./presentation/admin-navigation";
export { outfit } from "./presentation/admin-fonts";
