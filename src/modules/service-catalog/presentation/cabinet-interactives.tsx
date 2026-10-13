"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { siteAssets } from "@/shared/config/assets";

type BeforeAfterProps = {
  title: string;
  introduction: string;
  caption: string;
};

export function BeforeAfter({ title, introduction, caption }: BeforeAfterProps) {
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);
  const before = siteAssets.frontStoryExisting;
  const after = siteAssets.frontStoryFinished;
  const updateFromPointer = (element: HTMLDivElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, Math.round((clientX - bounds.left) / bounds.width * 100))));
  };
  return (
    <section id="cabinet-transformation" className="kcp-transformation kcp-section" aria-labelledby="cabinet-transformation-title">
      <div className="kcp-wrap">
        <div className="kcp-section-heading">
          <p className="kcp-kicker">The same kitchen</p>
          <h2 id="cabinet-transformation-title">{title}</h2>
          <p id="cabinet-examples">{introduction}</p>
        </div>
        <div className="kcp-compare" role="group" aria-label="Before and after concept comparison">
          <div className="kcp-compare-images" role="img" aria-label="Generated concept comparison of the same kitchen before cabinet painting and with refreshed sage-grey cabinets"
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event.currentTarget, event.clientX); }}
            onPointerMove={(event) => { if (dragging.current) updateFromPointer(event.currentTarget, event.clientX); }}
            onPointerUp={(event) => { updateFromPointer(event.currentTarget, event.clientX); dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { dragging.current = false; }}>
            <Image src={after.src} alt="" draggable={false} width={after.width} height={after.height} sizes="(min-width: 1200px) 1200px, 100vw" />
            <div className="kcp-compare-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
              <Image src={before.src} alt="" draggable={false} width={before.width} height={before.height} sizes="(min-width: 1200px) 1200px, 100vw" />
            </div>
            <span className="kcp-compare-label kcp-compare-label-before">Before concept</span>
            <span className="kcp-compare-label kcp-compare-label-after">After concept</span>
            <span className="kcp-compare-divider" style={{ left: `${split}%` }} aria-hidden="true"><span>↔</span></span>
          </div>
          <label className="kcp-compare-range-label" htmlFor="cabinet-comparison-range">Compare before and after <output htmlFor="cabinet-comparison-range">{split}% before</output></label>
          <input id="cabinet-comparison-range" className="kcp-compare-range" type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-valuetext={`${split} percent of before concept visible`} />
        </div>
        <p className="kcp-caption">{caption}</p>
      </div>
    </section>
  );
}
