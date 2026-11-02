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
    let maxSeenHeight = Math.max(
      window.innerHeight,
      window.visualViewport ? window.visualViewport.height : 0
    );

    const checkKeyboard = (currentHeight: number, vHeight?: number) => {
      if (currentHeight > maxSeenHeight) {
        maxSeenHeight = currentHeight;
      }
      if (vHeight && vHeight > maxSeenHeight) {
        maxSeenHeight = vHeight;
      }

      // 1. Check if visual viewport shrunk compared to layout viewport (overlap mode)
      if (vHeight !== undefined && window.innerHeight - vHeight > 100) {
        return true;
      }

      // 2. Check if current visible height shrunk compared to max seen height (resize mode)
      const testHeight = vHeight !== undefined ? vHeight : currentHeight;
      if (maxSeenHeight - testHeight > 120) {
        return true;
      }

      return false;
    };

    // Primary: Visual Viewport API (most reliable)
    if (window.visualViewport) {
      const viewport = window.visualViewport;

      const handleViewportResize = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const keyboardVisible = checkKeyboard(window.innerHeight, viewport.height);
          setIsVisible(keyboardVisible);
        }, 50);
      };

      viewport.addEventListener("resize", handleViewportResize);
      viewport.addEventListener("scroll", handleViewportResize);

      // Check initial state immediately
      setIsVisible(checkKeyboard(window.innerHeight, viewport.height));

      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        viewport.removeEventListener("resize", handleViewportResize);
        viewport.removeEventListener("scroll", handleViewportResize);
      };
    }

    // Fallback: window resize heuristic
    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const keyboardVisible = checkKeyboard(window.innerHeight);
        setIsVisible(keyboardVisible);
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
