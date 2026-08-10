# Contributing to Lumina Terminal

Thanks for your interest in contributing! This guide covers getting the project
running locally and the conventions every change should follow.

The full architecture, source map, and contributor rules live in
[**AGENTS.md**](./AGENTS.md). Read it before making non-trivial changes — it is
the source of truth for how the codebase is layered and where things belong.

## Prerequisites

| Tool | Why |
|------|-----|
| [Rust](https://rust-lang.org/) (stable) | Backend (`src-tauri/`) |
| [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/) | Frontend (`src/`) |
| Tauri v2 system dependencies | See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS |

## Getting Started

```shell
git clone https://github.com/iewnfod/lumina-terminal.git
cd lumina-terminal
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` builds the Rust backend and launches the Vite dev server inside
a Tauri window. The frontend hot-reloads on change.

## Verifying Changes

The TypeScript config is strict (`noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`). Before pushing, run:

```shell
pnpm build
```

Unused imports/vars and type errors will fail the build — treat it as your
guardrail.

## Code Standards (summary)

These are the everyday rules; **AGENTS.md §3–§4** has the rationale and the
complete list.

- **Respect the layering** — `types ← lib ← hooks ← components/pages ← App`.
  Pure logic goes in `lib/`, React-aware logic in `hooks/`, JSX in `components/`.
  Never import `components/` from `lib/` or `hooks/`.
- **No duplication** — grep for existing logic before writing new. Reuse
  `lib/platform.ts`, `lib/color.ts`, `lib/glass.ts`, `lib/motion.ts`,
  `lib/terminalApi.ts`, `components/ui/IconButton.tsx`, etc., rather than
  re-rolling them. If you're about to copy >10 lines, extract.
- **One source of truth per concern** — new backend command → wrap it in
  `lib/terminalApi.ts` (or a `lib/<domain>Api.ts`); new shared derived value →
  make it a hook in `hooks/`.
- **Props over re-derivation** — if a value is already computed in a parent
  (theme, maximize, padding, parsed bindings), pass it down.
- **Every async op and error path must log** — use the plugin logger
  (`@tauri-apps/plugin-log` in the frontend; `log::{debug,info,warn,error}` in
  Rust), never `console.*` or bare `.expect()` / `.then()` without a `.catch`.
  See AGENTS.md §3.6.
- **Match existing style** — tabs for indentation, explicit `.ts` extensions in
  relative imports, double quotes for JSX attribute strings where the file
  already uses them.
- **No dead code** — if you remove the last consumer of a file, delete the file.
- **Behavior-preserving refactors only** unless explicitly asked. Keep backend
  command/event names (`term-write-${id}`, `term-exit-${id}`) stable — the Rust
  and frontend layers are coupled by these strings.
- **Document significant new modules** in AGENTS.md §2 (Source Map).

## Adding an App Icon

When a recognized TUI/CLI app is running in a tab, Lumina shows its brand icon
instead of the shell icon. The icon registry is data-driven — adding one takes
two steps and no component changes.

1. Drop the app's SVG file(s) under `src/assets/app-icons/<id>/`. The `id` is
   the directory name (e.g. `vim`). Pick a variant based on what background the
   icon sits on (not the logo's own tone):
   - `<id>-light.svg` — for **light** backgrounds (logo itself tends dark)
   - `<id>-dark.svg` — for **dark** backgrounds (logo itself tends light)
   - `<id>.svg` — neutral single-color variant, used when a dedicated
     light/dark file is missing. A monochrome logo can ship just this one file.

   A colored brand logo usually ships a light/dark pair; a monochrome icon can
   ship a single `<id>.svg`. Missing variants fall back gracefully.
2. Register the command name → icon id in `APP_COMMANDS` in
   [`src/lib/appIcon.ts`](src/lib/appIcon.ts):
   ```ts
   const APP_COMMANDS: Record<string, AppIconId> = {
       opencode: "opencode",
       vim: "vim",          // ← command basename → icon id (directory name)
   };
   ```
   The key is the command's argv[0] basename (lowercase), as reported by the
   shell or the process tracker. Wrappers (`sudo`, `env`, `nohup`, ...) are
   skipped automatically, so `sudo vim` resolves to the vim icon.

Then `pnpm build` (or `pnpm tauri dev`) — the icon is picked up at build time
and shown whenever that command is foreground in a tab, including when it is the
profile's startup command.

## Adding Dependencies

If you add a new dependency, add it to the list in
[README.md](./README.md#technology-used) (and `README_zh.md`) with a link to its
official website or repo (per AGENTS.md §4.12).
