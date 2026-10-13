import type { Metadata } from "next";
import { HomePageContent, homeContent } from "@/modules/company-profile";
import { siteConfig } from "@/shared/config/site";

export const metadata: Metadata = {
  title: homeContent.title,
  description: homeContent.description,
  openGraph: {
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
  return <HomePageContent />;
}
