import type { Metadata } from "next";
import { CompanyFooter, CompanyHeader, PublicStructuredData } from "@/modules/company-profile";
import { CabinetPaintingDetail, cabinetPaintingContent } from "@/modules/service-catalog";
import { siteConfig } from "@/shared/config/site";
import { publicPageSearchMetadata } from "@/shared/seo/metadata";

const searchMetadata = publicPageSearchMetadata("/services/cabinet-painting");

export const metadata: Metadata = {
  ...searchMetadata,
  title: `${cabinetPaintingContent.title} | ${siteConfig.name}`,
  description: cabinetPaintingContent.metadataDescription,
  openGraph: {
    ...searchMetadata.openGraph,
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
      <PublicStructuredData page="cabinet" />
      <CompanyHeader isHomePage={false} overlayPhotoHero />
      <main id="main-content" tabIndex={-1}>
        <CabinetPaintingDetail />
      </main>
      <CompanyFooter isHomePage={false} />
    </>
  );
}
