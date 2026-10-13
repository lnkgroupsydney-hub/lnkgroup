import Image from "next/image";
import { companyContent } from "../content/company-content";
import { Container } from "@/shared/ui/container";
import { siteAssets } from "@/shared/config/assets";

export function AboutSection() {
  const { companyArtwork } = siteAssets;

  return (
    <section id="about" tabIndex={-1} aria-labelledby="about-title" className="py-16 sm:py-20">
      <Container className="grid gap-8 md:grid-cols-2 md:gap-16">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">About L&K Group</p>
          <h2 id="about-title" className="mt-4 max-w-md text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {companyContent.about.heading}
          </h2>
          <figure className="mt-7">
            <Image
              src={companyArtwork.src}
              alt={companyArtwork.alt}
              width={companyArtwork.width}
              height={companyArtwork.height}
              sizes="(min-width: 1280px) 576px, (min-width: 768px) calc((100vw - 128px) / 2), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)"
              className="h-auto w-full rounded-sm object-contain"
              loading="lazy"
            />
            <figcaption className="mt-3 text-xs leading-5 text-muted">Company-provided promotional artwork.</figcaption>
          </figure>
        </div>
        <div className="space-y-5 text-base leading-8 text-muted">
          {companyContent.about.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <h3 className="font-semibold text-foreground">Our services & products</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-7">
            {companyContent.about.services.map((service) => <li key={service}>{service}</li>)}
          </ul>
        </div>
      </Container>
    </section>
  );
}
