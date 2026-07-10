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
│   ├── color.ts             # isColorDark, foregroundFor, adjustColor
│   ├── ssh.ts               # formatSshAddress / formatSshEntry
│   ├── term.ts              # parseProfile, parseProfileTheme, parseProfilePadding
│   ├── terminalApi.ts       # invoke wrappers: writeToTerminal, resizeTerminal, ...
│   ├── shellIcon.ts         # getShellType(profile) → "bash"|"zsh"|"fish"|"nu"|"pwsh"|"ssh"|"default"
│   ├── bindings.ts          # parseBindings, matchBinding, loadBindings, useKeyboardBindings,
│   │                        #   exported actionSignature / keySignature
│   ├── edgeBackground.ts    # sampleEdgeBackground (xterm buffer edge inspection)
│   └── FloatingFitAddon.ts  # xterm fit addon subclass (centered sub-cell fit)
│
├── hooks/                   # React hooks (start with `use`)
│   ├── config.tsx           # GlobalConfigProvider + useGlobalConfig (LazyStore-backed)
│   ├── i18n.tsx             # useI18n, languageNames, Languages type
│   ├── maximized.ts         # useMaximized (window resize → isMaximized)
│   ├── paddingOffset.ts     # usePaddingOffset(isMaximized) → platform/maximize padding
│   ├── surfaceColors.ts     # useSurfaceColors(bg) → derived border/overlay colors
│   ├── useShells.ts         # useShells() — cached find_shells backend call
│   ├── useSshConfig.ts      # useSshConfig() — cached parse_ssh_config backend call
│   ├── useOutputMode.ts     # useOutputMode(id) → {markInteractive}: debounced LowLatency toggle
│   └── useEffectiveTheme.ts # useEffectiveTheme(profile, currentId) → theme/bg/fg + HeroUI sync
│
├── components/
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
├── state.rs       # TerminalState (HashMap of PTY pairs + writers + force_low_latency flags)
├── terminal.rs    # start/kill/write/resize_terminal, set_output_mode commands;
│                  #   reader thread streams output over a Channel<String> with
│                  #   streaming-UTF-8 decoding + two-mode burst coalescing
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

---

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
4. **Props over re-derivation.** If a value is already computed in a parent
   (theme, maximize, padding, parsed bindings), pass it down. Do not
   re-compute it in the child.
5. **No dead code.** If you remove the last consumer of a file, delete the
   file. Do not leave unused components (the old `ResizeHandle.tsx` was dead
   for a long time before removal).
6. **Keep `lib/` React-free** (except the existing `useKeyboardBindings`
   exception). Pure functions are easier to test and reuse.
7. **Match existing style.** Tabs for indentation, double quotes for JSX
  attribute strings where the file already uses them, `import ... from
  "...ts"` with explicit extensions (bundler resolution). Follow the
  surrounding code's conventions.
8. **Verify with `pnpm build`** after changes. The tsconfig is strict
  (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) —
  unused imports/vars will fail the build. Use this as a guardrail.
9. **Behavior-preserving refactors only** unless explicitly asked. Keep
   props, command names, and event names (`term-write-${id}`, `term-exit-${id}`)
   stable — the Rust backend and frontend are coupled by these strings.
10. **Document significant new modules** here in §2 (Source Map) so the next
    contributor knows they exist.
11. If you add new dependencies, add them into README with a link to its
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
