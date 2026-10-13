import { siteAssets, type ImageAsset } from "@/shared/config/assets";
import { siteRoutes, type NavigationItem } from "@/shared/config/navigation";

type HomeOffering = Readonly<{
  id: string;
  name: string;
  description: string;
  icon: "house" | "cabinet" | "tools" | "paint" | "kimchi";
  category: "service" | "product";
  image: ImageAsset;
  detail: string;
  availability?: string;
  href?: typeof siteRoutes.cabinetPainting;
}>;

export const homeContent = {
  title: "L&K Group | Painting & Home Care in Ermington, Sydney",
  description:
    "L&K Group offers residential painting, kitchen cabinet painting, handyman services, paint touch-up kits and kimchi. Local to Ermington and nearby Sydney suburbs.",
  navigation: [
    { label: "Services", href: "#services" },
    { label: "About", href: "#about" },
    { label: "What we offer", href: "#gallery" },
    { label: "Service area", href: "#service-area" },
    { label: "Contact", href: "#contact" },
  ] as const satisfies readonly NavigationItem[],
  hero: {
    location: "Ermington, Sydney",
    heading: "Local services. Everyday care.",
    introduction:
      "Painting, practical home repairs and everyday products, brought together by L&K Group.",
    area: "Based in Ermington, serving nearby Sydney suburbs.",
    photo: siteAssets.homeGroupHero,
    caption: "Illustrative concept",
  },
  offerings: [
    {
      id: "residential-painting",
      name: "Residential Painting",
      description:
        "Interior and exterior painting for homes, with careful preparation and attention to detail.",
      image: siteAssets.homeResidentialPainting,
      detail: "Interior and exterior painting, from walls and trim to careful surface preparation and finishing.",
      icon: "house",
      category: "service",
      availability: "Service page coming soon",
    },
    {
      id: "kitchen-cabinet-painting",
      name: "Kitchen Cabinet Painting",
      description:
        "Refresh your existing cabinet doors and drawer fronts while keeping the kitchen you have.",
      image: siteAssets.homeCabinetPainting,
      detail: "Painting and refreshing existing cabinet doors and drawer fronts, with preparation and a considered finishing process.",
      icon: "cabinet",
      category: "service",
      href: siteRoutes.cabinetPainting,
    },
    {
      id: "handyman-services",
      name: "Handyman Services",
      description:
        "Practical help with minor home repairs, adjustments and maintenance.",
      image: siteAssets.homeHandyman,
      detail: "Minor repairs, door and hinge adjustments, flyscreen replacement and practical maintenance around the home.",
      icon: "tools",
      category: "service",
      availability: "Service page coming soon",
    },
    {
      id: "paint-touch-up-kits",
      name: "Paint Touch-up Kits",
      description:
        "Paint touch-up kits for small marks and everyday home maintenance.",
      image: siteAssets.homeTouchUpKits,
      detail: "Touch-up paint kits for small marks and worn spots, helping you maintain painted surfaces between larger jobs.",
      icon: "paint",
      category: "product",
      availability: "Online ordering coming soon",
    },
    {
      id: "kimchi",
      name: "Kimchi",
      description: "Kimchi from L&K Group. Product details will be added here.",
      image: siteAssets.homeKimchi,
      detail: "Kimchi is part of our everyday product range. Product information and online ordering details are coming soon.",
      icon: "kimchi",
      category: "product",
      availability: "Online ordering coming soon",
    },
  ] as const satisfies readonly HomeOffering[],
  about: {
    heading: "Local care, with attention to detail.",
    introduction:
      "We help you refresh and maintain the home you already have. From painting and cabinet care to the smaller jobs around the house, L&K Group brings practical services together in one place.",
    contact: "Based in Ermington. Speak with Lisa about what your home needs.",
  },
  work: {
    heading: "Services for your home. Products for everyday life.",
    introduction:
      "From a freshly painted room to a small repair or an everyday product, discover the different ways L&K Group can help.",
    illustrationNote: "Images are illustrative concepts of our services and products.",
  },
  area: {
    heading: "Local to Ermington. Close to your home.",
    introduction:
      "Based in Ermington NSW 2115, we provide local services across nearby Sydney suburbs.",
    additional:
      "We serve Ermington, surrounding suburbs and Inner West Sydney. Please confirm availability for your property address with Lisa.",
  },
  contact: {
    heading: "Tell Lisa what you have in mind.",
    introduction:
      "A room to repaint, cabinets to refresh, or a small job around the house? Start with a conversation.",
  },
} as const;

export type { HomeOffering };
