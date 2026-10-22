import { useState, useEffect } from "react";

export type LayoutMode = "mobile" | "desktop";

export interface DeviceLayoutInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  isAndroidOrIos: boolean;
  layoutMode: LayoutMode;
  width: number;
  height: number;
}

/**
 * Responsive layout detection hook:
 * - Mobile Phone (< 768px): Uses Mobile layout (bottom nav, full-width touch cards, mobile terminal accessory bar).
 * - Tablet (>= 768px & < 1024px): Uses Desktop layout (Obsidian sidebar, multi-tab terminal, split panes).
 * - Desktop (>= 1024px): Uses Desktop layout.
 */
export function useDeviceLayout(): DeviceLayoutInfo {
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1280, height: 800 };
  });

  useEffect(() => {
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const width = windowSize.width;
  const height = windowSize.height;

  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;

  const isTouchDevice =
    typeof navigator !== "undefined" &&
    (navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  const isAndroidOrIos =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Tablets (>= 768px) share the exact desktop UI layout as requested
  const layoutMode: LayoutMode = isMobile ? "mobile" : "desktop";

  return {
    isMobile,
    isTablet,
    isDesktop,
    isTouchDevice,
    isAndroidOrIos,
    layoutMode,
    width,
    height,
  };
}
