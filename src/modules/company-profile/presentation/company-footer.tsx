import { ArrowUp } from "lucide-react";
import { getNavigationItems } from "@/shared/config/navigation";
import { siteConfig } from "@/shared/config/site";
import { Container } from "@/shared/ui/container";
import { companyContent } from "../content/company-content";

export function CompanyFooter({ isHomePage = true }: { isHomePage?: boolean }) {
  const navigationItems = getNavigationItems(isHomePage);

  return (
    <footer className="border-t border-border py-8">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-lg font-semibold">{siteConfig.name}</p>
            <p className="mt-2 text-xs leading-6 text-muted">
              {siteConfig.name}<br />
              ABN {companyContent.business.abn}<br />
              Painting licence {companyContent.business.paintingLicence}
            </p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted">
              {isHomePage
                ? "Company-provided artwork and process photos."
                : "Generated cabinet concepts, not completed L&K projects."}
            </p>
          </div>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-6 gap-y-1">
            {navigationItems.map((item) => (
              <a key={item.href} href={item.href} className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">{item.label}</a>
            ))}
          </nav>
        </div>
        <a href="#home" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline-offset-4 hover:underline">
          Back to top <ArrowUp size={16} aria-hidden="true" />
        </a>
      </Container>
    </footer>
  );
}
