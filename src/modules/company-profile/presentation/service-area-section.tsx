import { Container } from "@/shared/ui/container";
import { companyContent } from "../content/company-content";

export function ServiceAreaSection() {
  const { serviceArea } = companyContent;

  return (
    <section
      id="service-area"
      tabIndex={-1}
      aria-labelledby="service-area-title"
      className="border-t border-border py-16 sm:py-20"
    >
      <Container>
        <h2 id="service-area-title" className="max-w-[28ch] text-section-title">
          Our Sydney service area
        </h2>
        <p className="mt-4 max-w-[65ch] text-body text-muted">{serviceArea.introduction}</p>
        <div className="mt-7 grid gap-7 md:grid-cols-3">
          {serviceArea.groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-lg leading-7 font-semibold">{group.title}</h3>
              <p className="mt-2 text-base leading-7 text-muted">{group.suburbs.join(", ")}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-[65ch] text-caption text-muted">{serviceArea.guidance}</p>
        <p className="mt-3 max-w-[65ch] text-body text-muted">{serviceArea.addressNote}</p>
        <a
          className="mt-3 inline-flex min-h-12 items-center text-base font-semibold underline underline-offset-4"
          href={serviceArea.mapLink.href}
        >
          {serviceArea.mapLink.label}
        </a>
      </Container>
    </section>
  );
}
