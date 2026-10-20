import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { siteAssets } from "@/shared/config/assets";
import { connection } from "next/server";
import { headers } from "next/headers";
import { LiveQuoteForm } from "@/modules/quotes/client";
import { CompanyFooter, CompanyHeader } from "@/modules/company-profile";
import { QuoteDraftForm } from "@/modules/enquiries";

export const metadata: Metadata = {
  title: "Request a Kitchen Cabinet Painting quote | L&K Group",
  description: "Tell L&K Group about your existing kitchen cabinets and request a project review.",
  robots: { index: false, follow: false },
};

export default async function QuoteStartPage({ searchParams }: { searchParams: Promise<{ mode?: string; quote?: string }> }) {
  await connection();
  const params = await searchParams;
  const requestHeaders = await headers();
  const companyBaseUrl = process.env.APP_BASE_URL ?? "";
  let legacyRecoveryMode = false;
  try { legacyRecoveryMode = Boolean(process.env.QUOTE_LEGACY_BASE_URL && new URL(process.env.QUOTE_LEGACY_BASE_URL).host === requestHeaders.get("host")); } catch { /* Invalid configuration cannot activate legacy access. */ }
  const live = params.mode === "live" || (process.env.QUOTE_LIVE_ENABLED === "true" && params.mode !== "demo" && params.quote === undefined);
  if (live) return <div className="quote-route-shell">
    <header className="quote-route-header"><Link href="/" className="quote-brand" aria-label="L&K Group — Home"><Image src={siteAssets.wordmark.src} alt="" width={40} height={40} /><span>L&amp;K Group<small>Kitchen Cabinet Painting</small></span></Link><a href="/services/cabinet-painting" className="quote-exit"><ArrowLeft size={16} aria-hidden="true" />Back to service</a></header>
    <main id="main-content" tabIndex={-1}><LiveQuoteForm legacyRecoveryMode={legacyRecoveryMode} companyBaseUrl={companyBaseUrl} /></main>
    <footer className="quote-route-footer"><ShieldCheck size={13} aria-hidden="true" /><span>Private quote request · Company confirmation required for bookings</span></footer>
  </div>;
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
