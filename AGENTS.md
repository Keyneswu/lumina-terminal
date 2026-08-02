# AGENTS.md

This document describes Lumina Terminal's architecture, design principles, and
the rules any AI (or human) contributor must follow so the codebase stays
high-cohesion / low-coupling and does not regress into duplication.

> Read this **before** making changes. If a change would violate a rule below,
> extract or refactor first rather than adding another copy.

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell / backend | Rust + Tauri v2 |
| PTY | `portable_pty` |
| Frontend | React 19 + TypeScript (strict) |
| Terminal renderer | xterm.js v6 (+ webgl, fit, web-links, image addons) |
| UI components | HeroUI (`@heroui/react`) |
| Styling | Tailwind CSS v4 |
| Build | Vite 7, `pnpm` |
| i18n | JSON files in `translations/` |

The backend (`src-tauri/`) is intentionally thin: it spawns/kills PTYs,
streams output via Tauri events, and exposes a few filesystem helpers. All UI
logic, state, and derivation live in the frontend.

---

## 2. Source Map

### Frontend (`src/`)

```
src/
├── App.tsx                  # Root: window chrome + terminal tab lifecycle
├── main.tsx                 # ReactDOM entry; wraps App in GlobalConfigProvider
├── constants.ts             # Default config, default bindings, tab-id sentinels
├── types/
│   ├── config.ts            # GlobalConfig, Binding, Actions, WithKeys
│   └── terminal.ts          # TerminalProfile, TerminalRenderOptions, SSHConfig
│
├── lib/                     # Pure, framework-agnostic logic (NO React)
│   ├── platform.ts          # isMacOS() / isLinux()
│   ├── configFile.ts        # config.json path + openConfigFile()
│   ├── color.ts             # isColorDark, foregroundFor, adjustColor, visibleRed
│   ├── glass.ts             # glassSurface / glassBorder / elevationShadow — backdrop-filter material
│   │                        #   + Wayland/WebKitGTK opaque fallback (single source for the glass look)
│   ├── motion.ts            # framer-motion variants/transitions presets (one spring curve for all chrome)
│   ├── ssh.ts               # formatSshAddress / formatSshEntry
│   ├── term.ts              # parseProfile, parseProfileTheme, parseProfilePadding
│   ├── terminalApi.ts       # invoke wrappers: writeToTerminal, resizeTerminal, ...
│   ├── shellIcon.ts         # getShellType(profile) → "bash"|"zsh"|"fish"|"nu"|"pwsh"|"ssh"|"default"
│   ├── bindings.ts          # parseBindings, matchBinding, loadBindings, useKeyboardBindings,
│   │                        #   exported actionSignature / keySignature
│   ├── edgeBackground.ts    # sampleEdgeBackground (xterm buffer edge inspection)
│   ├── tearoff.ts           # Tab tear-off: label mint/store/consume + WebviewWindow spawn
│   └── FloatingFitAddon.ts  # xterm fit addon subclass (centered sub-cell fit)
│
├── hooks/                   # React hooks (start with `use`)
│   ├── config.tsx           # GlobalConfigProvider + useGlobalConfig (LazyStore-backed)
│   ├── i18n.tsx             # useI18n, languageNames, Languages type
│   ├── maximized.ts         # useMaximized (window resize → isMaximized)
│   ├── paddingOffset.ts     # usePaddingOffset(isMaximized) → platform/maximize padding
│   ├── surfaceColors.ts     # useSurfaceColors(bg) → derived border/overlay/glass/accent colors
│   ├── useGlass.ts          # useGlass() → {supportsGlass, blurPx}: platform backdrop-filter capability
│   │                        #   (disabled on Linux/WebKitGTK; module-cached like useShells)
│   ├── useSettingsDraft.ts  # useSettingsDraft(source, onCommit, deps) → {draft, isDirty, save, ...}
│   │                        #   shared draft+dirty+save logic for all settings panels
│   ├── useShells.ts         # useShells() — cached find_shells backend call
│   ├── useSshConfig.ts      # useSshConfig() — cached parse_ssh_config backend call
│   ├── useOutputMode.ts     # useOutputMode(id) → {markInteractive}: debounced LowLatency toggle
│   ├── useEffectiveTheme.ts # useEffectiveTheme(profile, currentId) → theme/bg/fg + HeroUI sync
│   └── useTearoffSession.ts # useTearoffSession() → {label, payload} | "no" | null (tab tear-off boot)
│
├── components/
│   ├── ui/                  # Shared design primitives (the visual system — one of each thing)
│   │   ├── IconButton.tsx   # Unified chrome button (replaces 3 prior button systems). Motion-aware.
│   │   ├── SettingsShell.tsx    # Settings page frame (scroll body + optional footer slot)
│   │   ├── SettingRow.tsx       # field / toggle / action / info row — kills the settings spacing drift
│   │   ├── SectionTitle.tsx     # <h2> heading + optional subtitle (consistent mb)
│   │   └── SaveFooter.tsx       # Save (disabled-when-clean) + unsaved hint + trailing action slot
│   ├── Term.tsx             # Single xterm instance: addons, PTY lifecycle, edge bg polling
│   ├── TabBar.tsx           # Sidebar tab list
│   ├── TitleBar.tsx         # Drag region + window controls (per-platform)
│   ├── CommandPalette.tsx   # Ctrl+Shift+P modal
│   ├── ShellIcon.tsx        # Per-shell tab icon (bash/zsh/fish/nu/pwsh/ssh/default)
│   ├── ThemePreview.tsx     # 8-color ANSI swatch with tooltip
│   └── settings/
│       ├── GeneralSettings.tsx
│       ├── GlobalProfileSettings.tsx
│       ├── ProfileSettings.tsx
│       ├── RenderSettings.tsx     # Shared render-option form (rows/cols/font/theme/webgl)
│       ├── BindingsSettings.tsx
│       ├── DeveloperSettings.tsx
│       ├── AddProfileModal.tsx
│       ├── ShellSelector.tsx      # Shared shell picker (dropdown + custom path + browse)
│       └── SshFields.tsx          # Shared SSH Host/Port/User/IdentityFile form
│
└── pages/
    ├── WelcomePage.tsx      # First-run wizard (3 steps)
    ├── SettingsPage.tsx     # Settings shell with inner sidebar
    └── AboutPage.tsx
```

### Backend (`src-tauri/src/`)

```
src-tauri/src/
├── main.rs        # entry, calls lib::run()
├── lib.rs         # Tauri builder: plugins, state, invoke_handler registration
├── state.rs       # TerminalState (HashMap of PTY pairs + writers + force_low_latency flags
│                  #   + swappable output_channel for tab tear-off reattach)
├── terminal.rs    # start/reattach/kill/write/resize_terminal, set_output_mode commands;
│                  #   reader thread streams output over the entry's swappable Channel<String>
│                  #   with streaming-UTF-8 decoding + two-mode burst coalescing;
│                  #   reattach_terminal atomically swaps the channel for tab tear-off
└── utils.rs       # find_shells, path_exist, read_file, parse_ssh_config, etc.
```

---

## 3. Design Principles

### 3.1 Layering — one direction of dependency

```
types  ←  lib  ←  hooks  ←  components/pages  ←  App
```

- **`types/`** depends on nothing internal.
- **`lib/`** holds pure logic: no React, no JSX, no `useState`. The single
  exception is `lib/bindings.ts`, which exports `useKeyboardBindings` for
  convenience — do not add more React into `lib/`.
- **`hooks/`** may import `lib/` and `types/`, never `components/`.
- **`components/`** may import `hooks/`, `lib/`, `types/`.
- **`App.tsx`** wires everything; it may import from all layers.

Never invert an arrow. If a `lib/` function needs React, it belongs in `hooks/`.

### 3.2 Single Source of Truth (no duplication)

Before writing any new logic, check whether it already exists. Common
categories that tend to duplicate:

- **Platform checks** → use `lib/platform.ts` (`isMacOS`, `isLinux`). Do not
  call `@tauri-apps/plugin-os` directly in components.
- **Color math** → use `lib/color.ts`. Do not re-implement luminance / contrast.
- **Glass material / backdrop-filter** → use `lib/glass.ts` (`glassSurface`,
  `glassBorder`, `elevationShadow`) gated by `hooks/useGlass.ts`. Never write
  `backdrop-filter` inline in a component — the Wayland/WebKitGTK fallback
  lives in `glassSurface`, so bypassing it breaks Linux. Call `glassSurface`
  directly in the chrome container and spread the result onto its `style`.
- **Motion presets** → use `lib/motion.ts` (shared framer-motion variants).
  Do not invent per-component spring curves; reuse `springSoft`, `fadeSlideUp`,
  `whileHoverTap`, etc., so all chrome animates with one rhythm.
- **Chrome buttons** → use `components/ui/IconButton.tsx`. Do not hand-roll
  `<button>` + `onMouseEnter` background swapping (the old pattern that
  drifted across TitleBar/TabBar) — `IconButton` handles hover/active/focus
  declaratively and is motion-aware.
- **Settings layout** → use `components/ui/` primitives (`SettingsShell`,
  `SettingRow`, `SectionTitle`, `SaveFooter`) and `hooks/useSettingsDraft.ts`.
  Do not re-roll the page-shell / labeled-field / draft+isDirty pattern in a
  new settings panel — port it onto the shared primitives instead.
- **Backend `invoke` calls** → wrap new commands in `lib/terminalApi.ts` (or a
  sibling api module) and import the wrapper. Components should rarely call
  `invoke` directly; when they do (one-off commands like `path_exist`), it is
  acceptable, but if the same command appears twice, extract it.
- **Binding signatures** → `actionSignature` and `keySignature` are exported
  from `lib/bindings.ts`. The settings UI and the runtime matcher must share
  these so conflict detection stays in sync. Never re-define them.
- **SSH address formatting** → `lib/ssh.ts` (`formatSshAddress`).
- **SSH config fetching** → `hooks/useSshConfig.ts` (module-level cached). Do
  not call `invoke("parse_ssh_config")` directly.
- **Shell discovery** → `hooks/useShells.ts` (module-level cached). Do not call
  `invoke("find_shells")` directly.
- **Shell type / tab icon** → `lib/shellIcon.ts` (`getShellType`) is the single
  source for mapping a `TerminalProfile` to its icon category; `components/
  ShellIcon.tsx` renders it. Do not re-derive shell type from `exePath` in the
  TabBar or elsewhere.
- **Shared settings sub-forms** → `ShellSelector`, `SshFields`, `RenderSettings`.
  When a new settings page needs the same fields, reuse these components.

Rule of thumb: **if you are about to copy-paste >10 lines from another file,
stop and extract.**

### 3.3 State lives as high as needed, no higher

- Cross-cutting state (config, theme, window maximize) is computed once at the
  top (`App.tsx` or a provider) and passed down via props.
  - `isMaximized` — computed once in `App`, passed to `TitleBar` and
    `usePaddingOffset`. Components must NOT independently listen to window
    resize to derive maximize state.
  - `paddingOffset` — derived from `isMaximized`; computed in `App`, passed to
    each `Term` via prop. A `Term` must not call `usePaddingOffset` itself.
  - `effectiveTheme` / `bg` / `fg` — derived once in `useEffectiveTheme`,
    called from `App`. The HeroUI `dark`/`light` class sync happens there and
    only there.
  - `parsedBindings` — `useMemo` in `App`, passed to every `Term` as a prop.
    A `Term` must not call `parseBindings` itself.

- Local UI state (drafts, hover, modal open) stays in the component.

### 3.4 Naming conventions

- React hooks: file `hooks/useFoo.ts` or `hooks/foo.tsx` (if it provides JSX),
  export `useFoo`. Note: `getMaximized` was renamed to `useMaximized` — do not
  reintroduce non-`use`-prefixed hook names.
- Pure modules: `lib/foo.ts`, export named functions.
- Config sentinels (`SETTINGS_TAB_ID`, `ABOUT_TAB_ID`) live in `constants.ts`.

### 3.5 Keeping `App.tsx` lean

`App.tsx` orchestrates: terminal lifecycle, tab switching, command-palette
action list, and wiring props to children. It must NOT contain:

- Inline theme derivation logic → `useEffectiveTheme`.
- Inline `invoke` calls → `lib/terminalApi.ts`.
- Duplicate profile-lookup logic → use the `findProfile` helper.

If `App.tsx` grows past ~400 lines of real logic again, extract a hook
(e.g. `useTerminalManager`) rather than letting it balloon.

### 3.6 Logging conventions

The app has **one logger**: the Rust `tauri-plugin-log` writes to a rotating
log file in the app log dir, and its `Webview` target forwards the same stream
to the frontend. The frontend `@tauri-apps/plugin-log` (`info`/`debug`/`warn`/
`error`) feeds back into that same file, so logs from both layers end up in
**one place** — the file `DeveloperSettings` exposes via "Log Directory → Open".

**Rule: every async operation, backend call, and error path must log its
outcome.** Silent failures (`let _ =`, `.then()` with no `.catch`, `.catch(() => [])`)
are forbidden. When you add a new `invoke`/`listen`/async call, wire its failure
path to the logger.

#### Where each log belongs

| Layer | Mechanism |
|-------|-----------|
| Rust backend | `log::{debug, info, warn, error}` — already initialized in `lib.rs` (Info by default, Debug for `lumina_terminal_lib`). |
| Frontend | `import { debug, info, warn, error } from "@tauri-apps/plugin-log"`. **Never** use `console.log`/`console.error` — those do NOT reach the log file. |

#### Backend (Rust) rules

1. **Log before panicking.** Do NOT use bare `.expect("...")` — it bypasses the
   log framework, so the failure never reaches the file. Use the established
   pattern: `.unwrap_or_else(|e| { log::error!("...: {}", e); panic!("...: {}", e); })`.
2. **Panics are a last resort.** Prefer returning a `Result`/`Option` and
   logging at `warn!`/`error!`. Only panic for truly unrecoverable state
   (corrupted mutex, pty spawn failure).
3. **Every `#[tauri::command]` handler logs its error/edge paths.** A missing
   terminal, a failed read, or a rejected operation must produce a log line.
   Be consistent: `kill_terminal`, `write_to_terminal`, `resize_terminal`, and
   `set_output_mode` all `warn!` on a missing id — keep new handlers the same.
4. **Never drop a `Result` silently.** `let _ = foo();` hides failures. Use
   `if let Err(e) = foo() { log::warn!(...) }` (or `.unwrap_or_else` per rule 1
   when the failure is fatal).
5. **Log level by intent:**
   - `error!` — operation failed and could not recover (spawn, kill, emit exit).
   - `warn!` — operation failed but degraded gracefully (missing terminal, bad
     input, optional feature disabled).
   - `info!` — significant lifecycle event the user could correlate with
     behavior (app startup, terminal start/exit, child process exit).
   - `debug!` — diagnostic detail for development (thread start/stop, lock
     contention, speculative reads like theme probing).

#### Frontend (TypeScript/React) rules

1. **Use `@tauri-apps/plugin-log`, never `console.*`.** `console.log` only
   prints to the webview devtools, not the file users actually open.
2. **Every `invoke()` / `listen()` / fire-and-forget promise needs a failure
   path.** `.then()` with no `.catch` swallows rejections silently. Attach a
   `.catch((e) => error(\`...\`).catch(() => {}))`.
3. **Backend `invoke` calls go through `lib/terminalApi.ts`** (or a sibling
   `lib/<domain>Api.ts`). These wrappers centralize the log-on-reject logic via
   `invokeWithLog`, so new commands get error logging for free. Do not call
   `invoke("...")` directly in a component — and never add a second parallel
   invoke helper; extend the existing one.
4. **Guard logger calls themselves.** The plugin-log functions return promises
   that can reject; chain `.catch(() => {})` so a logging failure never breaks
   app flow. The `invokeWithLog` helper shows the pattern.
5. **Log level mirrors the backend:** `error` for unrecoverable, `warn` for
   degraded fallbacks, `info` for lifecycle, `debug` for detail. Reserve `info`
   for events a user could correlate with what they did (tab opened, settings
   saved), not for routine internal transitions.
6. **Do not log on hot paths.** Edge-background polling, per-keystroke writes,
   and per-tick reader flushes are too frequent to log per iteration. Log the
   lifecycle (start/stop, first failure) once, not every cycle.

#### What to log vs. what not to log

- **Always log:** backend command failures, PTY spawn/kill, listener
  registration failures, config load/save failures, promise rejections that
  would otherwise vanish, panics (before they happen).
- **Never log:** routine success of hot operations, raw user keystrokes/output
  (privacy + volume), per-render state, unmodified values passed through.

---

## 4. Rules for AI Contributors

## 4. Rules for AI Contributors

1. **Do not duplicate.** Search the codebase for existing logic before writing
   new. Grep for function names, `invoke("...")` strings, and UI patterns.
2. **Respect the layering.** Put pure logic in `lib/`, React-aware logic in
   `hooks/`, JSX in `components/`. Do not import `components/` from `lib/` or
   `hooks/`.
3. **One source of truth per concern.** If you add a new backend command,
   wrap it in `lib/terminalApi.ts` (or a new `lib/<domain>Api.ts`) and import
   the wrapper everywhere. If you add a new derived value shared across
   components, make it a hook in `hooks/`.
4. **Every async operation and error path must log.** See §3.6 for the full
   rules. In short: never use bare `.expect()`/`console.*` or a `.then()` with
   no `.catch` — log via the plugin logger before panicking and on every
   rejection. New `invoke` commands go through the `invokeWithLog` wrapper so
   they get error logging for free.
5. **Props over re-derivation.** If a value is already computed in a parent
   (theme, maximize, padding, parsed bindings), pass it down. Do not
   re-compute it in the child.
6. **No dead code.** If you remove the last consumer of a file, delete the
   file. Do not leave unused components (the old `ResizeHandle.tsx` was dead
   for a long time before removal).
7. **Keep `lib/` React-free** (except the existing `useKeyboardBindings`
   exception). Pure functions are easier to test and reuse.
8. **Match existing style.** Tabs for indentation, double quotes for JSX
  attribute strings where the file already uses them, `import ... from
  "...ts"` with explicit extensions (bundler resolution). Follow the
  surrounding code's conventions.
9. **Verify with `pnpm build`** after changes. The tsconfig is strict
   (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) —
   unused imports/vars will fail the build. Use this as a guardrail.
10. **Behavior-preserving refactors only** unless explicitly asked. Keep
   props, command names, and event names (`term-write-${id}`, `term-exit-${id}`)
   stable — the Rust backend and frontend are coupled by these strings.
11. **Document significant new modules** here in §2 (Source Map) so the next
    contributor knows they exist.
12. If you add new dependencies, add them into README with a link to its
    official website or repo.

---

## 5. When You're Unsure

- **Where does X belong?** Check §2 and §3.1. Pure logic → `lib/`; React-aware
  → `hooks/`; JSX → `components/`.
- **Is this a duplicate?** Grep. If a function with the same purpose exists,
  reuse it; if the signatures differ slightly, generalize the existing one
  rather than adding a parallel one.
- **Should this be shared state?** If two components need the same derived
  value, compute once at their nearest common ancestor and pass via props.
- **Can I change a backend command/event name?** Only if you update both
  `src-tauri/src/` and `src/` together. These are coupled by string.
- **Where does a log/error go?** See §3.6. Rust → `log::{debug,info,warn,error}`;
  frontend → `@tauri-apps/plugin-log` (`never console.*`). Log before panicking,
  and attach `.catch` to every promise — never leave a silent `let _ =` or
  bare `.then()`.
