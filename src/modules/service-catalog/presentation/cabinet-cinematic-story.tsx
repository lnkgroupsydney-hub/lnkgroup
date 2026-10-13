"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { ArrowDown, ArrowDownRight, ArrowUp } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { siteAssets } from "@/shared/config/assets";
import { kitchenChapterProgress } from "@/shared/ui/kitchen-scene/timeline";

const KitchenScene = dynamic(
  () => import("@/shared/ui/kitchen-scene").then((module) => module.KitchenScene),
  { ssr: false },
);

const stages = [
  {
    id: "cabinet-process-existing", number: "01", title: "Inspect the existing kitchen", label: "Inspection",
    detail: "Material, condition and proposed scope are assessed first.",
    copy: "We inspect the existing cabinets and identify the doors, drawers, frames and panels proposed for painting.",
    image: siteAssets.frontStoryExisting,
  },
  {
    id: "cabinet-process-remove", number: "02", title: "Remove doors and hardware", label: "Removal",
    detail: "Labelling, hardware and refitting are agreed in the scope.",
    copy: "Removable doors are taken off for spray painting and drying in a separate booth.",
    image: siteAssets.frontStoryRemoved,
  },
  {
    id: "cabinet-process-clean", number: "03", title: "Clean before coating", label: "Cleaning",
    detail: "Cleaning depends on the surface and coating system.",
    copy: "Grease and everyday residues are cleaned away where needed to support adhesion.",
    image: siteAssets.cinematicCleaning,
  },
  {
    id: "cabinet-process-prepare", number: "04", title: "Prepare and repair", label: "Surface preparation",
    detail: "Lifting coverings or underlying damage need separate assessment.",
    copy: "Suitable surfaces are sanded and small chips or dents patched under the agreed preparation scope.",
    image: siteAssets.frontStoryPrepared,
  },
  {
    id: "cabinet-process-mask", number: "05", title: "Protect the surroundings", label: "Masking",
    detail: "Fixed frames and panels to be coated are identified first.",
    copy: "Nearby benchtops, walls, floors and appliances are protected for the agreed work.",
    image: siteAssets.cinematicMasking,
  },
  {
    id: "cabinet-process-undercoat", number: "06", title: "Build the foundation", label: "Primer / undercoat",
    detail: "The compatible system follows manufacturer instructions.",
    copy: "A compatible primer or undercoat builds the base for the selected finish where required.",
    image: siteAssets.storyUndercoat,
  },
  {
    id: "cabinet-process-finish", number: "07", title: "Apply the finish", label: "Finish coats",
    detail: "Actual product, coat count, colour and sheen are agreed.",
    copy: "The illustration shows two finish-coat passes over the same prepared doors.",
    image: siteAssets.frontStoryCoatTwo,
  },
  {
    id: "cabinet-process-cure", number: "08", title: "Allow time to dry", label: "Drying & curing",
    detail: "Work generally takes 3–7 days, with careful use for 7 days after refitting.",
    copy: "The finish dries between stages, while full curing and care continue after application.",
    image: siteAssets.frontStoryCoatTwo,
  },
  {
    id: "cabinet-process-reassemble", number: "09", title: "Reassemble and check", label: "Reassembly",
    detail: "Alignment, operation and finish are reviewed against the scope.",
    copy: "Once the finish is ready, the agreed doors and hardware are refitted and checked.",
    image: siteAssets.frontStoryFinished,
  },
  {
    id: "cabinet-process-complete", number: "09", title: "The same kitchen, refreshed", label: "Finished kitchen",
    detail: "Generated concept; the result depends on your agreed project.",
    copy: "The existing layout stays in place as a new finish changes the kitchen’s character.",
    image: siteAssets.frontStoryFinished,
  },
] as const;

function interpolateProgress(nodes: HTMLElement[], viewportHeight: number) {
  const centres = nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  return kitchenChapterProgress(centres, viewportHeight / 2);
}

function chapterIndexFromHash(hash: string) {
  return stages.findIndex((stage) => `#${stage.id}` === hash);
}

function nearestChapter(nodes: (HTMLElement | null)[]) {
  return nodes.reduce((best, node, index) => {
    if (!node) return best;
    const bounds = node.getBoundingClientRect();
    const distance = Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2);
    return distance <= best.distance ? { index, distance } : best;
  }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
}

function alignChapterToViewport(chapter: HTMLElement) {
  const rect = chapter.getBoundingClientRect();
  const top = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
  window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
}

type CabinetCinematicStoryProps = {
  process: { title: string; introduction: string; confirmations: readonly string[] };
};

export function CabinetCinematicStory({ process }: CabinetCinematicStoryProps) {
  const rootRef = useRef<HTMLElement>(null);
  const chaptersRef = useRef<(HTMLElement | null)[]>([]);
  const pendingChapterRef = useRef<{ index: number; staticMode: boolean; focus: boolean } | null>(null);
  const staticReadingRef = useRef(0);
  const toolbarFocusedRef = useRef(false);
  const activeRef = useRef(0);
  const staticModeRef = useRef(false);
  const eligibleRef = useRef(false);
  const initialHashRestoredRef = useRef(false);
  const readyFrameRef = useRef(0);
  const [eligible, setEligible] = useState(false);
  const [staticMode, setStaticMode] = useState(false);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(0);
  const enhanced = eligible && !staticMode && !unavailable;

  useLayoutEffect(() => {
    const pending = pendingChapterRef.current;
    if (!pending || pending.staticMode !== staticMode) return;
    toolbarFocusedRef.current = false;
    const chapter = chaptersRef.current[pending.index];
    if (!chapter) return;
    alignChapterToViewport(chapter);
    const frame = requestAnimationFrame(() => {
      alignChapterToViewport(chapter);
      if (pending.focus) chapter.focus({ preventScroll: true });
      pendingChapterRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [staticMode, eligible, unavailable]);

  useLayoutEffect(() => {
    if (initialHashRestoredRef.current) return;
    initialHashRestoredRef.current = true;
    if (pendingChapterRef.current) return;
    const index = chapterIndexFromHash(window.location.hash);
    const chapter = chaptersRef.current[index];
    if (index < 0 || !chapter) return;
    activeRef.current = index;
    staticReadingRef.current = index;
    setActive(index);
    setProgress(Math.min(9, index + 0.5));
    alignChapterToViewport(chapter);
    const frame = requestAnimationFrame(() => alignChapterToViewport(chapter));
    return () => cancelAnimationFrame(frame);
  }, [enhanced]);

  useEffect(() => {
    let frame = 0;
    const align = (index: number) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const chapter = chaptersRef.current[index];
      if (!chapter) return;
      // Let the browser perform its native hash/history change first. We only
      // align the same target to the reading centre; scrolling never writes URL.
      frame = requestAnimationFrame(() => {
        frame = 0;
        alignChapterToViewport(chapter);
        activeRef.current = index;
        staticReadingRef.current = index;
        setActive(index);
        setProgress(Math.min(9, index + 0.5));
        chapter.focus({ preventScroll: true });
      });
    };
    const hashChange = () => align(chapterIndexFromHash(window.location.hash));
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search) return;
      // A second click on the current hash doesn't emit hashchange.
      align(chapterIndexFromHash(url.hash));
    };
    window.addEventListener("hashchange", hashChange);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("hashchange", hashChange);
      document.removeEventListener("click", click);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)");
    let initialized = false;
    const update = () => {
      const next = query.matches;
      const chapterVisible = chaptersRef.current.some((chapter) => {
        if (!chapter) return false;
        const rect = chapter.getBoundingClientRect();
        return rect.top <= window.innerHeight / 2 && rect.bottom >= window.innerHeight / 2;
      });
      if (initialized && next !== eligibleRef.current && chapterVisible) {
        // matchMedia fires after CSS has changed the chapter geometry. Keep the
        // step recorded in the previous layout instead of measuring that jump.
        const index = eligibleRef.current && !staticModeRef.current ? activeRef.current : staticReadingRef.current;
        pendingChapterRef.current = { index, staticMode: staticModeRef.current, focus: !!rootRef.current?.contains(document.activeElement) };
        staticReadingRef.current = index;
        activeRef.current = index;
        setActive(index);
        setProgress(Math.min(9, index + 0.5));
      }
      if (!initialized && next) {
        const index = chapterIndexFromHash(window.location.hash);
        if (index >= 0) pendingChapterRef.current = { index, staticMode: false, focus: false };
      }
      eligibleRef.current = next;
      setEligible(next);
      initialized = true;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!enhanced || !rootRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (!entry.isIntersecting) setReady(false);
    }, { rootMargin: "50% 0px" });
    observer.observe(rootRef.current);
    return () => { observer.disconnect(); setInView(false); setReady(false); };
  }, [enhanced]);

  useEffect(() => {
    if (!enhanced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = rootRef.current;
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      const nodes = chaptersRef.current.filter((node): node is HTMLElement => node !== null);
      if (nodes.length !== stages.length) return;
      const next = interpolateProgress(nodes, window.innerHeight);
      setProgress(next);
      const index = Math.min(9, Math.max(0, Math.floor(next)));
      activeRef.current = index;
      setActive(index);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enhanced]);

  useEffect(() => {
    if (enhanced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (toolbarFocusedRef.current) return;
      const target = window.innerHeight * 0.5;
      const visibleIndex = chaptersRef.current.findIndex((chapter) => {
        if (!chapter) return false;
        const rect = chapter.getBoundingClientRect();
        return rect.top <= target && rect.bottom >= target;
      });
      if (visibleIndex >= 0) staticReadingRef.current = visibleIndex;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enhanced]);

  useEffect(() => () => {
    if (readyFrameRef.current) cancelAnimationFrame(readyFrameRef.current);
    readyFrameRef.current = 0;
  }, [enhanced, inView]);

  const handleReady = useCallback(() => {
    if (readyFrameRef.current) cancelAnimationFrame(readyFrameRef.current);
    // The engine has rendered successfully. Keep the transparent canvas mounted
    // for a paint before switching both layers, so the transition can interpolate.
    readyFrameRef.current = requestAnimationFrame(() => {
      readyFrameRef.current = 0;
      setReady(true);
    });
  }, []);
  const handleUnavailable = useCallback(() => {
    const index = activeRef.current;
    const bounds = chaptersRef.current[index]?.getBoundingClientRect();
    // Preloading can fail while the introduction or preceding section is being
    // read. Only restore a chapter when it actually contains the reading point.
    const readingChapter = bounds && bounds.top <= window.innerHeight / 2 && bounds.bottom >= window.innerHeight / 2;
    pendingChapterRef.current = readingChapter ? { index, staticMode: true, focus: !!rootRef.current?.contains(document.activeElement) } : null;
    if (readyFrameRef.current) cancelAnimationFrame(readyFrameRef.current);
    readyFrameRef.current = 0;
    staticReadingRef.current = index;
    staticModeRef.current = true;
    setUnavailable(true);
    setReady(false);
    setStaticMode(true);
  }, []);
  const current = stages[active];
  const switchView = (nextStatic: boolean) => {
    const measuredIndex = nearestChapter(chaptersRef.current);
    const readingIndex = nextStatic ? measuredIndex : staticReadingRef.current;
    // The focused toolbar button may unmount without blur. Release its reading
    // lock explicitly so the next static visit can track a different chapter.
    toolbarFocusedRef.current = false;
    if (nextStatic) staticReadingRef.current = readingIndex;
    pendingChapterRef.current = { index: readingIndex, staticMode: nextStatic, focus: true };
    activeRef.current = readingIndex;
    staticModeRef.current = nextStatic;
    setActive(readingIndex);
    setProgress(Math.min(9, readingIndex + 0.5));
    setReady(false);
    setStaticMode(nextStatic);
  };

  const sceneReady = ready && enhanced && inView && !unavailable;

  return (
    <section id="cabinet-process" ref={rootRef} className="kcp-story" data-enhanced={enhanced} aria-labelledby="cabinet-process-title">
      <div className="kcp-wrap kcp-story-intro">
        <p className="kcp-kicker">The transformation / 01—09</p>
        <h2 id="cabinet-process-title">{process.title}</h2>
        <p>{process.introduction}</p>
        <div className="kcp-story-intro-actions">
          <a href="#cabinet-process-existing" className="kcp-link"><span>Explore the process</span> <ArrowDownRight size={16} aria-hidden="true" /></a>
          <a href="#cabinet-transformation" className="kcp-link"><span>Skip the story</span> <ArrowDown size={16} aria-hidden="true" /></a>
        </div>
        <p className="kcp-small">Illustrative process and generated imagery. The exact preparation and coating system is confirmed for your cabinets.</p>
      </div>
      {staticMode && eligible ? <div className="kcp-static-toolbar"><div className="kcp-wrap"><span>{unavailable ? "3D unavailable — static process view" : "Static process view"}</span>{!unavailable ? <button type="button" onFocus={() => { toolbarFocusedRef.current = true; }} onBlur={() => { toolbarFocusedRef.current = false; }} onPointerDown={() => { toolbarFocusedRef.current = true; }} onKeyDown={() => { toolbarFocusedRef.current = true; }} onClick={() => switchView(false)} className="kcp-link"><span>Return to 3D story</span> <ArrowUp size={16} aria-hidden="true" /></button> : null}</div></div> : null}
      <div className="kcp-story-stage" aria-hidden={!enhanced}>
        <div className="kcp-stage-visual">
          <Image src={current.image.src} alt="" width={current.image.width} height={current.image.height} sizes="(min-width: 1024px) 100vw, 1px" className={`kcp-stage-poster ${sceneReady ? "is-ready" : ""}`} />
          {enhanced && inView && !unavailable ? (
            <KitchenScene progress={progress} mode="story" className={`kcp-stage-canvas ${sceneReady ? "is-ready" : ""}`} onReady={handleReady} onUnavailable={handleUnavailable} />
          ) : null}
          <div className="kcp-stage-veil" />
        </div>
        <div className="kcp-stage-top kcp-wrap">
          <span>Kitchen Cabinet Painting</span>
          <span>Illustrative 3D concept</span>
        </div>
        <nav className="kcp-stage-nav kcp-wrap" aria-label="Cabinet painting process steps">
          <div className="kcp-stage-nav-current">
            <span>{current.number} / 09</span>
            <span>{current.title}</span>
          </div>
          <ol style={{ "--kcp-track": `${progress / 9 * 100}%` } as CSSProperties}>
            {stages.slice(0, 9).map((stage, index) => (
              <li key={stage.id}>
                <a href={`#${stage.id}`} aria-label={`Step ${stage.number}: ${stage.label}`} aria-current={Math.min(active, 8) === index ? "step" : undefined} title={stage.label}>
                  <span className="kcp-nav-tick" />
                </a>
              </li>
            ))}
          </ol>
          <div className="kcp-stage-nav-actions">
            <button type="button" onClick={() => switchView(true)}>Static view</button>
            <a href="#cabinet-transformation" className="kcp-link"><span>Skip</span> <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
        </nav>
      </div>
      <ol className="kcp-chapters">
        {stages.map((stage, index) => (
          <li key={stage.id}>
            <article id={stage.id} ref={(node) => { chaptersRef.current[index] = node; }} className="kcp-chapter" tabIndex={-1} aria-labelledby={`${stage.id}-title`}>
              <div className="kcp-wrap kcp-chapter-inner">
                <div className="kcp-chapter-copy">
                  <p className="kcp-chapter-count">{index === 9 ? "The reveal" : `${stage.number} / 09`} <span>{stage.label}</span></p>
                  <h3 id={`${stage.id}-title`}>{stage.title}</h3>
                  <p>{stage.copy}</p>
                  {index === 5 ? <ol className="kcp-layer-guide" aria-label="Illustrative coating layers"><li>Existing surface</li><li>Preparation</li><li>Compatible base</li><li>Finish coats</li></ol> : null}
                  <p className="kcp-chapter-detail"><span aria-hidden="true">—</span> {stage.detail}</p>
                </div>
                <figure className="kcp-chapter-figure">
                  <Image src={stage.image.src} alt={stage.image.alt} width={stage.image.width} height={stage.image.height} sizes="(min-width: 768px) 80vw, 100vw" loading="lazy" />
                  <figcaption>Generated process concept. Actual method and result depend on the assessed kitchen.</figcaption>
                </figure>
              </div>
            </article>
          </li>
        ))}
      </ol>
      <div className="kcp-story-outro kcp-wrap">
        <p>{process.confirmations.join(" ")}</p>
        {staticMode && eligible && !unavailable ? <button type="button" className="kcp-link" onClick={() => switchView(false)}><span>Return to animated story</span> <ArrowUp size={16} aria-hidden="true" /></button> : null}
      </div>
    </section>
  );
}
