import type { Metadata } from "next";
import { CompanyFooter, CompanyHeader } from "@/modules/company-profile";
import { CabinetPaintingDetail, cabinetPaintingContent } from "@/modules/service-catalog";
import { siteConfig } from "@/shared/config/site";

export const metadata: Metadata = {
  title: `${cabinetPaintingContent.title} | ${siteConfig.name}`,
  description: cabinetPaintingContent.metadataDescription,
  openGraph: {
    title: `${cabinetPaintingContent.title} | ${siteConfig.name}`,
    description: cabinetPaintingContent.metadataDescription,
    siteName: siteConfig.name,
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: `${cabinetPaintingContent.title} | ${siteConfig.name}`,
    description: cabinetPaintingContent.metadataDescription,
  },
};

export default function CabinetPaintingPage() {
  return (
    <>
      <CompanyHeader isHomePage={false} overlayPhotoHero />
      <main id="main-content" tabIndex={-1}>
        <CabinetPaintingDetail />
      </main>
      <CompanyFooter isHomePage={false} />
    </>
  );
}
