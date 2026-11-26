## Summary
<!-- A clear and concise description of what this PR changes and why. -->

Closes #<!-- issue number, e.g. Closes #12 -->

---

## Type of Change
<!-- Check all that apply -->
- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] ⚡ Performance improvement
- [ ] 🎨 UI / UX styling or redesign
- [ ] 📝 Documentation update
- [ ] 🔧 Refactoring (no functional change)

---

## Technical Changes
<!-- List the key files or logic that was modified -->
- 

---

## How to Test
<!-- Step-by-step instructions to manually verify this change -->
1. 
2. 

---

## Contributor Checklist
<!-- All boxes must be checked before requesting a review -->
- [ ] Frontend build passes with zero errors: `bun run build`
- [ ] Backend check passes: `cd src-tauri && cargo check`
- [ ] Backend tests pass: `cd src-tauri && cargo test`
- [ ] **No version bumps** — do not modify version fields in `package.json`, `Cargo.toml`, `tauri.conf.json`, etc. (versions are managed by the maintainer at release time)
- [ ] Commits follow the Conventional Commits format (`feat:`, `fix:`, `style:`, etc.)
- [ ] User-visible change? Added an entry under `## [Unreleased]` in `CHANGELOG.md` (see the Changelog section in `AGENTS.md`). Skip for refactors, CI, and docs.
