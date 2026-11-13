# Contributing to Termimus

Thank you for your interest in contributing to **Termimus**! This document outlines the guidelines and workflow to ensure a smooth, secure, and productive contribution process.

---

## 1. Contribution Workflow

### A. New Features / Major Changes (Database, Architecture)
1. **Open an Issue First** using the *Feature Request* template.
2. Discuss the technical approach with the maintainer before writing code.
3. Once approved, request to be assigned to the issue to avoid duplicate efforts or conflicting database migrations.
4. Create a feature branch from `main`, implement your changes, and open a Pull Request.

### B. Bug Fixes
1. If the bug has not been reported yet, please open an issue using the *Bug Report* template.
2. For small, self-contained bug fixes (< 50 lines), you may submit a PR directly with a clear description of the problem and the fix.

---

## 2. Architecture & Code Conventions

### Tech Stack Overview
- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS v4, Zustand for state management, `@xterm/xterm` for the terminal.
- **Backend**: Tauri v2 + Rust (`russh`, `russh-sftp`, `rusqlite`, AES-256-GCM + Argon2id for the Vault).

### Core Rules
1. **Credential Security**:
   - Passwords, private keys, and passphrases must **never** be stored or transmitted as plaintext.
   - All encryption and decryption must go through `VaultManager` and require `is_unlocked()` verification.
2. **SSH Connection Handling**:
   - Every SSH-family connection (Terminal, SFTP, Port Forwarding) **must** route through `SshClientHandler` with `db: Arc<Database>` to enforce Trust-On-First-Use (TOFU) host key verification and MITM protection.
3. **IPC / Tauri Commands**:
   - Command handlers belong in `src-tauri/src/commands/mod.rs`.
   - Register new handlers in `generate_handler![...]` inside `src-tauri/src/lib.rs`.
   - Add typed TypeScript wrappers in `src/lib/api.ts` — do not call `invoke()` directly inside UI components.
4. **Database Migrations (SQLite)**:
   - Add `CREATE TABLE IF NOT EXISTS` or schema updates to `init_tables()` in `src-tauri/src/db/mod.rs`.
   - If an entity needs to be included in backups and sync, update `BackupBundle`, `export_backup_bundle`, and `import_backup_bundle` accordingly.
5. **Styling & Theming**:
   - Use the CSS variables defined in `src/index.css` (the *Terminal Obsidian* palette, e.g., `var(--canvas)`, `var(--surface-low)`, `var(--primary)`). Avoid hardcoded hex colors in components.

---

## 3. Pull Request Guidelines

- **Atomic PRs (1 PR = 1 Concern)**: Keep PRs small and focused. Do not mix unrelated features or refactoring into a single PR.
- **Do NOT bump version numbers**: Do not edit version fields in `package.json`, `Cargo.toml`, `tauri.conf.json`, `README.md`, etc. Versioning and releases are managed by the maintainer.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat(<domain>): ...` for new features
  - `fix(<domain>): ...` for bug fixes
  - `style(<domain>): ...` for styling / UI adjustments
  - `refactor(<domain>): ...` for code cleanup without functional changes
- **Link Issues**: Include `Closes #X` or `Fixes #X` in your PR description so GitHub automatically closes the corresponding issue when merged.

---

## 4. Local Verification (Required Before Submitting a PR)

Before opening a PR, ensure that all local checks pass cleanly:

```bash
# 1. Frontend check (TypeScript compiler + Vite production build)
bun run build

# 2. Backend check & tests
cd src-tauri
cargo check --all-targets
cargo test --all-targets
```

All commands above must succeed with zero errors. Every PR is automatically tested by GitHub Actions CI.

### Platform-gated code

Some backend modules only compile on one OS and are skipped elsewhere by
`#[cfg(...)]` — notably `src-tauri/src/biometric/windows.rs` (Windows Hello,
Windows-only) and `src-tauri/src/biometric/macos.rs` (Touch ID, macOS-only).
`cargo check` on Linux/macOS cannot verify the Windows-gated code, so a
change touching it must also be built on Windows (`bun run tauri dev` or
`cargo check` on a Windows machine) before the PR is considered verified.
