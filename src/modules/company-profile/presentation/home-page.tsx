import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  CookingPot,
  House,
  Mail,
  MapPin,
  Paintbrush,
  PanelsTopLeft,
  Phone,
  Wrench,
} from "lucide-react";
import { siteAssets } from "@/shared/config/assets";
import { siteConfig } from "@/shared/config/site";
import { Container } from "@/shared/ui/container";
import { companyContent } from "../content/company-content";
import { homeContent, type HomeOffering } from "../content/home-content";
import { MobileMenu } from "./mobile-menu";
import styles from "./home-page.module.css";

const offeringIcons = {
  house: House,
  cabinet: PanelsTopLeft,
  tools: Wrench,
  paint: Paintbrush,
  kimchi: CookingPot,
};

function HomeHeader() {
  const { wordmark } = siteAssets;

  return (
    <header id="home" tabIndex={-1} className={styles.header}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Container>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#home" aria-label="L&K Group — Home">
            <Image src={wordmark.src} alt={wordmark.alt} width={wordmark.width} height={wordmark.height} sizes="(min-width: 640px) 64px, 56px" className={styles.logo} />
            <span className={styles.brandName}>{siteConfig.name}</span>
          </a>
          <nav aria-label="Primary navigation" className={styles.desktopNavigation}>
            {homeContent.navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </nav>
          <MobileMenu items={homeContent.navigation} />
        </div>
      </Container>
    </header>
  );
}

function HomeHero() {
  const { hero } = homeContent;

  return (
    <section className={styles.hero} aria-labelledby="home-heading">
      <Image src={hero.photo.src} alt="" fill sizes="100vw" preload className={styles.heroBackground} />
      <Container>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><MapPin size={17} aria-hidden="true" />{hero.location}</p>
            <h1 id="home-heading">{hero.heading}</h1>
            <p className={styles.heroIntroduction}>{hero.introduction}</p>
            <p className={styles.heroArea}>{hero.area}</p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#services">View our services <ArrowRight size={19} aria-hidden="true" /></a>
              <a className={styles.secondaryButton} href="#contact">Contact Lisa <ArrowRight size={19} aria-hidden="true" /></a>
            </div>
            <p className={styles.heroConcept}>{hero.caption}</p>
          </div>
        </div>
      </Container>
    </section>
  );
}

function OfferingCard({ offering }: { offering: HomeOffering }) {
  const Icon = offeringIcons[offering.icon];
  const active = Boolean(offering.href);

  return (
    <article className={`${styles.offering} ${active ? styles.activeOffering : ""}`} aria-labelledby={`${offering.id}-heading`}>
      <div className={styles.offeringTop}>
        <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
        {!active && <span className={styles.status}>Coming soon</span>}
      </div>
      <h3 id={`${offering.id}-heading`}>{offering.name}</h3>
      <p className={styles.offeringDescription}>{offering.description}</p>
      {offering.href
        ? <Link className={styles.cabinetButton} href={offering.href}>Explore cabinet painting <ArrowRight size={18} aria-hidden="true" /></Link>
        : <p className={styles.availability}>{offering.availability}</p>}
    </article>
  );
}

function HomeServices() {
  return (
    <section id="services" tabIndex={-1} className={styles.section} aria-labelledby="services-heading">
      <Container>
        <div className={styles.sectionIntro}>
          <div>
            <p className={styles.eyebrow}>For your home & everyday life</p>
            <h2 id="services-heading">Our services & products</h2>
          </div>
          <p>Care for your home, and a little more. Explore what L&K Group offers.</p>
        </div>
        <p className={styles.groupLabel}>Services</p>
        <div className={styles.serviceGrid}>
          {homeContent.offerings.filter((offering) => offering.category === "service").map((offering) => <OfferingCard key={offering.id} offering={offering} />)}
        </div>
        <p className={styles.groupLabel}>Products</p>
        <div className={styles.productGrid}>
          {homeContent.offerings.filter((offering) => offering.category === "product").map((offering) => <OfferingCard key={offering.id} offering={offering} />)}
        </div>
        <p className={styles.servicesNote}>Service pages and online ordering are being prepared.</p>
      </Container>
    </section>
  );
}

function HomeAbout() {
  return (
    <section id="about" tabIndex={-1} className={`${styles.section} ${styles.about}`} aria-labelledby="about-heading">
      <Container>
        <div className={styles.aboutGrid}>
          <div>
            <p className={styles.eyebrow}>Meet L&K Group</p>
            <h2 id="about-heading">{homeContent.about.heading}</h2>
          </div>
          <div className={styles.aboutCopy}>
            <p>{homeContent.about.introduction}</p>
            <p>{homeContent.about.contact}</p>
          </div>
        </div>
        <ul className={styles.trustList}>
          <li><span className={styles.trustNumber}>10+ years</span><h3>Of painting experience</h3><p>{companyContent.benefits[0].description}</p></li>
          <li><span className={styles.trustNumber}>Preparation</span><h3>Care before the colour</h3><p>Repairing and preparing surfaces is an important part of the painting process.</p></li>
          <li><span className={styles.trustNumber}>Services & products</span><h3>Care in one place</h3><p>{companyContent.benefits[2].description}</p></li>
        </ul>
      </Container>
    </section>
  );
}

function ServiceImageCard({ offering }: { offering: HomeOffering }) {
  return (
    <article className={styles.imageOffering} aria-labelledby={`${offering.id}-detail-heading`}>
      <div className={styles.workPhoto}>
        <Image src={offering.image.src} alt={offering.image.alt} width={offering.image.width} height={offering.image.height} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
      </div>
      <div className={styles.imageOfferingCopy}>
        <p className={styles.imageOfferingCategory}>{offering.category === "service" ? "Service" : "Product"}{!offering.href && <span className={styles.status}>Coming soon</span>}</p>
        <h3 id={`${offering.id}-detail-heading`}>{offering.name}</h3>
        <p className={styles.imageOfferingDescription}>{offering.detail}</p>
      </div>
    </article>
  );
}

function HomeWork() {
  return (
    <section id="gallery" tabIndex={-1} className={styles.section} aria-labelledby="work-heading">
      <Container>
        <div className={styles.sectionIntro}>
          <div><p className={styles.eyebrow}>What we offer</p><h2 id="work-heading">{homeContent.work.heading}</h2></div>
          <p>{homeContent.work.introduction}</p>
        </div>
        <div className={styles.workGrid}>
          {homeContent.offerings.filter((offering) => offering.category === "service").map((offering) => <ServiceImageCard key={offering.id} offering={offering} />)}
        </div>
        <div className={styles.workProductGrid}>
          {homeContent.offerings.filter((offering) => offering.category === "product").map((offering) => <ServiceImageCard key={offering.id} offering={offering} />)}
        </div>
        <p className={styles.imageConceptNote}>{homeContent.work.illustrationNote}</p>
      </Container>
    </section>
  );
}

function HomeServiceArea() {
  return (
    <section id="service-area" tabIndex={-1} className={`${styles.section} ${styles.area}`} aria-labelledby="area-heading">
      <Container>
        <div className={styles.areaGrid}>
          <div className={styles.areaIntro}>
            <p className={styles.eyebrow}><MapPin size={17} aria-hidden="true" />Our neighbourhood</p>
            <h2 id="area-heading">{homeContent.area.heading}</h2>
            <p>{homeContent.area.introduction}</p>
            <a className={styles.textLink} href={companyContent.serviceArea.mapLink.href} target="_blank" rel="noreferrer">{companyContent.serviceArea.mapLink.label}<ArrowRight size={18} aria-hidden="true" /></a>
          </div>
          <div className={styles.areaDetails}>
            <h3>Nearby suburbs & wider Sydney</h3>
            <p>{homeContent.area.additional}</p>
            {companyContent.serviceArea.groups.map((group) => (
              <div className={styles.suburbGroup} key={group.title}><h4>{group.title}</h4><p>{group.suburbs.join(" · ")}</p></div>
            ))}
            <p className={styles.addressNote}>{companyContent.serviceArea.addressNote}</p>
          </div>
        </div>
      </Container>
    </section>
  );
}

function HomeContact() {
  const { contact } = companyContent;

  return (
    <section id="contact" tabIndex={-1} className={`${styles.section} ${styles.contact}`} aria-labelledby="contact-heading">
      <Container>
        <div className={styles.contactGrid}>
          <div className={styles.contactIntro}>
            <p className={styles.eyebrow}>Let’s talk</p>
            <h2 id="contact-heading">{homeContent.contact.heading}</h2>
            <p>{homeContent.contact.introduction}</p>
            <p className={styles.contactNextStep}>{contact.nextStep}</p>
          </div>
          <div className={styles.contactDetails}>
            <a href={contact.phoneHref} className={styles.phoneLink}><Phone size={23} aria-hidden="true" /><span><span className={styles.contactLabel}>Call {contact.person}</span><span className={styles.phoneNumber}>{contact.phone}</span></span><ArrowRight size={21} aria-hidden="true" /></a>
            <a href={contact.emailHref} className={styles.emailLink}><Mail size={23} aria-hidden="true" /><span><span className={styles.contactLabel}>Email</span><span>{contact.email}</span></span><ArrowRight size={21} aria-hidden="true" /></a>
            <div className={styles.contactHours}><p>Available to chat</p><p>{contact.hours}</p></div>
            <a className={styles.instagramLink} href={contact.instagram.href} target="_blank" rel="noreferrer">Instagram {contact.instagram.label}<ArrowRight size={17} aria-hidden="true" /></a>
          </div>
        </div>
      </Container>
    </section>
  );
}

function HomeFooter() {
  const { wordmark } = siteAssets;
  const { business } = companyContent;

  return (
    <footer className={styles.footer}>
      <Container>
        <div className={styles.footerTop}>
          <div><a className={styles.brand} href="#home" aria-label="L&K Group — Back to top"><Image src={wordmark.src} alt={wordmark.alt} width={wordmark.width} height={wordmark.height} sizes="56px" className={styles.footerLogo} /><span className={styles.brandName}>{siteConfig.name}</span></a><p className={styles.footerTagline}>{companyContent.tagline}</p></div>
          <nav aria-label="Footer navigation" className={styles.footerNavigation}>{homeContent.navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>
        </div>
        <div className={styles.footerBottom}><p>{siteConfig.name}<br />ABN {business.abn} · Painting licence {business.paintingLicence}</p><a href="#home">Back to top <ArrowUp size={17} aria-hidden="true" /></a></div>
      </Container>
    </footer>
  );
}

export function HomePageContent() {
  return (
    <div className={styles.page}>
      <HomeHeader />
      <main id="main-content" tabIndex={-1}>
        <HomeHero />
        <HomeServices />
        <HomeAbout />
        <HomeWork />
        <HomeServiceArea />
        <HomeContact />
      </main>
      <HomeFooter />
    </div>
  );
}
