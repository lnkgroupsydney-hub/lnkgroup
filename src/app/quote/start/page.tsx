import type { Metadata } from "next";
import { connection } from "next/server";
import { LiveQuoteForm } from "@/modules/quotes/client";
import { CompanyFooter, CompanyHeader } from "@/modules/company-profile";
import { QuoteDraftForm } from "@/modules/enquiries";

export const metadata: Metadata = {
  title: "Request a Kitchen Cabinet Painting quote | L&K Group — Preview",
  description: "Tell L&K Group about your existing kitchen cabinets and request a project review.",
  robots: { index: false, follow: false },
};

export default async function QuoteStartPage({ searchParams }: { searchParams: Promise<{ mode?: string; quote?: string }> }) {
  await connection();
  const params = await searchParams;
  const live = params.mode === "live" || (process.env.QUOTE_LIVE_ENABLED === "true" && params.mode !== "demo" && params.quote === undefined);
  return (
    <>
      <CompanyHeader isHomePage={false} />
      <main id="main-content" tabIndex={-1}>
        {live ? <LiveQuoteForm previousDemoAvailable={process.env.QUOTE_DEMO_ENABLED === "true"} /> : <QuoteDraftForm />}
      </main>
      <CompanyFooter isHomePage={false} />
    </>
  );
}
