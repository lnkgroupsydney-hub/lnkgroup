import { companyContent } from "../content/company-content";
import { siteAssets } from "@/shared/config/assets";
import { siteConfig } from "@/shared/config/site";
import { isPublicSearchEnvironment, publicPageUrl } from "@/shared/seo/search-policy";

export function PublicStructuredData({ page }: { page: "home" | "cabinet" }) {
  if (!isPublicSearchEnvironment()) return null;
  const organization = {
    "@type": "Organization",
    "@id": `${siteConfig.url}/#organization`,
    name: siteConfig.name,
    url: publicPageUrl("/"),
    logo: new URL(siteAssets.wordmark.src, siteConfig.url).href,
    telephone: companyContent.contact.phone,
    email: companyContent.contact.email,
    sameAs: [companyContent.contact.instagram.href],
  };
  const data = page === "home" ? organization : {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: publicPageUrl("/") },
      { "@type": "ListItem", position: 2, name: "Kitchen Cabinet Painting", item: publicPageUrl("/services/cabinet-painting") },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c") }} />;
}
