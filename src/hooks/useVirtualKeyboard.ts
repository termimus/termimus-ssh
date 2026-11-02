import { useState, useEffect } from "react";

/**
 * Detects when the software (virtual) keyboard is visible on a touch device.
 *
 * Uses the Visual Viewport API (supported on Android Chrome & iOS 16+):
 * - When the soft keyboard opens, the visual viewport height shrinks
 *   significantly compared to the layout viewport height.
 * - A threshold of 100px distinguishes keyboard from browser chrome changes.
 * - Debounces rapid resize updates to prevent terminal layout jitter during keyboard transitions.
 *
 * Falls back to window resize heuristic on older devices.
 */
export function useVirtualKeyboard(): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only run on touch devices
    if (typeof navigator === "undefined" || navigator.maxTouchPoints === 0) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Primary: Visual Viewport API (most reliable)
    if (window.visualViewport) {
      const viewport = window.visualViewport;

      const handleViewportResize = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // If visual viewport is significantly smaller than layout viewport,
          // the soft keyboard is most likely open.
          const threshold = 100;
          const keyboardVisible =
            window.innerHeight - viewport.height > threshold;
          setIsVisible(keyboardVisible);
        }, 50);
      };

      viewport.addEventListener("resize", handleViewportResize);
      viewport.addEventListener("scroll", handleViewportResize);

      // Check initial state immediately
      const threshold = 100;
      setIsVisible(window.innerHeight - viewport.height > threshold);

      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        viewport.removeEventListener("resize", handleViewportResize);
        viewport.removeEventListener("scroll", handleViewportResize);
      };
    }

    // Fallback: window resize heuristic
    const initialHeight = window.innerHeight;

    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const currentHeight = window.innerHeight;
        setIsVisible(initialHeight - currentHeight > 100);
      }, 50);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return isVisible;
}
