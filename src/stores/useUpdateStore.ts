import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";

interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes: string | null;
  isChecking: boolean;
  lastChecked: number | null;
  error: string | null;
  init: () => Promise<void>;
  checkForUpdates: (manual?: boolean) => Promise<boolean>;
}

function parseSemver(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

export function isNewerVersion(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lPart = l[i] ?? 0;
    const cPart = c[i] ?? 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  currentVersion: "0.7.0",
  latestVersion: null,
  hasUpdate: false,
  releaseUrl: "https://github.com/termimus/termimus-ssh/releases",
  releaseNotes: null,
  isChecking: false,
  lastChecked: null,
  error: null,

  init: async () => {
    try {
      const ver = await getVersion();
      if (ver) {
        set({ currentVersion: ver });
      }
    } catch {
      // Running outside Tauri or preview; keep default 0.4.4
    }

    // Auto-check on launch (fire & forget)
    get().checkForUpdates(false);
  },

  checkForUpdates: async (manual = false) => {
    // Prevent spamming check within 5 minutes unless manual
    const { lastChecked, isChecking, currentVersion } = get();
    const now = Date.now();
    if (!manual && lastChecked && now - lastChecked < 5 * 60 * 1000) {
      return get().hasUpdate;
    }

    if (isChecking) return get().hasUpdate;

    set({ isChecking: true, error: null });

    try {
      let latestTag: string | null = null;
      let targetUrl = "https://github.com/termimus/termimus-ssh/releases";
      let notes: string | null = null;

      // 1. Try GitHub Releases API first
      try {
        const releaseRes = await fetch(
          "https://api.github.com/repos/termimus/termimus-ssh/releases/latest",
          { headers: { Accept: "application/vnd.github.v3+json" } }
        );
        if (releaseRes.ok) {
          const data = await releaseRes.json();
          if (data && data.tag_name) {
            latestTag = data.tag_name;
            targetUrl = data.html_url || targetUrl;
            notes = data.body || null;
          }
        }
      } catch {
        // Ignore and fallback to tags
      }

      // 2. If no release found, fallback to GitHub Tags API
      if (!latestTag) {
        const tagsRes = await fetch(
          "https://api.github.com/repos/termimus/termimus-ssh/tags",
          { headers: { Accept: "application/vnd.github.v3+json" } }
        );
        if (tagsRes.ok) {
          const tags = await tagsRes.json();
          if (Array.isArray(tags) && tags.length > 0 && tags[0]?.name) {
            latestTag = tags[0].name;
          }
        }
      }

      if (!latestTag) {
        set({
          isChecking: false,
          lastChecked: now,
          error: "Could not retrieve latest version information.",
        });
        return false;
      }

      const cleanLatest = latestTag.replace(/^v/, "");
      const cleanCurrent = currentVersion.replace(/^v/, "");
      const hasUpdate = isNewerVersion(cleanLatest, cleanCurrent);

      set({
        latestVersion: cleanLatest,
        hasUpdate,
        releaseUrl: targetUrl,
        releaseNotes: notes,
        isChecking: false,
        lastChecked: now,
        error: null,
      });

      return hasUpdate;
    } catch (err) {
      console.warn("Update check failed:", err);
      set({
        isChecking: false,
        lastChecked: now,
        error: "Failed to connect to update server.",
      });
      return false;
    }
  },
}));
