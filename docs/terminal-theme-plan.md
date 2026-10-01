# Plan: Fitur Terminal Theme, Font & Keyword Highlighting

> Status: **Implemented** — lihat `src/lib/terminalThemes.ts`, `src/lib/highlightPatterns.ts`, `src/lib/terminalHighlighter.ts`, `src/stores/useTerminalThemeStore.ts`, `src/components/settings/TerminalThemeTab.tsx` + `TerminalPreview.tsx`, integrasi di `XtermView.tsx` & `SettingsView.tsx`.

## 1. Tujuan

Menambahkan pengaturan tampilan terminal ala Termius:

1. **Terminal theme** — pilihan skema warna (background, foreground, cursor, 16 warna ANSI) + paduan warna semantik teks normal / warning / error / perintah.
2. **Text size & font** — pilihan `fontFamily`, `fontSize`, `lineHeight`, gaya kursor; berlaku global + zoom per-sesi tetap bisa.
3. **Keyword highlighting** — pewarnaan otomatis kata kunci `ERROR`, `WARNING`, `OK/SUCCESS`, `INFO`, `DEBUG`, serta pola `IP` & `MAC` pada output terminal.

Prinsip: **tidak mengganggu sesi SSH aktif** (tanpa reconnect), **tidak merusak copy-paste**, dan **aman untuk curses apps** (`htop`, `vim`).

## 2. Kondisi Existing (temuan)

| Area | File | Temuan |
|---|---|---|
| Theme terminal | `src/components/terminal/XtermView.tsx:462-494` | `new Terminal({... theme: {...} })` **hardcoded** satu palette ("Terminal Obsidian": bg `#0a0e14`, fg `#f0f6fc`, dst). Tidak ada selector, tidak reaktif. |
| Font | `XtermView.tsx:465-467` + `adjustTerminalFontSize()` (`:119-140`) | `fontFamily` hardcoded, `fontSize` default `13.5`, zoom `Ctrl+=/-/0` hanya mengubah `term.options` **in-memory per instance pool**, tidak persisten antar restart. |
| Pool lifecycle | `XtermView.tsx:60,430-620` (`terminalPool`) | Instance xterm di-cache per `sessionId` agar survive split/tab. Artinya perubahan theme/font harus di-apply ke **semua entry pool yang hidup**, bukan hanya yang visible. |
| Settings store | `src/stores/useSettingsStore.ts` | Hanya menyimpan `useOsKeyring` + `autoLockPolicy` (persist key `termimus_settings`). Belum ada namespace terminal. |
| Settings UI | `src/components/settings/SettingsView.tsx` | Tab: `security \| sync \| known_hosts \| backup \| about`. Belum ada tab tampilan. Pola kartu + `CustomSelect` bisa dipakai ulang. |
| Search | `XtermView.tsx` + `TerminalSearchBar.tsx` | Sudah pakai `SearchAddon` (decorations). Highlighting harus **kompatibel** dengan addon ini, bukan menimpanya. |
| Palette app | `src/index.css` | Variabel `--canvas`, `--surface-*`, `--primary`, dst. Theme terminal sebaiknya **terpisah** dari theme UI (terminal punya background sendiri). |

## 3. Desain

### 3.1 Terminal Theme Preset (ala Termius)

Buat katalog preset di file baru `src/lib/terminalThemes.ts`:

```ts
interface TerminalTheme {
  id: string;            // "obsidian" | "dracula" | ...
  label: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  // 16 warna ANSI standar
  black, red, green, yellow, blue, magenta, cyan, white: string;
  brightBlack, brightRed, brightGreen, brightYellow,
  brightBlue, brightMagenta, brightCyan, brightWhite: string;
  // warna semantik untuk keyword highlighting (bagian 3.3)
  semantic: {
    error: string; warning: string; success: string;
    info: string; debug: string; ip: string; mac: string;
    command: string;   // warna "perintah yang diketik user" di preview/echo
  };
}
```

Preset awal yang diusulkan (6, mirip pilihan Termius + populer):

| # | id | Basis | background | foreground | Catatan |
|---|---|---|---|---|---|
| 1 | `obsidian` | saat ini (default) | `#0a0e14` | `#f0f6fc` | Jangan ubah nilai existing → backward compat |
| 2 | `termius-green` | Termius-style | `#14171c` | `#5eeaa0` (hijau) | Teks hijau phosphor; pasangan font JetBrains Mono 13.5/1.40 |
| 3 | `everforest` | eye-comfort | `#2b3339` | `#d3c6aa` (warm beige) | Kontras rendah, nyaman; pasangan font JetBrains Mono 14/1.45 |
| 2 | `one-dark` | Atom One Dark | `#282c34` | `#abb2bf` | Netral, populer |
| 3 | `dracula` | Dracula | `#282a36` | `#f8f8f2` | Kontras tinggi |
| 4 | `nord` | Nord | `#2e3440` | `#d8dee9` | Dingin/low-contrast |
| 5 | `solarized-dark` | Solarized | `#002b36` | `#839496` | Klasik sysadmin |
| 6 | `light` | Termius Light-like | `#ffffff` | `#1a1a1a` | Satu opsi terang untuk aksesibilitas |

> Setiap preset mendefinisikan ke-16 ANSI + `semantic`. Jangan derive semantik dari ANSI secara otomatis (mis. `red` ≠ `error` di semua theme) — definisikan eksplisit per preset agar warning/error terbaca di semua background.

Opsi **Custom** (fase 2, opsional): user override `background/foreground/cursor` + 3 warna semantik via color input. Simpan sebagai `custom: Partial<TerminalTheme>`.

### 3.2 Text Size & Font

Model (persist, lihat 3.4):

```ts
interface TerminalFontSettings {
  fontFamily: string;   // salah satu dari daftar allowlist
  fontSize: number;     // 9–24, default 13.5
  lineHeight: number;   // 1.0–1.8, default 1.35
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean; // default true
}
```

Allowlist font (yang sudah di-bundle / system fallback):

1. `JetBrains Mono` (default, sudah di `index.html` via Google Fonts)
2. `Fira Code`
3. `Consolas` (Windows bawaan — penting untuk offline)
4. `Menlo` / `Monaco` (macOS fallback)
5. `monospace` (fallback akhir)

Perilaku:

* Perubahan dari Settings → apply langsung ke **semua instance di `terminalPool`**:
  ```ts
  for (const entry of terminalPool.values()) {
    Object.assign(entry.term.options, { fontFamily, fontSize, lineHeight, cursorStyle, cursorBlink, theme });
    entry.fitAddon.fit(); // + guard cols>=20 && rows>=5 lalu api.resizeSsh (pola existing)
  }
  ```
* Zoom keyboard (`Ctrl+=/-/0`) tetap berfungsi sebagai **offset sementara per sesi**; tombol "Reset" di context menu mengembalikan ke nilai global dari store (bukan hardcoded `13.5` lagi — ubah `adjustTerminalFontSize` agar baca default dari store).
* Setiap `fit()` wajib memakai guard existing (`width<100 || height<100` return, `cols>=20 && rows>=5`) agar tidak merusak `htop/vim` — lihat AGENTS.md "Terminal visibility".

### 3.3 Keyword Highlighting

#### Keputusan arsitektur: pakai `IDecoration` API (xterm v6 `allowProposedApi`), BUKAN injeksi escape sequence

| Pendekatan | Kelebihan | Kekurangan | Keputusan |
|---|---|---|---|
| A. `term.registerDecoration()` overlay | Tidak mengubah buffer → copy-paste bersih, aman untuk curses, bisa di-toggle | Perlu scan baris viewport + re-scan on scroll/resize | **Pilih ini** |
| B. Bungkus output dengan `\x1b[31m...\x1b[0m` sebelum `term.write()` | Simpel | Mengotori buffer (copy ikut kode warna), merusak `vim/htop`, konflik dengan warna asli remote | **Tolak** |

`@xterm/xterm` 6 sudah mengekspos `registerDecoration` di balik `allowProposedApi: true` (sudah aktif di `XtermView.tsx:493`).

#### Pola yang di-highlight

File baru `src/lib/highlightPatterns.ts`:

| Kategori | Regex (case-insensitive kecuali IP/MAC) | Warna default (diambil dari `theme.semantic`) | Contoh cocok |
|---|---|---|---|
| `error` | `\b(error\|failed\|failure\|fatal\|exception\|denied\|refused\|timeout)\b` | `semantic.error` (merah) | `ERROR: connection refused` |
| `warning` | `\b(warn(?:ing)?\|deprecated\|caution)\b` | `semantic.warning` (kuning) | `WARNING: deprecated cipher` |
| `success` | `\b(ok\|success(?:ful)?\|passed\|done\|completed)\b` | `semantic.success` (hijau) | `Build succeeded` |
| `info` | `\b(info\|notice\|connected\|listening)\b` | `semantic.info` (biru) | `INFO: listening on :8080` |
| `debug` | `\b(debug\|trace)\b` | `semantic.debug` (ungu/magenta) | `DEBUG peer=10.0.0.1` |
| `ip` | `\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b` + IPv6 singkat `([0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:.]+` | `semantic.ip` (cyan + underline) | `192.168.1.10:22`, `fe80::1` |
| `mac` | `\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b` | `semantic.mac` (cyan) | `AA:BB:CC:DD:EE:FF` |
| `command` | — | `semantic.command` | Khusus preview/echo lokal, bukan parsing remote (lihat batasan) |

Catatan "perintah" (request user: "paduan warna teks normal, warning, error, perintah"):

* Output SSH adalah byte stream mentah — terminal **tidak tahu** mana "perintah user" vs "output program" tanpa shell integration (OSC 133). Jadi untuk fase 1, "warna perintah" hanya diterapkan di **preview Settings** dan **echo lokal yang kita kontrol** (mis. `Failed to connect:` di `XtermView.tsx:424`). Jangan coba parse prompt remote (`$`, `#`) — rapuh dan beda-beda shell.

#### Mekanisme runtime

File baru `src/lib/terminalHighlighter.ts`:

```ts
class TerminalHighlighter {
  constructor(term: Terminal, getConfig: () => HighlightConfig & { theme: TerminalTheme })
  attach(): void    // subscribe term.onWriteParsed + scroll + resize (debounced ~150ms)
  detach(): void    // dispose semua decorations (dipanggil dari disposeTerminalSession)
  refreshAll(): void // re-scan saat theme/toggle berubah
}
```

* Scan hanya **baris viewport** (`term.buffer.active.viewportY .. viewportY + rows`), bukan seluruh scrollback 5000 baris → hemat CPU.
* Debounce 150ms untuk burst log (mirip batching 8ms backend di `ssh/mod.rs`).
* Cap: maks ~200 decorations per viewport; baris lebih panjang dari 2000 char di-skip.
* Tiap kategori bisa di-toggle on/off dari Settings; toggle off → dispose decorations kategori itu saja.
* Prioritas overlap: `ip/mac` > `error` > `warning` > `success` > `info` > `debug` (IP di dalam pesan error tetap cyan bergaris bawah).

### 3.4 State & Persistensi

Opsi yang dipilih: **store baru** `src/stores/useTerminalThemeStore.ts` (persist key `termimus_terminal_theme`), bukan menumpuk di `useSettingsStore`, agar Settings umum tidak tercampur preferensi tampilan:

```ts
interface TerminalThemeState {
  themeId: string;                 // default "obsidian"
  customOverrides: Partial<...>;  // fase 2
  font: TerminalFontSettings;
  highlight: Record<"error"|"warning"|"success"|"info"|"debug"|"ip"|"mac", boolean>; // default semua true
  setThemeId(id: string): void;
  setFont(patch: Partial<TerminalFontSettings>): void;
  setHighlight(key: ..., v: boolean): void;
  resetDefaults(): void;
}
```

* `XtermView` subscribe store ini; `useEffect` per `sessionId` menerapkan ke instance pool (create baru pakai nilai store, instance lama di-update via loop pool).
* Migrasi: user lama tanpa key → default = nilai hardcoded saat ini (tidak ada perubahan visual mendadak).

### 3.5 UI Settings

Tab baru **`Terminal & Theme`** di `SettingsView.tsx` (tambah ke union `SettingsTab` + array `tabs`, ikon `Palette`):

1. **Theme grid** — 6 kartu preview (mini bar warna ANSI + nama). Klik = apply instan ke semua terminal terbuka.
2. **Live preview** — panel terminal palsu (div biasa, bukan xterm) berisi ~10 baris contoh: prompt perintah, `INFO`, `WARNING`, `ERROR`, `OK`, `DEBUG`, baris berisi IP & MAC. Render dengan warna `theme.semantic` aktif → user lihat efek sebelum save (tidak perlu koneksi SSH).
3. **Font section** — `CustomSelect` fontFamily, slider `fontSize` (9–24 step 0.5) + angka, slider `lineHeight`, select `cursorStyle`, toggle `cursorBlink`.
4. **Highlight section** — 7 toggle (error/warning/success/info/debug/ip/mac) masing-masing dengan dot warna semantik theme aktif.
5. **Reset** — tombol "Reset to defaults".

File baru: `src/components/settings/TerminalThemeTab.tsx`, `src/components/settings/TerminalPreview.tsx`.

## 4. Fase Implementasi

| Fase | Isi | File |
|---|---|---|
| 0 | Siapkan plan ini + tentukan final 6 preset hex | `docs/terminal-theme-plan.md` (done) |
| 1 | `terminalThemes.ts` (tipe + 6 preset + `getEffectiveTheme(id, overrides)`) + `useTerminalThemeStore.ts` | 2 file baru |
| 2 | Settings UI: tab + grid + preview + font controls (tanpa highlighting dulu), `XtermView` baca theme/font dari store, loop-apply ke pool, zoom pakai default store | `SettingsView.tsx`, `TerminalThemeTab.tsx`, `TerminalPreview.tsx`, `XtermView.tsx` |
| 3 | `highlightPatterns.ts` + `terminalHighlighter.ts` (decorate + debounce + cap), toggle per kategori, hook ke create/dispose/refresh di `XtermView` | 2 file baru + `XtermView.tsx` |
| 4 | Polish: custom override warna (fase 2 opsional), pastikan `SearchAddon` decorations tidak bentrok, uji curses apps | — |
| 5 | Verifikasi: `bun run build` (tsc+vite), `cargo check`, manual matrix (lihat §6) | — |

Perkiraan: Fase 1–2 ≈ kecil-menengah (±3–5 file), Fase 3 ≈ menengah (logika decoration + perf guard).

## 5. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Decoration memperlambat scroll saat banjir log | Scan viewport saja + debounce 150ms + cap 200/viewport + skip baris >2000 char |
| Highlight ikut ter-copy | Decorations adalah overlay, tidak masuk buffer → copy tetap bersih (beda dengan injeksi ANSI) |
| `fit()` saat apply theme merusak `vim/htop` | Pakai guard existing: skip jika `<100px`, skip `resizeSsh` jika `cols<20 \|\| rows<5` |
| Konflik dengan `SearchAddon` highlight | Decoration per-addon independen; pakai `overviewRuler` layer terpisah, jangan `clearDecorations()` global |
| Font tidak tersedia offline | Allowlist berisi fallback chain (`'JetBrains Mono', Consolas, Menlo, monospace`); Consolas selalu ada di Windows |

## 6. Verifikasi Manual

1. `bun run build` hijau, `cd src-tauri && cargo check` hijau.
2. Buka 2 sesi SSH → ganti theme di Settings → **kedua terminal berubah tanpa reconnect** (cek `terminalPool` tidak di-clear).
3. Zoom `Ctrl+=` lalu ganti font global → zoom reset ke nilai global.
4. Jalankan di remote: `echo "ERROR failed WARNING ok INFO DEBUG 192.168.1.1 AA:BB:CC:DD:EE:FF"` → warna sesuai kategori; matikan toggle `ip` → IP kembali normal.
5. Buka `htop`/`vim` di satu pane → ganti theme → tidak ada resize glitch / karakter rusak.
6. Restart app → theme + font + toggle highlight persisten.
7. Copy teks yang ter-highlight → paste di notepad → tidak ada kode aneh.

## 7. Pertanyaan Terbuka

1. Perlu theme terang penuh untuk seluruh UI app, atau cukup terminal saja? (Plan ini: **terminal saja**.)
2. Custom color picker (override per-warna) masuk fase 1 atau ditunda? (Usulan: **tunda ke fase 4**.)
3. Butuh highlight URL/clickable link juga? Bisa pakai `WebLinksAddon` — di luar scope plan ini kecuali diminta.
