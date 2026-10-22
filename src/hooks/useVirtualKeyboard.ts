import { useState, useEffect } from "react";

/**
 * Detects when the software (virtual) keyboard is visible on a touch device.
 *
 * Uses the Visual Viewport API (supported on Android Chrome & iOS 16+):
 * - When the soft keyboard opens, the visual viewport height shrinks
 *   significantly compared to the layout viewport height.
 * - A threshold of 100px distinguishes keyboard from browser chrome changes.
 *
 * Falls back to window resize heuristic on older devices.
 */
export function useVirtualKeyboard(): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only run on touch devices
    if (typeof navigator === "undefined" || navigator.maxTouchPoints === 0) return;

    // Primary: Visual Viewport API (most reliable)
    if (window.visualViewport) {
      const viewport = window.visualViewport;

      const handleViewportResize = () => {
        // If visual viewport is significantly smaller than layout viewport,
        // the soft keyboard is most likely open.
        const threshold = 100;
        const keyboardVisible =
          window.innerHeight - viewport.height > threshold;
        setIsVisible(keyboardVisible);
      };

      viewport.addEventListener("resize", handleViewportResize);
      viewport.addEventListener("scroll", handleViewportResize);

      // Check initial state
      handleViewportResize();

      return () => {
        viewport.removeEventListener("resize", handleViewportResize);
        viewport.removeEventListener("scroll", handleViewportResize);
      };
    }

    // Fallback: window resize heuristic
    const initialHeight = window.innerHeight;

    const handleResize = () => {
      const currentHeight = window.innerHeight;
      setIsVisible(initialHeight - currentHeight > 100);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isVisible;
}
