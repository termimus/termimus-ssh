/**
 * Parse one live-sync WebSocket message into its JSON events.
 *
 * Current servers send exactly one JSON object per message, but sync relays
 * before #63 concatenated queued events into a single frame
 * (`{...}{...}`). Self-hosted servers may lag behind the app, so split such
 * frames into their top-level objects instead of failing the whole message.
 * Fragments that are not valid JSON are skipped.
 */
export function parseSyncEvents(raw: string): unknown[] {
  try {
    return [JSON.parse(raw)];
  } catch {
    // Fall through to splitting concatenated objects.
  }

  const events: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          events.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // Skip malformed fragment.
        }
        start = -1;
      }
    }
  }
  return events;
}
