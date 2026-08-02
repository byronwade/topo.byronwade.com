"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const revealSelectors = [
  ".evidence-row",
  ".section-intro",
  ".thesis-copy",
  ".legend-row",
  ".process-track article",
  ".state-lede",
  ".ledger-group",
  ".llm-grid > *",
  ".final-cta > *",
  ".page-hero > *",
  ".docs-group",
  ".docs-sidebar",
  ".doc-content",
  ".doc-margin",
  ".plan",
  ".pricing-note > *",
  ".install-heading",
  ".install-steps article",
  ".after-install > *",
  ".source-boundary > *",
  ".footer-grid > *",
].join(",");

export function MotionOrchestrator() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.remove("motion-ready");
      return;
    }

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(revealSelectors),
    );
    const siblingIndexes = new Map<Element, number>();

    for (const element of elements) {
      const parent = element.parentElement ?? document.body;
      const index = siblingIndexes.get(parent) ?? 0;
      siblingIndexes.set(parent, index + 1);
      element.classList.add("reveal-target");
      element.style.setProperty(
        "--reveal-delay",
        `${Math.min(index * 70, 280)}ms`,
      );
    }

    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8%", threshold: 0.08 },
    );

    const frame = window.requestAnimationFrame(() => {
      for (const element of elements) observer.observe(element);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
