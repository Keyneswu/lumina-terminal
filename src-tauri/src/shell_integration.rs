//! Shell-integration injection: makes bash/zsh/fish emit OSC 1337 sequences
//! around each command so Lumina can capture per-command text (preexec) and
//! exit codes (precmd). See `src/lib/currentCommand.ts` for the frontend parser
//! and `state.rs::CommandHistoryEntry` for where they're stored.
//!
//! Per shell:
//!  - **bash**: no native preexec (`trap DEBUG` is noisy and fires inside
//!    functions), so we inject ONLY precmd (the exit code). Command text still
//!    comes from `/proc` on the backend. A login shell ignores `--init-file`,
//!    so we drop `-l` and simulate the login sequence inside the init file.
//!  - **zsh**: native `preexec_functions` / `precmd_functions`. Injected via a
//!    temporary `ZDOTDIR` whose startup files source the user's real ones
//!    first, so the full zsh startup is preserved.
//!  - **fish**: native `fish_preexec` / `fish_prompt` events, injected via `-C`.
//!
//! nu / pwsh / plain sh / SSH are NOT injected — they fall back to `/proc`
//! (command name only, no per-command exit code).
//!
//! All sequences use BEL (`\007`) as the string terminator; the frontend parser
//! accepts BEL or ESC\, and BEL is one byte simpler to emit portably.

use std::path::PathBuf;

use portable_pty::CommandBuilder;
use tauri::{AppHandle, Manager};

/// Bash init script, sourced via `bash -i --init-file <this>`.
const BASH_INIT: &str = r#"# Lumina shell integration (bash). Sourced via `bash -i --init-file <this>`.
# A login shell ignores --init-file, so Lumina drops -l and we simulate the
# login sequence here (the same files bash -l reads), then the interactive rc,
# then a precmd hook reporting the previous command's exit code. No preexec
# (bash has none natively; command text comes from /proc on the backend).
if [ -r /etc/profile ]; then source /etc/profile; fi
for __lumina_pf in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [ -r "$__lumina_pf" ]; then source "$__lumina_pf"; break; fi
done
unset __lumina_pf
if [ -r "$HOME/.bashrc" ]; then source "$HOME/.bashrc"; fi
__lumina_precmd() {
    local __lumina_code=$?
    builtin printf '\033]1337;CurrentCommandExit=%s\007' "$__lumina_code"
    return "$__lumina_code"
}
case " ${PROMPT_COMMAND:-} " in
    *"__lumina_precmd"*) ;;
    *) PROMPT_COMMAND="__lumina_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
"#;

/// zsh `.zshrc` (lives in the temp ZDOTDIR, so it REPLACES the user's — we
/// source their real rc first, then install hooks).
const ZSH_INIT: &str = r#"# Lumina shell integration (zsh). This .zshrc lives in a ZDOTDIR Lumina sets,
# so it REPLACES the user's — source their real rc first, then add hooks.
if [ -r "$HOME/.zshrc" ]; then source "$HOME/.zshrc"; fi
lumina_preexec() { printf '\033]1337;CurrentCommand=%s\007' "$1"; }
lumina_precmd() { printf '\033]1337;CurrentCommandExit=%s\007' "$?"; }
preexec_functions+=(lumina_preexec)
precmd_functions+=(lumina_precmd)
"#;

const ZSH_ENV: &str = r#"[ -r "$HOME/.zshenv" ] && source "$HOME/.zshenv""#;
const ZSH_PROFILE: &str = r#"[ -r "$HOME/.zprofile" ] && source "$HOME/.zprofile""#;
const ZSH_LOGIN: &str = r#"[ -r "$HOME/.zlogin" ] && source "$HOME/.zlogin""#;

/// fish preexec hook (passed via `fish -C`).
const FISH_PREEXEC: &str = r#"function __lumina_preexec --on-event fish_preexec; printf '\033]1337;CurrentCommand=%s\007' $argv[1]; end"#;
/// fish precmd hook (passed via `fish -C`).
const FISH_PRECMD: &str = r#"function __lumina_precmd --on-event fish_prompt; printf '\033]1337;CurrentCommandExit=%s\007' $status; end"#;

/// Resolve (creating) the per-app shell-integration dir under app data.
fn integration_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("lumina-shell-integration");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Write `content` to `path`, overwriting. Content is constant and tiny, so we
/// rewrite each launch rather than tracking freshness — avoids stale-file bugs
/// if the script changes between versions.
fn write_script(path: &PathBuf, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| {
        log::warn!("Failed to write shell-integration {}: {}", path.display(), e);
        format!("write {}", path.display())
    })
}

/// Apply shell-integration argv/env to an interactive shell `CommandBuilder`,
/// based on the (lowercased) shell basename. Falls back to the standard
/// `--login -i` for unsupported shells or if writing the init files fails — so
/// the terminal always works, just without per-command exit codes for that tab.
pub fn apply_interactive(c: &mut CommandBuilder, shell_base: &str, app: &AppHandle) {
    if shell_base == "bash" {
        if let Ok(dir) = integration_dir(app) {
            let path = dir.join("lumina.bash");
            if write_script(&path, BASH_INIT).is_ok() {
                // Drop -l: a login shell ignores --init-file, and the init
                // file simulates the login sequence itself.
                c.args(["-i", "--init-file"]);
                c.arg(path.to_string_lossy().into_owned());
                return;
            }
        }
    } else if shell_base == "zsh" {
        if let Ok(dir) = integration_dir(app) {
            let zdir = dir.join("zsh");
            if std::fs::create_dir_all(&zdir).is_ok()
                && write_script(&zdir.join(".zshenv"), ZSH_ENV).is_ok()
                && write_script(&zdir.join(".zshrc"), ZSH_INIT).is_ok()
                && write_script(&zdir.join(".zprofile"), ZSH_PROFILE).is_ok()
                && write_script(&zdir.join(".zlogin"), ZSH_LOGIN).is_ok()
            {
                c.env("ZDOTDIR", zdir.to_string_lossy().into_owned());
                c.args(["--login", "-i"]);
                return;
            }
        }
    } else if shell_base == "fish" {
        // No init file needed — fish runs -C commands before the first prompt.
        c.args(["--login", "-i", "-C", FISH_PREEXEC, "-C", FISH_PRECMD]);
        return;
    }
    // Fallback (nu/pwsh/sh/… or init-file write failure): plain login shell.
    c.args(["--login", "-i"]);
}
