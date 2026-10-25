import Image from 'next/image';
import type { ReactNode } from 'react';
import { ArrowRight, Camera, CalendarDays, ClipboardCheck, Clock3, Mail, Paintbrush, ShieldCheck, Tag, Truck } from 'lucide-react';
import { siteAssets } from '@/shared/config/assets';

const NEXT_STEPS = [
  { title: 'Request your quote', text: 'Share your details and cabinet photos for a photo-based estimate.', icon: ClipboardCheck },
  { title: 'We check your request', text: 'Our team reviews your photos, estimate and preferred visit.', icon: Mail },
  { title: 'Door-removal visit', text: 'We remove your cabinet fronts and take them to our workshop.', icon: Truck },
  { title: 'Workshop painting & reinstall', text: 'Fronts are spray-painted in our workshop, then reinstalled at a visit we confirm by email.', icon: Paintbrush },
] as const;

/** First choice before a private writing session opens. Prices come from quotePricingDisplay. */
export function QuoteEntry({ disabled, startingAmount, taxStatus, onStart, onView, children }: { disabled: boolean; startingAmount: string; taxStatus: string; onStart: () => void; onView: () => void; children?: ReactNode }) {
  const photo = siteAssets.homeCabinetPainting;
  return <section className="lq-card lq-entry" aria-labelledby="quote-entry-title">
    <div className="lq-entry-intro">
      <p className="lq-kicker">Kitchen Cabinet Painting</p>
      <h1 id="quote-entry-title">Let’s refresh your kitchen.</h1>
      <p>Get a photo-based painting estimate for your existing cabinets, or open a quote you saved earlier.</p>
    </div>
    <div className="lq-entry-cards">
      <button className="lq-entry-primary" aria-label="Start a new quote" type="button" disabled={disabled} onClick={onStart}>
        <span className="lq-entry-primary-text"><strong>Start a new quote</strong><span>Tell us about your kitchen and add a few photos. Your saved quotes stay separate.</span><span className="lq-entry-cta">Start now<ArrowRight size={18} aria-hidden="true" /></span></span>
        <span className="lq-entry-photo"><Image src={photo.src} alt="" width={photo.width} height={photo.height} sizes="(max-width: 700px) 100vw, 22rem" /><small>Concept image</small></span>
      </button>
      <button className="lq-entry-secondary" aria-label="View quotes & bookings" type="button" disabled={disabled} onClick={onView}>
        <CalendarDays size={22} aria-hidden="true" /><span><strong>View quotes &amp; bookings</strong><span>Use your email to open a saved quote or booking request.</span></span><ArrowRight size={18} aria-hidden="true" />
      </button>
    </div>
    <ul className="lq-entry-expectations" aria-label="Before you start">
      <li><Clock3 size={18} aria-hidden="true" />About 5 minutes</li>
      <li><Camera size={18} aria-hidden="true" />Have about 5 cabinet photos ready</li>
      <li><Tag size={18} aria-hidden="true" />From {startingAmount} · {taxStatus}</li>
    </ul>
    {children}
    <section className="lq-entry-next" aria-labelledby="quote-entry-next-title">
      <h2 id="quote-entry-next-title">What happens next</h2>
      <ol>{NEXT_STEPS.map(({ title, text, icon: Icon }, index) => <li key={title}><span className="lq-entry-next-icon"><Icon size={18} aria-hidden="true" /></span><span><strong><span className="lq-sr-only">Step {index + 1}: </span>{title}</strong><span>{text}</span></span></li>)}</ol>
    </section>
    <p className="lq-private-note"><ShieldCheck size={16} aria-hidden="true" />Your details and photos stay private. Bookings are confirmed by the company.</p>
  </section>;
}
