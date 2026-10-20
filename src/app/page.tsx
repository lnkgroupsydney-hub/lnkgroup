import type { Metadata } from "next";
import { HomePageContent, homeContent, PublicStructuredData } from "@/modules/company-profile";
import { siteConfig } from "@/shared/config/site";
import { publicPageSearchMetadata } from "@/shared/seo/metadata";

const searchMetadata = publicPageSearchMetadata("/");

export const metadata: Metadata = {
  ...searchMetadata,
  title: homeContent.title,
  description: homeContent.description,
  openGraph: {
    ...searchMetadata.openGraph,
    title: homeContent.title,
    description: homeContent.description,
    siteName: siteConfig.name,
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: homeContent.title,
    description: homeContent.description,
  },
};

export default function HomePage() {
  return <><PublicStructuredData page="home" /><HomePageContent /></>;
}
