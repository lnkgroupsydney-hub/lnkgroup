import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AdminSection } from "@/modules/admin-dashboard/client";
import { isAdminRecordId, requireStaffWorkspace } from "@/modules/admin-dashboard/server";

export default async function AdminRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  requireStaffWorkspace();
  const { id } = await params;
  if (!isAdminRecordId(id)) notFound();
  return <AdminSection view="quotes" recordId={id} />;
}
