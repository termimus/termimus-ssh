# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **SSH agent authentication** — hosts can now authenticate with a key held
  by the local SSH agent instead of a stored password or imported private
  key. The agent is reached over `SSH_AUTH_SOCK` on Unix and the OpenSSH
  agent named pipe (`\\.\pipe\openssh-ssh-agent`) on Windows, which is what
  Bitwarden Desktop exposes — so Bitwarden SSH keys work without copying
  private key material into Termimus. The agent is tried identity by
  identity until the server accepts one, with the same RSA hash negotiation
  and keyboard-interactive fallback as private-key auth. Agent error
  messages name the agent endpoint, so a wrong or empty agent is obvious.
- **Windows Hello biometric unlock** — the vault can now be unlocked with
  Windows Hello (fingerprint, face, or PIN) via the WinRT
  `UserConsentVerifier` API, under neutral 'Biometrics' labels. Previously
  biometric unlock was macOS-only (Touch ID); on Windows the setting
  reported no biometric sensor. Availability is checked with
  `vault_biometric_supported` (which runs `is_supported()` off the UI
  thread) before the setting is offered.
- **Terminal-set (OSC) titles** — the title a program sets (OSC 0/2) is now
  surfaced in the UI: it shows as muted secondary text in the pane header
  (next to the host label) and in full in the tab hover tooltip, so live
  status such as a capture count stays visible. Tabs keep the host name by
  default — most shells set a title on every prompt, so using it as the tab
  name would make tabs read alike and change on every `cd`. A new toggle in
  Settings → Terminal ("Use terminal-set title as tab name", off by default)
  restores the PuTTY-style behaviour of showing the program title on the tab.
- **Select to copy, right-click to paste (terminal)** — a new toggle in
  Settings → Terminal (off by default) makes selecting text copy it to the
  clipboard automatically and right-clicking paste the clipboard straight
  into the terminal. When off, behavior is unchanged: right-click opens the
  context menu and selection does not copy.
