# Manrope font source

`Manrope-Latin-Variable.woff2` is the official Google Fonts Latin variable subset, supporting weights 400–800. Downloaded from [fonts.gstatic.com](https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2), as listed by the [Google Fonts Manrope CSS](https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap), on 2026-09-28. SHA-256: `e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f`.

`OFL.txt` is the [Google Fonts repository licence](https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt). It is the SIL Open Font License 1.1; keep it with redistributed font files. The Latin subset does not supply Korean glyphs, so the CSS stack falls back for Korean text.

# Outfit font source (administrator workspace only)

The administrator workspace (`/admin/**` and the staff sign-in screens) uses Outfit; the public site keeps Manrope. Outfit is defined in `src/modules/admin-dashboard/presentation/admin-fonts.ts` and imported only by the admin layout, so public pages neither preload nor declare it. `Outfit-Latin-Variable.woff2` (32,228 bytes) and `Outfit-LatinExt-Variable.woff2` (14,760 bytes) are the official Google Fonts Latin and Latin Extended variable subsets, supporting weights 300–800. Downloaded on 2026-10-25 from [fonts.gstatic.com Latin](https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2) and [fonts.gstatic.com Latin Extended](https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJuktqUYLkn8BJ.woff2), as listed by the [Google Fonts Outfit CSS](https://fonts.googleapis.com/css2?family=Outfit:wght@300..800&display=swap) (v15).

- `Outfit-Latin-Variable.woff2` SHA-256: `92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12`
- `Outfit-LatinExt-Variable.woff2` SHA-256: `9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091`

`OFL-Outfit.txt` is the [Google Fonts repository licence](https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt) (SIL Open Font License 1.1, Copyright 2021 The Outfit Project Authors); keep it with the redistributed Outfit files. Outfit has no Korean glyphs, so the administrator font stack (`--ems-font`) falls back to Apple SD Gothic Neo, Noto Sans KR or Malgun Gothic for Korean names and addresses.
