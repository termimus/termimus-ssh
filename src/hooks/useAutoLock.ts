import { useEffect, useRef } from "react";
import { useVaultStore } from "../stores/useVaultStore";
import { useSettingsStore, AutoLockPolicy } from "../stores/useSettingsStore";

const IDLE_TIMEOUTS: Partial<Record<AutoLockPolicy, number>> = {
  "15min": 15 * 60 * 1000,
  "1hour": 60 * 60 * 1000,
};

export function useAutoLock() {
  const { isUnlocked, autoLock } = useVaultStore();
  const { autoLockPolicy } = useSettingsStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. Idle detection timer (15min / 1hour) ──────────────────────────────
  useEffect(() => {
    if (!isUnlocked) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const timeoutMs = IDLE_TIMEOUTS[autoLockPolicy];
    if (!timeoutMs) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        autoLock();
      }, timeoutMs);
    }

    // Reset on any user input.
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [isUnlocked, autoLockPolicy, autoLock]);

  // ── 2. On focus loss policy ──────────────────────────────────────────────
  useEffect(() => {
    if (!isUnlocked || autoLockPolicy !== "on_focus_loss") return;

    function handleBlur() {
      autoLock();
    }

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isUnlocked, autoLockPolicy, autoLock]);

  // ── 3. On close / unload policy ──────────────────────────────────────────
  useEffect(() => {
    if (autoLockPolicy === "never") return;

    function handleUnload() {
      // Lock the in-memory vault when the tab/window is closing.
      // Note: sync call to navigator.sendBeacon isn't needed since
      // Rust backend locks on process exit anyway, but this ensures
      // in-memory state is zeroized before drop.
      useVaultStore.getState().autoLock();
    }

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [autoLockPolicy]);
}
