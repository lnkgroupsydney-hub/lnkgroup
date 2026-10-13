import type { Metadata } from "next";
import { siteAssets } from "@/shared/config/assets";
import { siteConfig } from "@/shared/config/site";
import { manrope } from "@/shared/config/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${siteConfig.name} | Home maintenance & painting`,
  description:
    "L&K Group provides painting, cabinet refreshes, handyman services and home repair products in Sydney.",
  icons: {
    icon: {
      url: siteAssets.wordmark.src,
      type: "image/png",
      sizes: `${siteAssets.wordmark.width}x${siteAssets.wordmark.height}`,
    },
  },
  robots: {
    index: !siteConfig.isPrototype,
    follow: !siteConfig.isPrototype,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={siteConfig.language} className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
