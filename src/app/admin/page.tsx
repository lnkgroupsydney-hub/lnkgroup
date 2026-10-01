import type { Metadata } from "next";
import { OperationsConsole } from "@/modules/operations";

export const metadata: Metadata = {
  title: "L&K Group operations — Private preview",
  description: "Private operations for enquiry and calendar review.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <main id="main-content"><OperationsConsole /></main>;
}
