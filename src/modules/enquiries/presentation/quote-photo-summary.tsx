"use client";

import Image from "next/image";
import type { QuotePhotoManifestEntry } from "../domain/quote-photos";
import { quoteApiPath } from "./quote-workspace";
import "./quote-photo-upload.css";

export function QuotePhotoSummary({ photos }: { photos: QuotePhotoManifestEntry[] }) {
  return <section aria-label="Photos included in this demonstration"><h3>Service photos · {photos.length}</h3>
    {photos.length ? <><p>These saved photos are included in the summary you approve and sign. When submitted, they are preserved with the original signed request; approving a revised schedule does not replace them. No AI assessment has been performed.</p><ul className="quote-photo-list">{photos.map((photo, index) => <li key={photo.photoId}><Image unoptimized src={quoteApiPath(`/api/quote/photos/${encodeURIComponent(photo.photoId)}/content`)} width={240} height={180} alt={`Service photo ${index + 1} included in this review`} className="quote-photo-thumbnail" /><strong>Photo {index + 1}</strong><span className="enquiry-hint quote-photo-reference">Reference: {photo.photoId}</span></li>)}</ul></> : <p>No photos are included in this version. Company review is still required.</p>}
  </section>;
}
