import localFont from "next/font/local";

// Administrator workspace only (/admin/**). Imported by the admin layout alone, so the preload links and
// @font-face rules stay out of public pages. Both files share the same descriptors; the Latin file is listed
// last so browsers check it first for ordinary text and fall back to Latin Extended per glyph.
export const outfit = localFont({
  src: [
    { path: "../../../shared/assets/fonts/Outfit-LatinExt-Variable.woff2", weight: "300 800", style: "normal" },
    { path: "../../../shared/assets/fonts/Outfit-Latin-Variable.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-outfit",
  display: "swap",
  preload: true,
});
