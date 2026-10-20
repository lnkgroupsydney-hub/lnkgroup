import { companyContent } from "@/modules/company-profile";

export const cabinetPaintingContent = {
  serviceName: "Kitchen Cabinet Painting",
  title: "Kitchen Cabinet Painting",
  metadataDescription:
    "Refresh suitable cabinet doors, drawer fronts and visible panels with L&K Group around Ermington and Inner West Sydney. Explore the process and request a photo-based provisional estimate.",
  locationLabel: "Existing kitchens · Sydney",
  tagline: "A fresh finish for the kitchen you have.",
  introduction:
    "Refresh suitable doors, drawer fronts and visible panels while keeping your existing kitchen layout.",
  quoteLabel: "Request a quote",
  contactLabel: `Contact ${companyContent.contact.person}`,
  heroQuoteStatus:
    "Upload photos for an AI-assisted estimate. Booking dates are confirmed by our team.",
  quoteStatus:
    "Review your photo-based estimate, choose a preferred take-off date and time, then sign and submit. L&K reviews the request and confirms the booking and installation date.",
  conceptCaption: "Generated concept — not a completed L&K project.",
  categoriesTitle: "What we paint",
  categoriesIntroduction:
    "Full repainting, partial refreshes, touch-ups and colour changes — planned around your existing cabinets.",
  categories: [
    {
      id: "doors-drawers",
      title: "Doors & drawer fronts",
      description:
        "Refresh the fronts that shape your kitchen. We assess the material, profile and existing finish, then agree which faces, edges and backs are included before painting.",
    },
    {
      id: "frames-panels",
      title: "Frames & visible panels",
      description:
        "Coordinate exposed frames, end panels and accessible fixed surfaces with the doors. The scope identifies where the new finish starts and stops, including visible edges and adjoining areas.",
    },
    {
      id: "preparation-repairs",
      title: "Preparation & repairs",
      description:
        "Plan cleaning, sanding and minor cosmetic repairs around the assessed surface. Peeling finishes, loose coverings, swelling or other damage need separate assessment before a suitable approach is agreed.",
    },
  ],
  process: {
    title: "The painting process",
    introduction:
      "Follow the existing kitchen from assessment and preparation to painting, drying and reassembly.",
    confirmations: [
      "Colour, sheen, coating details and kitchen access are agreed for your project.",
    ],
  },
  workshopNote: "Separate spray booth · Dulux Aquanamel",
  workshopLinkLabel: "See our preparation and spray-painting photos",
  transformation: {
    title: "A possible transformation",
    introduction:
      "Move the divider to explore a colour change in the same kitchen. Confirm your final colour and sheen with physical samples and the agreed coating system.",
    caption:
      "Generated concepts — not completed L&K projects. Actual colour and results depend on your cabinets, materials and lighting.",
  },
  inclusions: {
    title: "Scope, made clear",
    introduction:
      "Your quote records the surfaces, preparation and finish agreed for your existing kitchen.",
    includedTitle: "Assess and agree",
    included: [
      "Doors, drawer fronts, exposed frames and panels, with each included face listed.",
      "Preparation, minor cosmetic repairs, protection, colour and sheen.",
      "Door removal, hardware handling, reassembly and a final check.",
    ],
    excludedTitle: "Confirm separately",
    excluded: [
      "New cabinet manufacture, installation and layout changes are excluded.",
      "Structural or moisture damage and replacement panels need separate assessment.",
      "Backs, interiors, shelves, kickboards, replacement handles, hinge work and new holes are not automatically included.",
      "Benchtops, splashbacks, walls, appliances, plumbing and electrical work are outside this service.",
    ],
  },
  serviceArea: {
    introduction: "Serving Ermington, Inner West Sydney and surrounding suburbs.",
    linkLabel: "View our service area",
  },
  faqTitle: "Questions, answered",
  faqs: [
    {
      question: "Can my existing cabinets be painted?",
      answer:
        "Timber, previously painted surfaces, laminate and melamine need assessment of their material, coating and condition before preparation is chosen. Loose coverings, swelling or structural and moisture problems may require another repair or replacement approach. For partial touch-ups, an exact match to an aged finish cannot be assumed.",
    },
    {
      question: "Which surfaces and hardware are included?",
      answer:
        "Doors, drawer fronts, frames and visible panels are itemised in your scope. Front faces do not automatically include backs, edges, interiors, shelves or kickboards. Doors are removed for booth painting; refitting and hardware handling are agreed. Handle replacement is available, with costs, hinge work and new holes confirmed separately.",
    },
    {
      question: "How is the price assessed?",
      answer:
        "Photos support an AI-assisted provisional painting estimate. Exact quantities, condition, included surfaces and access are checked on site. Your original estimate remains recorded; extra preparation, repairs or damage found on site need separate assessment. Proposed additional work, cost and timing changes are discussed before work proceeds and the final scope and price are agreed.",
    },
    {
      question: "How long does the work take?",
      answer:
        "L&K generally allows 3–7 days for work and drying, with careful use recommended for 7 days after reinstallation. Doors are spray-painted and dried in a separate booth. Drying is different from full curing: your actual schedule, kitchen access and return-to-use guidance depend on the preparation, scope and finish agreed for your project.",
    },
    {
      question: "How do I request a quote and booking?",
      answer:
        "Add your details and private cabinet photos, then review the AI-assisted estimate. Choose a preferred take-off date and time, sign and submit the request. L&K reviews it, confirms the work periods and assigns the installation date before sending booking confirmation. Submitting a request alone does not confirm a booking.",
    },
  ],
  closing: {
    title: "Plan a refresh for your existing kitchen",
    description:
      "Start with photos of your cabinet area and the finish you have in mind. Our team will review the surfaces, scope and next steps with you.",
  },
} as const;
