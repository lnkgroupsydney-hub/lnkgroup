import Image from "next/image";
import { ArrowDown, ArrowUpRight, ChevronRight } from "lucide-react";
import { siteAssets } from "@/shared/config/assets";
import { siteRoutes } from "@/shared/config/navigation";
import { cabinetPaintingContent as content } from "../content/cabinet-painting-content";

export function CabinetHero() {
  const image = siteAssets.storyKitchenFinished;
  return (
    <section id="cabinet-overview" className="kcp-hero" aria-labelledby="cabinet-title">
      <Image src={image.src} alt={image.alt} fill sizes="100vw" preload className="kcp-hero-image" />
      <div className="kcp-hero-shade" aria-hidden="true" />
      <div className="kcp-wrap kcp-hero-inner">
        <nav aria-label="Breadcrumb" className="kcp-breadcrumb">
          <ol>
            <li><a href={siteRoutes.home}>Home</a></li>
            <li aria-hidden="true"><ChevronRight size={14} /></li>
            <li><a href={`${siteRoutes.home}#services`}>Services</a></li>
            <li aria-hidden="true"><ChevronRight size={14} /></li>
            <li aria-current="page">{content.serviceName}</li>
          </ol>
        </nav>
        <div className="kcp-hero-copy">
          <p className="kcp-kicker">{content.locationLabel}</p>
          <h1 id="cabinet-title">{content.serviceName}</h1>
          <p className="kcp-hero-tagline">{content.tagline}</p>
          <p className="kcp-hero-lead">{content.introduction}</p>
          <div className="kcp-hero-actions">
            <a href={siteRoutes.cabinetQuote} className="kcp-hero-primary">{content.quoteLabel} <ArrowUpRight size={18} aria-hidden="true" /></a>
            <a href="#cabinet-process" className="kcp-hero-secondary"><span>See the process</span> <ArrowDown size={18} aria-hidden="true" /></a>
          </div>
          <p id="hero-quote-status" className="kcp-hero-status">{content.heroQuoteStatus}</p>
        </div>
        <p className="kcp-hero-caption">{content.conceptCaption}</p>
      </div>
    </section>
  );
}
