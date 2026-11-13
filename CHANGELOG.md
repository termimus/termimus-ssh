# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Windows Hello biometric unlock** — the vault can now be unlocked with
  Windows Hello (fingerprint, face, or PIN) via the WinRT
  `UserConsentVerifier` API. Previously biometric unlock was macOS-only
  (Touch ID); on Windows the setting reported no biometric sensor. Note:
  `UserConsentVerifier::RequestVerificationAsync` is the UWP path — on an
  unpackaged desktop build the prompt may need the
  `IUserConsentVerifierInterop` window-handle path instead (see
  `src-tauri/src/biometric/windows.rs`).
- **SSH agent authentication** — hosts can now authenticate with a key held
  by the local SSH agent instead of a stored password or imported private
  key. The agent is reached over `SSH_AUTH_SOCK` on Unix and the OpenSSH
  agent named pipe (`\\.\pipe\openssh-ssh-agent`) on Windows, which is what
  Bitwarden Desktop exposes — so Bitwarden SSH keys work without copying
  private key material into Termimus. The agent is tried identity by
  identity until the server accepts one, with the same RSA hash negotiation
  and keyboard-interactive fallback as private-key auth.
