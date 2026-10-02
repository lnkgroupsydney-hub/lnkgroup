import type { Metadata } from "next";
import { CompanyFooter, CompanyHeader } from "@/modules/company-profile";
import { QuoteDraftForm } from "@/modules/enquiries";

export const metadata: Metadata = {
  title: "Request a Kitchen Cabinet Painting quote | L&K Group — Preview",
  description: "Tell L&K Group about your existing kitchen cabinets and request a project review.",
  robots: { index: false, follow: false },
};

export default function QuoteStartPage() {
  return (
    <>
      <CompanyHeader isHomePage={false} />
      <main id="main-content" tabIndex={-1}>
        <QuoteDraftForm />
      </main>
      <CompanyFooter isHomePage={false} />
    </>
  );
}
