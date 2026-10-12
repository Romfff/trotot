"use client";

import React, { useEffect, useRef, useState } from "react";

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
  threshold?: number;
  rootMargin?: string;
}

/**
 * Hardware-accelerated scroll lazy-reveal wrapper.
 * Elements stay lightweight and smoothly glide into place when scrolled into the viewport.
 */
export function ScrollReveal({
  children,
  className = "",
  delayMs = 0,
  threshold = 0.08,
  rootMargin = "0px 0px -32px 0px",
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return (
    <div
      ref={ref}
      className={`scroll-reveal-item ${visible ? "is-visible" : ""} ${className}`}
      style={delayMs > 0 ? ({ "--sr-delay": `${delayMs}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Progressive scroll lazy-loader hook for lists of cards.
 * Reveals `batchSize` items initially and automatically appends more batches as the user scrolls down.
 */
export function useProgressiveScroll<T>(items: T[], batchSize = 6) {
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [items, batchSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + batchSize, items.length));
        }
      },
      { rootMargin: "260px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, items.length, batchSize]);

  return {
    visibleItems: items.slice(0, visibleCount),
    hasMoreToReveal: visibleCount < items.length,
    sentinelRef,
  };
}
