import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AdminSection } from "@/modules/admin-dashboard/client";
import { requireStaffWorkspace } from "@/modules/admin-dashboard/server";
import { EnquiryInbox, EnquiryRecord } from "@/modules/enquiries/client";

const ENQUIRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminSectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  requireStaffWorkspace();
  const { enquiry } = await searchParams;
  if (enquiry !== undefined) {
    if (typeof enquiry !== "string" || !ENQUIRY_ID.test(enquiry)) notFound();
    return <EnquiryRecord key={enquiry.toLowerCase()} enquiryId={enquiry.toLowerCase()} />;
  }
  return <><EnquiryInbox /><AdminSection view="enquiries" /></>;
}
