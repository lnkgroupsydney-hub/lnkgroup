import type { Metadata } from "next";
import { connection } from "next/server";
import { OperationsConsole } from "@/modules/operations";
import { StaffAdminConsole } from "@/modules/admin-access/client";

export const metadata: Metadata = {
  title: "L&K Group operations — Private preview",
  description: "Private operations for enquiry and calendar review.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  await connection();
  return <main id="main-content">{process.env.STAFF_ADMIN_AUTH_ENABLED === "true" ? <StaffAdminConsole /> : <OperationsConsole />}</main>;
}
