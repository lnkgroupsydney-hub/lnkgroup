# Private PDF font

`LKDemoSans-Regular.ttf` is a static regular-weight derivative of Noto Sans KR, under the SIL Open Font License 1.1 in `LICENSE.txt`. The derivative is renamed to avoid use of the reserved original font name.

Source: https://github.com/google/fonts/blob/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf

Retrieved 2026-10-03; generated with FontTools 4.60.1 `instantiateVariableFont(font, {'wght':400}, inplace=True)`, then name records 1, 2, 3, 4, 6, 16 and 17 renamed to LK Demo Sans / Regular. Set `font['glyf'].padding = 4` before saving: the PDF font subsetter changes to short loca offsets and requires even glyph boundaries. Without this alignment, text extraction succeeds but some rendered glyphs disappear. No glyphs removed from the server font. The server embeds only the glyph subset needed for each private PDF. This folder is not under `public` and is never imported by customer browser components.

TrueType is used because the previous CID CFF subset could not be rendered reliably by PDF viewers. PDF output is rendered and text-extracted during verification.
