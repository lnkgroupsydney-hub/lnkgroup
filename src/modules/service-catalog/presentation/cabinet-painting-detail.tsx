import { ArrowUpRight, Plus } from "lucide-react";
import { siteRoutes } from "@/shared/config/navigation";
import { cabinetPaintingContent as content } from "../content/cabinet-painting-content";
import { CabinetHero } from "./cabinet-hero";
import { CabinetCinematicStory } from "./cabinet-cinematic-story";
import { BeforeAfter } from "./cabinet-interactives";
import "./cabinet-cinematic.css";

const pageSections = [
  { href: "#cabinet-services", label: "Services" },
  { href: "#cabinet-process", label: "Process" },
  { href: "#cabinet-transformation", label: "Transformation" },
  { href: "#cabinet-faq", label: "FAQs" },
] as const;

function Eyebrow({ children }: { children: string }) {
  return <p className="kcp-kicker">{children}</p>;
}

export function CabinetPaintingDetail() {
  return (
    <div className="kcp-page">
      <CabinetHero />
      <nav aria-label="On this page" className="kcp-page-nav">
        <div className="kcp-wrap">
          <span className="kcp-page-nav-label">On this page</span>
          <ul>{pageSections.map((item) => <li key={item.href}><a href={item.href}>{item.label}</a></li>)}</ul>
        </div>
      </nav>

      <section id="cabinet-services" className="kcp-services kcp-section" aria-labelledby="cabinet-services-title">
        <div className="kcp-wrap">
          <div className="kcp-section-heading">
            <Eyebrow>Work with the kitchen you have</Eyebrow>
            <h2 id="cabinet-services-title">{content.categoriesTitle}</h2>
            <p>{content.categoriesIntroduction}</p>
          </div>
          <div className="kcp-services-grid">
            {content.categories.map((category, index) => (
              <article key={category.id}>
                <span className="kcp-service-index">{String(index + 1).padStart(2, "0")}</span>
                <h3>{category.title}</h3>
                <p>{category.description}</p>
              </article>
            ))}
          </div>
          <div id="cabinet-quality" className="kcp-workshop-note">
            <p>{content.workshopNote}</p>
            <a className="kcp-link" href={`${siteRoutes.home}#gallery`}><span>{content.workshopLinkLabel}</span> <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        </div>
      </section>

      <CabinetCinematicStory process={content.process} />
      <BeforeAfter {...content.transformation} />

      <section id="cabinet-inclusions" className="kcp-inclusions kcp-section" aria-labelledby="cabinet-inclusions-title">
        <div className="kcp-wrap">
          <div id="cabinet-why-refinish" className="kcp-section-heading">
            <Eyebrow>Before work begins</Eyebrow>
            <h2 id="cabinet-inclusions-title">{content.inclusions.title}</h2>
            <p>{content.inclusions.introduction}</p>
          </div>
          <div className="kcp-inclusions-grid">
            <div><h3>{content.inclusions.includedTitle}</h3><ul>{content.inclusions.included.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><h3>{content.inclusions.excludedTitle}</h3><ul>{content.inclusions.excluded.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
        </div>
      </section>

      <section id="cabinet-faq" className="kcp-faq kcp-section" aria-labelledby="cabinet-faq-title">
        <div className="kcp-wrap kcp-faq-layout">
          <div><Eyebrow>Good to know</Eyebrow><h2 id="cabinet-faq-title">{content.faqTitle}</h2></div>
          <div className="kcp-faq-list">
            {content.faqs.map((faq, index) => (
              <details key={faq.question} id={index === 0 ? "cabinet-suitability" : undefined}>
                <summary>{faq.question}<Plus size={20} aria-hidden="true" /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="cabinet-quote" className="kcp-quote kcp-section" aria-labelledby="cabinet-quote-title">
        <div className="kcp-wrap">
          <Eyebrow>Start with your kitchen</Eyebrow>
          <h2 id="cabinet-quote-title">{content.closing.title}</h2>
          <p>{content.closing.description}</p>
          <div className="kcp-quote-actions">
            <a href={siteRoutes.cabinetQuote}>{content.quoteLabel}</a>
            <a href={`${siteRoutes.home}#contact`}>{content.contactLabel} <ArrowUpRight size={18} aria-hidden="true" /></a>
          </div>
          <p id="closing-quote-status" className="kcp-small">{content.quoteStatus}</p>
          <p id="cabinet-service-area" className="kcp-area-summary">{content.serviceArea.introduction} <a href={`${siteRoutes.home}#service-area`}>{content.serviceArea.linkLabel} <ArrowUpRight size={16} aria-hidden="true" /></a></p>
        </div>
      </section>
    </div>
  );
}
