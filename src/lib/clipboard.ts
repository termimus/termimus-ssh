import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Copies text to the system clipboard. The Tauri clipboard plugin is the
 * primary path because WebKitGTK on Linux can block `navigator.clipboard`;
 * the web API is only a fallback (e.g. when running outside Tauri).
 */
export async function copyText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}
