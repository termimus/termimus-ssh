# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Termimus — a self-hosted SSH/server manager desktop app (Termius clone), built with **Tauri v2 + Rust backend + React frontend**. See `README.md` for the full feature list and user-facing docs.

## Stack & Layout

- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS v4, Zustand for state, `@xterm/xterm` for the terminal.
  - `src/components/<domain>/` — UI grouped by feature (hosts, terminal, sftp, tunnels, snippets, keychain, workspaces, vault, sync, settings, layout); shared primitives (`CustomSelect`, `ErrorBoundary`) live in `ui/`.
  - `src/stores/` — one Zustand store per domain (`use<Domain>Store.ts`, e.g. `useHostStore`, `useSessionStore`, `useAiStore`, `useSyncStore`, `useWorkspaceStore`). Check the folder for the current list before adding a new one.
  - `src/lib/api.ts` — the only place that calls `invoke(...)`; every Tauri command has a typed wrapper here. Add new commands here, not ad-hoc `invoke` calls in components.
  - `src/lib/format.ts` — shared formatting helpers (bytes, dates, paths). `src/lib/clipboard.ts` — clipboard helper (Tauri plugin first, `navigator.clipboard` fallback); use it instead of calling either API directly.
  - `src/i18n/` — `i18next` setup and translations in `locales/{en,id,zh}/<domain>.ts`. `en` defines the `TranslationSchema` type; `id` and `zh` must match it.
- **Backend**: Rust in `src-tauri/src/`.
  - `ssh/` — SSH session manager (`russh`), PTY streaming, host key verification (`SshClientHandler`), auth (password, key, SSH agent, keyboard-interactive 2FA), ProxyJump.
  - `sftp/` — SFTP manager (`russh-sftp`) + local filesystem helpers.
  - `tunnel/` — local (`-L`), remote (`-R`) and dynamic SOCKS5 (`-D`, `socks5.rs`) forwarding; `relay.rs` is the shared channel↔TCP relay.
  - `pty/` — local shell sessions (`PtyManager`).
  - `ai/` — AI Copilot: provider client, prompts, command risk classification, and `sanitizer.rs`, which redacts secrets before anything is sent to a provider.
  - `biometric/` — platform biometric unlock (`macos.rs` Touch ID, `windows.rs` Windows Hello, `unsupported.rs` fallback).
  - `sshkey/` — key pair generation, public key derivation, and key inspection (type, fingerprint).
  - `vault/` — AES-256-GCM encryption + Argon2id key derivation. Master password/derived key lives only in memory (`VaultManager`), never persisted.
  - `db/` — SQLite via `rusqlite`. `models.rs` has all row structs; `mod.rs` has the `Database` struct with one method per query. Schema lives in `init_tables()`.
  - `commands/mod.rs` — every `#[tauri::command]` handler, plus `AppState` (holds `Database`, `VaultManager`, `SessionManager`, `SftpManager`, `TunnelManager`, `PtyManager`, `AiClient`). Register every new command in `src-tauri/src/lib.rs`'s `generate_handler!` list too.
- **Sync server**: Go in `server/` (`cmd/`, `internal/{handlers,hub,db,…}`) — the self-hosted, zero-knowledge sync relay, shipped as the `ghcr.io/termimus/termimus-sync` Docker image. It only stores and relays encrypted snapshots; never make it read plaintext.

## Conventions

- **Client ↔ sync server compatibility**: users update the desktop app and their self-hosted relay separately, so a change on either side must keep working with the other side's previous release. Concretely:
  - New client + old server: the client must tolerate the old server's responses and behavior (e.g. #77 made the client split concatenated live-sync messages, so un-updated relays still work).
  - Old client + new server: the server must not require new fields or reject requests an older client still sends. Add fields as optional and ignore unknown ones; don't rename or remove existing endpoints, fields, or message types.
  - Sync/backup bundle formats: newer clients must read bundles written by older ones, and data this version can't handle is skipped, not fatal (e.g. unknown workspace layouts in #48).
  - If a breaking change is truly unavoidable, call it out under `Changed` in `CHANGELOG.md` with upgrade steps, and bump the minor version.

- **Every SSH-family connection (terminal, SFTP, tunnel) must go through `SshClientHandler`** with `db: Arc<Database>` passed in, so Trust-On-First-Use host key verification and MITM protection apply uniformly. Don't construct a bare `russh::client::connect` without it.
- **Credentials are never stored or transmitted as plaintext.** `Credential.ciphertext`/`nonce` are AES-256-GCM output; encrypt/decrypt only through `VaultManager`. The vault must be unlocked (`state.vault.is_unlocked()`) before touching secrets.
- **New Tauri commands**: add the `#[tauri::command]` fn in `commands/mod.rs`, add it to `generate_handler![...]` in `lib.rs`, then add a typed wrapper in `src/lib/api.ts`. All three steps are required or the command silently won't be callable from the frontend.
- **Tauri v2 Capabilities & Permissions**: plugins and window APIs require explicit entries in `src-tauri/capabilities/default.json`. Beware of plugins whose default capability is empty (e.g. `tauri-plugin-clipboard-manager` has `clipboard-manager:default` with `permissions = []` for security); always grant explicit permissions such as `"clipboard-manager:allow-read-text"` and `"clipboard-manager:allow-write-text"`.
- **Clipboard & Terminal I/O**: WebKitGTK / Tauri on Linux blocks `navigator.clipboard.readText()` when pasting from external applications without explicit per-origin browser permission. Always use `@tauri-apps/plugin-clipboard-manager` (`readText`/`writeText`) as the primary path and fallback to `navigator.clipboard`. In `XtermView.tsx`, use debounce guards (~350ms window with content tracking) to prevent double-paste across keyboard shortcuts and native DOM paste events.
- **Terminal Lifecycle & Pooling**: instances are cached in `terminalPool` (`XtermView.tsx`) to survive tab switches, splits, and layout changes without reconnecting SSH. Initialize `isConnected` synchronously from the pool entry (never in a delayed effect) to prevent flashing the `ConnectionProgress` overlay during split remounts.
- **Zustand Performance**: always use `useShallow` from `zustand/react/shallow` when subscribing to non-primitive selectors (arrays, objects) in stores (`useSessionStore`, `usePingStore`, etc.) to prevent cascading re-renders across the component tree.
- **SSH PTY Streaming**: backend coalesces PTY chunks in `ssh/mod.rs` (~8ms batches / 64KB cap) before emitting `ssh-data-${sessionId}` events to minimize IPC overhead.
- **New DB tables**: add the `CREATE TABLE IF NOT EXISTS` to `init_tables()` in `db/mod.rs`, add the row struct to `models.rs`, add CRUD methods to `Database`. If the table should be portable, also wire it into `BackupBundle`/`export_backup_bundle`/`import_backup_bundle`.
- **Terminal visibility**: never hide the terminal container with `display: none`. Use `visibility: hidden` + `pointerEvents: none` (see `App.tsx`, `XtermView.tsx`) — `display: none` collapses the container to 0×0, which makes `ResizeObserver`/`FitAddon` compute a bogus tiny size and corrupts remote curses apps (htop, vim) via a bad SIGWINCH. Any resize call must guard against near-zero `cols`/`rows` (frontend guards in `XtermView.tsx`, backend guard in `ssh/mod.rs`'s resize handler).
- **Styling**: Tailwind v4 utility classes with CSS variables defined in `src/index.css` (`--canvas`, `--surface-*`, `--primary`, `--text-*`, etc. — the "Terminal Obsidian" palette). Reuse these variables; don't hardcode hex colors in components.
- **Fonts**: Inter for UI text, JetBrains Mono/Fira Code for anything monospace (IPs, ports, commands, code). Bundled offline via `@fontsource/*` imports in `src/index.css` (plus Nerd Font symbol files) — the app must work offline and the CSP is strict, so don't add CDN/Google Fonts links.
- **i18n**: no hardcoded user-facing strings in components — use `useTranslation()` / `t(...)` and add the key to all three locales (`en`, `id`, `zh`). `bun run build` fails if `id`/`zh` are missing keys from `en`.
- **AI Copilot**: any terminal output or error text sent to a provider must go through `ai/sanitizer.rs` first. Generated commands are only typed into the terminal, never executed automatically, and are never broadcast to other panes; risky commands go through the risk confirmation.
- Window is frameless (`decorations: false`); the custom titlebar/window controls live in `src/components/layout/Header.tsx` — don't reintroduce native window chrome.
- **Version Bump Checklist**: when bumping the app version, update all 6 files simultaneously:
  1. `package.json` (`version`)
  2. `src-tauri/tauri.conf.json` (`version`)
  3. `src-tauri/Cargo.toml` (`version`)
  4. `src/stores/useUpdateStore.ts` (`currentVersion`)
  5. `README.md` (header subtitle `·  vX.Y.Z`, badge URL, and the Downloads table rows)
  6. `server/internal/handlers/handlers.go` (`version` field in the `/health` response)
  Then run `cargo check` in `src-tauri` so `src-tauri/Cargo.lock` reflects the new package version.
  Also release `CHANGELOG.md` in the same commit (see Changelog below).

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). It is written for users, not developers.

- **Every PR with a user-visible change** (feature, behavior change, bug fix, security fix) adds an entry under `## [Unreleased]` in the same PR. Skip it for pure refactors, CI, docs, and internal changes nobody using the app would notice.
- **Categories**, in this order, only the ones that have entries: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- **Entry style**: `- **Short name** — what changed for the user, in 1–3 sentences. (#PR, closes #issue)`. Describe the effect, not the implementation: no function names, Tauri commands, crate internals, or file paths (those belong in the PR description). Setting names and shortcuts are fine.
- One entry per user-visible change. If a follow-up PR changes something still in `[Unreleased]`, edit that entry instead of adding a new one.
- **On release** (part of the version bump):
  1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it.
  2. Update the compare links at the bottom: `[Unreleased]` → `compare/vX.Y.Z...HEAD`, and add `[X.Y.Z]: .../compare/vPREV...vX.Y.Z`.
  3. Condense the *previous* release to a flat list of 3–7 highlight bullets (no category headings) and add a `[Full release notes](.../releases/tag/vPREV)` link. Only the latest release keeps full categories.
- **Archiving**: when the file gets long (e.g. at 1.0), move a whole finished series (e.g. all `0.x`) into `docs/changelog/0.x.md` and leave a link to it in `CHANGELOG.md`.

## Verification

- Frontend: `bun run build` (runs `tsc` + `vite build`) — must pass with zero TypeScript errors before considering a frontend change done.
- Backend: `cd src-tauri && cargo check` — must compile clean (treat new warnings as things to fix, not ignore). CI also runs `cargo test --all-targets` and `cargo clippy --all-targets`.
- Sync server (when `server/` changes): `cd server && go test ./...`.
- Tests: Rust unit tests live in `#[cfg(test)]` modules in the same file (e.g. `ai/`, `db/`, `tunnel/relay.rs`, `sshkey/`); Go tests next to the code (`server/internal/hub/hub_test.go`). There are no frontend tests. Add unit tests for non-trivial backend logic (crypto, parsing, protocol relays, DB migrations/import). UI changes are verified manually via `bun run tauri dev`.
- Full production build: `bun run tauri build --bundles deb` (Linux). Slow (multi-minute Rust compile) — don't run it for routine changes, only when explicitly asked to produce a release artifact.

## Git

- Commit only when asked. Stage specific files, not `git add .`, when unrelated changes are present in the working tree (this repo occasionally has loose reference/design files at the root — don't sweep those into unrelated commits).
- Attribution lines for commits/PRs are specified by the harness system reminder, not this file.
