# Changelog

All notable changes to Termimus (desktop app and self-hosted sync server) are
documented in this file. Full release notes, including contributor credits,
are on [GitHub Releases](https://github.com/termimus/termimus-ssh/releases).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **SSH agent authentication** — hosts can authenticate with a key held by
  the local SSH agent (`SSH_AUTH_SOCK` on Unix, the OpenSSH agent pipe on
  Windows) instead of a stored password or imported private key. This makes
  Bitwarden Desktop SSH keys work without copying private keys into
  Termimus. Agent errors name the agent endpoint, so a wrong or empty agent
  is easy to spot. (#78)
- **Windows Hello unlock** — the vault can be unlocked with fingerprint,
  face, or PIN on Windows. Previously biometric unlock was macOS-only
  (Touch ID). (#79)
- **Copilot follow-up questions** — a "Follow up" action on Copilot answers
  sends the next question with that answer as context, so questions like
  "and without sudo?" work. Only the earlier prompt and answer are sent,
  never the earlier terminal output. (#83)
- **Terminal-set (OSC) titles** — the title a program sets is shown next to
  the host label in the pane header and in the tab tooltip. A new toggle in
  Settings → Terminal ("Use terminal-set title as tab name", off by default)
  shows it on the tab instead of the host name. (#69)
- **Select to copy, right-click to paste** — a new toggle in Settings →
  Terminal (off by default) copies selected text automatically and pastes
  on right-click. (#58)
- **Keychain key generation** — generate Ed25519, RSA, or ECDSA P-256 key
  pairs from the credential modal. Key cards show key type and fingerprint,
  and identity cards get a "Copy username" action. (#52)
- **Snippet tag filter** — filter snippets by tag, with per-tag counts. (#53)
- **Error boundaries** — a crash in one view now shows a recoverable error
  screen instead of blanking the whole window. (#47)

### Changed

- **Copilot history is per host** — each saved host keeps its own history,
  and a running request on one host no longer blocks others. Explain answers
  render as Markdown with selectable text and Copy / Insert / Run buttons
  per code block; Run goes through the same risk confirmation as generated
  commands. (#81)
- **Keychain, Snippets, Tunnels, and Workspaces pages** share one header,
  search, and card layout. Tunnels can be searched by name, host, or port;
  workspace cards show per-pane online status and missing hosts. (#50, #52,
  #53, #54)
- **Safer deletes** — deleting a credential or host warns when hosts or
  workspace presets still use it. (#47, #52)

### Fixed

- **Old SSH servers** — routers, switches, and Dropbear/vendor servers that
  only offer older key exchange, AES-CBC, or SHA-1 MACs no longer fail with
  "No common Kex algorithm". Modern servers negotiate exactly as before.
  (#74, closes #32)
- **Tunnels: Stop** now closes active forwarded connections, not just the
  listener. (#75, closes #60)
- **Tunnels: half-close** — a target that sends a reply and half-closes the
  connection now still receives the client's follow-up data. (#76,
  closes #61)
- **Tunnels: busy state** — starting or stopping one tunnel no longer shows
  a spinner on the wrong card; tunnels whose host was deleted can't be
  started. (#54)
- **Live sync** — bursts of sync events from the relay no longer get
  silently dropped. Older self-hosted relays keep working. (#77, closes #63)
- **Vault import and sync** — credentials from a backup or sync bundle of a
  different vault are skipped instead of imported as unreadable data. A
  device with an outdated vault stops pushing and offers to restore from the
  server copy. (#66, #73, closes #62)
- **Backup "Replace All" import** is now all-or-nothing: a failed import
  leaves existing data untouched, and a safety snapshot is always written
  first. (#65, closes #59)
- **Workspaces** — launching a preset no longer mounts one session in two
  panes, saving a split no longer substitutes the wrong host for local or
  deleted panes, and presets with unsupported layouts are skipped on import.
  (#46, #48)
- **Connection progress overlay** is usable in small split panes, and its
  Close button only closes that pane's session. (#49)

## [0.9.0] - 2026-11-12

### Added

- **AI Terminal Copilot (bring your own key)** — OpenAI-compatible, Anthropic,
  or local Ollama providers. Turn natural language into shell commands
  (`Alt+I` / `⌘I` panel or inline `# prompt`), and explain errors from
  terminal output. Commands are never auto-executed, risky commands need
  confirmation, and secrets are redacted before leaving your machine. API
  keys are stored in the vault. (#38, #43)
- **Keyboard-interactive 2FA** — servers requiring
  `publickey,keyboard-interactive` (e.g. PAM + Google Authenticator) now work
  for terminal, SFTP, and tunnels. (#40, closes #39)
- **Remote port forwarding (`-R`)**. (#44)
- **Dynamic SOCKS5 forwarding (`-D`)** with IPv4, IPv6, and remote DNS
  resolution. (#34, closes #31)
- **Cloud-to-cloud SFTP transfers** — the left pane can be any saved host,
  and files can be transferred directly between two servers. (#36)
- **Simplified Chinese (`zh`)** UI language. (#35, closes #25)

### Changed

- New tunnel setup flow with a Local / Remote / Dynamic type picker and a
  searchable host selector. (#34, #44)
- Login failures say which step was rejected (key, password, or 2FA code).
  (#40)

### Fixed

- Tunnels stop and report "connection lost" when the SSH connection drops,
  instead of appearing active. (#44)
- A failed SFTP connect resets the pane, and stale failures no longer
  override a newer connection. (#42)
- A timed-out 2FA prompt no longer drops the next queued prompt. (#42)

### Security

- Updated russh 0.50 → 0.65 (22 advisories, including pre-auth DoS),
  rusqlite (bundled SQLite CVE), rustls, tokio, and vite. (#41)
- Terminal and SFTP sessions reject server-opened forwarded channels. (#44)

## [0.8.0] - 2026-10-31

- **Internationalization** — full English and Bahasa Indonesia UI, with a
  language switcher in Settings → General. (#28)
- **App lock screen** — lock the app from the header padlock. (#21, #26)
- **Offline Nerd Font / Powerline symbols** for p10k, starship, and similar
  prompts. (#27, #29)
- **SFTP polish** — searchable host select, duplicate-file conflict dialog,
  and byte-based transfer progress. (#22)
- **Split and duplicate for local terminal sessions**. (#30)
- **Security hardening** — SFTP download path traversal protection, TOFU
  fails closed, sync secrets in the OS keyring, strict CSP, local shells
  limited to `/etc/shells`, and the sync server requires an auth token by
  default. (#24)
- Closing a tab aborts its in-flight SSH connect and cleans up jump hosts.
  (#20)

[Full release notes](https://github.com/termimus/termimus-ssh/releases/tag/v0.8.0)

## [0.7.0] - 2026-10-09

- **SFTP multi-select and recursive bulk transfers**, inline filter, and
  virtualized lists for very large directories. (#19)
- **SSH keepalives** at TCP and protocol level, so idle sessions and tunnels
  behind NAT or firewalls no longer freeze or drop. (#18)
- **Persistent Home tab** (`Alt+H`) and distraction-free terminal layout.
- Instant tab switching — terminal tabs stay mounted in the background.

[Full release notes](https://github.com/termimus/termimus-ssh/releases/tag/v0.7.0)

## [0.6.2] - 2026-10-02

- Fixed dropdowns being clipped inside scrollable lists.
- Fixed the sync Server URL field making `http://` impossible to type.

[Full release notes](https://github.com/termimus/termimus-ssh/releases/tag/v0.6.2)

## [0.6.1] - 2026-10-02

- Fixed sync to plain-HTTP relays (e.g. LAN IPs) failing with
  `TypeError: Load failed` on Linux; relay requests now go through the Rust
  backend.
- Sync status badge shows accurate states (Ready, Syncing, Connected,
  Connection error) and checks the relay when the tab opens.

[Full release notes](https://github.com/termimus/termimus-ssh/releases/tag/v0.6.1)

## [0.6.0] - 2026-10-02

- **Local terminal (PTY)** — run local shells alongside SSH sessions, with
  split panes, broadcast, and snippets. (#13)
- **Touch ID vault unlock** on macOS. (#11)
- **Terminal themes**, font controls, and keyword highlighting; fonts are
  bundled offline. (#5)
- **Workspace presets stored in SQLite**, included in backups and sync. (#4)
- Vault usability: cancellable unlock prompt, silent manual lock, and an
  unlock prompt when connecting while locked. (#14)
- Sync: last-write-wins for folders and debounced auto-push. (#7)
- macOS fullscreen and `F11` / `Cmd+Ctrl+F` shortcuts. (#9)

[Full release notes](https://github.com/termimus/termimus-ssh/releases/tag/v0.6.0)

## Pre-releases (0.1.0 – 0.5.1)

Early development builds, summarized. See
[GitHub Releases](https://github.com/termimus/termimus-ssh/releases) for
details.

- **0.5.1** (2026-09-30) — SSH ProxyJump / bastion hosts, terminal search
  (`Ctrl+F`), redesigned tab bar with middle-click close, compact host list
  view, duplicate host, Linux distro auto-detection, throttled background
  ping.
- **0.4.7** (2026-09-30) — lower typing latency (`TCP_NODELAY`, zero-delay
  echo with burst coalescing).
- **0.4.6** (2026-09-30) — fixed splitting a new session into an existing
  split layout; workspace name shown on the tab.
- **0.4.5** (2026-09-30) — fixed pasting from other apps on Linux;
  responsive header tab row.
- **0.4.4** (2026-09-29) — fewer terminal re-renders, batched SSH output,
  fixed pane-switch flash.
- **0.4.3** (2026-09-28) — update checker, redesigned connection progress
  overlay, SSH connect reliability fixes.
- **0.4.2** (2026-09-28) — snippet sidebar and sync, terminal shortcuts,
  context menus across the app.
- **0.3.0** (2026-09-28) — self-hosted sync overhaul: restore from sync,
  deletion sync, live sync heartbeat, enforced E2EE, atomic master password
  change.
- **0.2.1** (2026-09-24) — multi-server workspaces with split layout
  presets, input broadcast, tab reordering.
- **0.1.0 / 0.1.1** (2026-09-23) — initial release: SSH terminal, SFTP,
  encrypted keychain, port forwarding, snippets, optional self-hosted sync.

[Unreleased]: https://github.com/termimus/termimus-ssh/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/termimus/termimus-ssh/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/termimus/termimus-ssh/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/termimus/termimus-ssh/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/termimus/termimus-ssh/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/termimus/termimus-ssh/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/termimus/termimus-ssh/compare/v0.5.1...v0.6.0
