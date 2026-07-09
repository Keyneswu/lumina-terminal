#!/usr/bin/env bash
#
# install.sh — Lumina Terminal one-shot installer
#
#   curl -fsSL https://raw.githubusercontent.com/iewnfod/lumina-terminal/master/install.sh | bash
#   # or to skip the confirmation prompt:
#   curl -fsSL https://raw.githubusercontent.com/iewnfod/lumina-terminal/master/install.sh | bash -s -- -y
#
# Usage: install.sh [-y] [--help]
#   -y, --yes   Skip the confirmation prompt (assume yes)
#   -h, --help  Show this help and exit
#   LUMINA_VERSION=v0.1.1   Pin a specific release tag instead of the latest
#
# Supported platforms:
#   • macOS           — downloads the .dmg and copies the app into /Applications
#   • Debian & derivs — downloads the .deb and installs it (apt pulls deps)
#   • Red Hat / CentOS / Fedora / Rocky / Alma & derivs
#                     — downloads the .rpm and installs it (dnf/yum pulls deps)
#   • Arch & derivs   — repackages the .deb via a generated PKGBUILD (makepkg -si)
# Linux ARM64 (aarch64) is supported on all three Linux paths.
#
# Asset names are read dynamically from the GitHub Releases API, so this keeps
# working even if the product-name punctuation or the tag/version scheme changes.

set -euo pipefail

REPO="iewnfod/lumina-terminal"
APP_NAME="Lumina Terminal"
APP_ID="lumina-terminal"            # binary name inside the package / Icon= key
MAC_APP="Lumina Terminal.app"
ASSUME_YES=0                        # set by -y / --yes

# ---- color helpers ----------------------------------------------------------
if [[ -t 1 ]]; then
	C_RESET=$'\033[0m'; BOLD=$'\033[1m'
	C_RED=$'\033[31m';  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
	C_RESET=""; BOLD=""
	C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

log()  { printf "%s▸%s %s\n"  "$C_CYAN"   "$C_RESET" "$*"; }
warn() { printf "%s▸%s %s%s%s\n" "$C_YELLOW" "$C_RESET" "$C_YELLOW" "$*" "$C_RESET" 1>&2; }
err()  { printf "%s✗%s %s%s%s\n" "$C_RED"    "$C_RESET" "$C_RED"   "$*" "$C_RESET" 1>&2; }
die()  { err "$*"; exit 1; }

# Ask a yes/no question that defaults to YES (Enter = yes). Honors -y.
# Always reads from /dev/tty so it works even when the script body is piped
# via curl (where stdin is the pipe, not the user's terminal). Non-interactive
# callers should pass -y, since there is no TTY to answer from in CI.
confirm_yes() { # <question>
	[[ "$ASSUME_YES" -eq 1 ]] && return 0
	if [[ ! -t 0 && ! -e /dev/tty ]]; then
		die "No TTY available for confirmation. Re-run with -y to auto-confirm."
	fi
	local reply
	read -r -p "$1 [Y/n] " reply </dev/tty
	# empty = yes; anything starting with n/N = no; else yes
	[[ "${reply:-}" =~ ^[Nn] ]] && return 1
	return 0
}

# ---- dependency checks ------------------------------------------------------
need_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "Required command not found: '$1'. Please install it and re-run."
}

ensure_curl() { need_cmd curl; }
ensure_jq_or_py() {
	if command -v jq >/dev/null 2>&1; then return; fi
	if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then return; fi
	die "Neither 'jq' nor 'python' is available — need one to parse the GitHub release API."
}

# ---- GitHub API -------------------------------------------------------------
API_JSON=""

# Resolve the release to install. Honors $LUMINA_VERSION (e.g. "v0.1.1" or
# "v0.1.1-fix"); defaults to the latest published release.
fetch_release() {
	local url
	if [[ -n "${LUMINA_VERSION:-}" ]]; then
		url="https://api.github.com/repos/${REPO}/releases/tags/${LUMINA_VERSION}"
		log "Fetching release ${LUMINA_VERSION}…"
	else
		url="https://api.github.com/repos/${REPO}/releases/latest"
		log "Fetching latest release…"
	fi
	API_JSON="$(curl -fsSL "$url")" || die "Failed to reach GitHub API. Check network / tag name."
	[[ -n "$API_JSON" ]] || die "Empty response from GitHub API."
}

# Pick a value from the release JSON using jq if available, else python.
json_get() { # <jq-path>
	local path="$1"
	if command -v jq >/dev/null 2>&1; then
		jq -r "$path" <<<"$API_JSON"
	else
		python -c '
import json, sys
# strict=False tolerates raw control chars (e.g. \r) that GitHub leaves in
# the release "body" field — jq accepts them, strict-mode python does not.
data = json.load(sys.stdin, strict=False)
p = sys.argv[1].lstrip(".")
val = data
for part in p.replace("[", ".[").split("."):
	if part == "": continue
	if part.startswith("[") and part.endswith("]"):
		val = val[int(part[1:-1])]
	else:
		val = val[part]
print("" if val is None else val)
' "$path" <<<"$API_JSON"
	fi
}

# Return the browser_download_url of the first asset whose name matches a regex.
asset_url() { # <regex>
	local re="$1"
	if command -v jq >/dev/null 2>&1; then
		jq -r --arg re "$re" '.assets[] | select(.name | test($re)) | .browser_download_url' <<<"$API_JSON"
	else
		python -c '
import json, sys, re
data = json.load(sys.stdin, strict=False)
rx = re.compile(sys.argv[1])
for a in data.get("assets", []):
	if rx.search(a.get("name", "")):
		print(a["browser_download_url"])
' "$re" <<<"$API_JSON"
	fi
}

# ---- shared download helper -------------------------------------------------
download() { # <url> <dest>
	curl -fL --retry 3 -o "$2" "$1" || die "Download failed: $1"
}

# ---- Linux architecture mapping ---------------------------------------------
# Asset suffixes differ by ecosystem:
#   • deb filenames use dpkg arch names  → amd64 / arm64
#   • rpm filenames use rpm arch names   → x86_64 / aarch64
#   • pacman PKGBUILD uses Rust-style     → x86_64 / aarch64
#   • macOS dmg uses Rust triple suffix   → x64 / aarch64
# Resolve once from `uname -m` so each installer picks the right asset.
LINUX_DEB_ARCH=""    # amd64 | arm64
LINUX_RPM_ARCH=""    # x86_64 | aarch64
LINUX_PACMAN_ARCH="" # x86_64 | aarch64
resolve_linux_arch() {
	case "$(uname -m)" in
		x86_64)  LINUX_DEB_ARCH="amd64";  LINUX_RPM_ARCH="x86_64";  LINUX_PACMAN_ARCH="x86_64"  ;;
		aarch64|arm64) LINUX_DEB_ARCH="arm64"; LINUX_RPM_ARCH="aarch64"; LINUX_PACMAN_ARCH="aarch64" ;;
		*) die "Unsupported Linux architecture: $(uname -m). Supported: x86_64, aarch64/arm64." ;;
	esac
}

# ============================================================================
#  macOS
# ============================================================================
install_macos() {
	log "Detected ${BOLD}macOS${C_RESET}. Installing from .dmg."

	local arch
	arch="$(uname -m)"
	local dmg_re
	case "$arch" in
		arm64) dmg_re='_aarch64\.dmg$' ;;
		x86_64) dmg_re='_x64\.dmg$' ;;
		*) die "Unsupported macOS architecture: $arch" ;;
	esac

	local dmg_url
	dmg_url="$(asset_url "$dmg_re" | head -n1)"
	[[ -n "$dmg_url" ]] || die "No .dmg asset matching $arch found in the release."

	local tmpdir mountpoint=""
	tmpdir="$(mktemp -d)"
	# tmpdir is captured into the trap string now (set -e may tear down the
	# function frame before EXIT, leaving the local unbound under set -u).
	# mountpoint is set later, so it's evaluated dynamically with a safe default.
	trap "cleanup_macos '$tmpdir' \"\${mountpoint:-}\"" EXIT

	local dmg="$tmpdir/Lumina.dmg"
	log "Downloading $dmg_url"
	download "$dmg_url" "$dmg"

	log "Mounting disk image…"
	mountpoint="$(hdiutil attach -nobrowse -noautoopen "$dmg" | sed -n 's/.*\(\/Volumes\/.*\).*/\1/p' | tail -n1)"
	[[ -n "${mountpoint:-}" ]] || die "Failed to mount the disk image."

	local src="$mountpoint/$MAC_APP"
	[[ -d "$src" ]] || die "$MAC_APP not found inside the mounted disk image."

	local dest="/Applications/$MAC_APP"
	if [[ -d "$dest" ]]; then
		warn "An existing copy exists at $dest — replacing it."
		rm -rf "$dest"
	fi

	log "Copying $MAC_APP to /Applications …"
	cp -R "$src" "$dest"
	xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

	printf "%s✓%s %s installed into /Applications%s\n" "$C_GREEN" "$C_RESET" "$BOLD$APP_NAME$C_RESET" "$C_RESET"
	echo "  Open it from Launchpad, or run:  open -a \"$APP_NAME\""
}

cleanup_macos() { # <tmpdir> <mountpoint>
	if [[ -n "${2:-}" && -d "$2" ]]; then
		hdiutil detach "$2" >/dev/null 2>&1 || true
	fi
	if [[ -n "${1:-}" && -d "$1" ]]; then
		rm -rf "$1" || true
	fi
}

# ============================================================================
#  Debian & derivatives
# ============================================================================
install_debian() {
	log "Detected ${BOLD}Debian-based${C_RESET} Linux (${LINUX_DEB_ARCH}). Installing the .deb."

	local deb_url
	deb_url="$(asset_url "_${LINUX_DEB_ARCH}\.deb\$" | head -n1)"
	[[ -n "$deb_url" ]] || die "No .deb asset for ${LINUX_DEB_ARCH} found in the release."

	local tmpdir
	tmpdir="$(mktemp -d)"
	# Capture the path into the trap string now; see install_arch for rationale.
	trap "rm -rf '$tmpdir'" EXIT

	local deb="$tmpdir/lumina-terminal.deb"
	log "Downloading $deb_url"
	download "$deb_url" "$deb"

	# `apt install ./file.deb` resolves runtime deps automatically (apt >= 1.1).
	# Fall back to dpkg + apt-get -f on older/minimal systems.
	if command -v apt >/dev/null 2>&1; then
		log "Installing with apt (will pull runtime dependencies)…"
		sudo apt install -y "$deb"
	elif command -v apt-get >/dev/null 2>&1; then
		log "Installing with apt-get (will pull runtime dependencies)…"
		sudo apt-get install -y "$deb"
	else
		log "apt not found — using dpkg directly, then fixing dependencies…"
		sudo dpkg -i "$deb" || true
		sudo apt-get install -f -y || warn "Could not auto-resolve dependencies. Run: sudo apt-get install -f"
	fi

	printf "%s✓%s %s installed%s\n" "$C_GREEN" "$C_RESET" "$BOLD$APP_NAME$C_RESET" "$C_RESET"
	echo "  Start it from your application menu, or run:  $APP_ID"
}

# ============================================================================
#  Red Hat, CentOS, Fedora, Rocky, Alma & derivatives
# ============================================================================
install_redhat() {
	log "Detected ${BOLD}RPM-based${C_RESET} Linux (${LINUX_RPM_ARCH}). Installing the .rpm."

	local rpm_url
	rpm_url="$(asset_url "\.${LINUX_RPM_ARCH}\.rpm\$" | head -n1)"
	[[ -n "$rpm_url" ]] || die "No .rpm asset for ${LINUX_RPM_ARCH} found in the release."

	local tmpdir
	tmpdir="$(mktemp -d)"
	# Capture the path into the trap string now; see install_arch for rationale.
	trap "rm -rf '$tmpdir'" EXIT

	local rpm="$tmpdir/lumina-terminal.rpm"
	log "Downloading $rpm_url"
	download "$rpm_url" "$rpm"

	# `dnf install ./file.rpm` (and `yum install ./file.rpm`) resolve runtime
	# deps from enabled repos automatically. Fall back to rpm directly on
	# minimal systems where neither dnf nor yum is present.
	if command -v dnf >/dev/null 2>&1; then
		log "Installing with dnf (will pull runtime dependencies)…"
		sudo dnf install -y "$rpm"
	elif command -v yum >/dev/null 2>&1; then
		log "Installing with yum (will pull runtime dependencies)…"
		sudo yum install -y "$rpm"
	else
		log "dnf/yum not found — using rpm directly; dependencies may be missing…"
		sudo rpm -Uvh --force "$rpm" || warn "rpm install failed. Install webkit2gtk4.1 / gtk3 manually and retry."
	fi

	printf "%s✓%s %s installed%s\n" "$C_GREEN" "$C_RESET" "$BOLD$APP_NAME$C_RESET" "$C_RESET"
	echo "  Start it from your application menu, or run:  $APP_ID"
}

# ============================================================================
#  Arch & derivatives — PKGBUILD repackaging of the .deb
# ============================================================================
install_arch() {
	log "Detected ${BOLD}Arch-based${C_RESET} Linux (${LINUX_PACMAN_ARCH}). Building a pacman package from the .deb."

	# makepkg must run unprivileged and refuses to operate in directories
	# owned by root or with unsafe permissions. Use a clean user-owned dir.
	local workdir
	workdir="$(mktemp -d "${TMPDIR:-/tmp}/lumina-build.XXXXXX")"
	# Capture the path INTO the trap string (expand now) rather than referencing
	# the local var at EXIT time: if a subshell fails under `set -e`, the
	# function frame is already torn down and the local is unbound under `set -u`.
	trap "rm -rf '$workdir'" EXIT
	chmod 755 "$workdir"

	local deb_url deb_name pkgver
	deb_url="$(asset_url "_${LINUX_DEB_ARCH}\.deb\$" | head -n1)"
	deb_name="$(basename "$deb_url")"
	[[ -n "$deb_url" ]] || die "No .deb asset for ${LINUX_DEB_ARCH} found in the release."
	# Package version = the version baked into the deb filename
	# (e.g. Lumina.Terminal_0.1.1_amd64.deb -> 0.1.1), not the git tag,
	# since the tag (v0.1.1-fix) and the app version can differ.
	pkgver="$(printf '%s' "$deb_name" | sed -n "s/.*_\([0-9][^_]*\)_${LINUX_DEB_ARCH}\.deb/\1/p")"
	[[ -n "$pkgver" ]] || pkgver="$(json_get '.tag_name' | sed 's/^v//')"
	log "Package version: $pkgver"

	if ! command -v makepkg >/dev/null 2>&1; then
		die "'makepkg' is missing. Install the build toolchain first:\n    sudo pacman -S --needed base-devel"
	fi
	if ! command -v ar >/dev/null 2>&1; then
		die "'ar' is missing (needed to unpack the .deb). Install:\n    sudo pacman -S --needed binutils"
	fi

	# Generate the PKGBUILD. The .deb ships an already-built binary, the
	# .desktop file, and the hicolor icon, so package() just relocates them.
	cat > "$workdir/PKGBUILD" <<EOF
# Maintainer: auto-generated by install.sh
# Repackages the official Lumina Terminal .deb for pacman.

pkgname=$APP_ID
pkgver=$pkgver
pkgrel=1
pkgdesc="A Tauri App — Lumina Terminal"
arch=('$LINUX_PACMAN_ARCH')
url="https://github.com/$REPO"
license=('MPL-2.0')
# Deb Depends: libwebkit2gtk-4.1-0, libgtk-3-0  ->  translated to Arch:
depends=('webkit2gtk-4.1' 'gtk3' 'hicolor-icon-theme')
provides=('$APP_ID')
conflicts=('$APP_ID')

# Pinned by sha256; install.sh fills _DEB_URL at generation time.
_DEB_URL="$deb_url"
_DEB_NAME="$deb_name"
source=("\${_DEB_URL}")
noextract=("\${_DEB_NAME}")
# sha256 is filled in below by install.sh; 'SKIP' if unavailable.
sha256sums=('${DEB_SHA256:-SKIP}')

build() {
	cd "\$srcdir"
	rm -rf _unpacked
	mkdir _unpacked
	ar x "\${_DEB_NAME}" --output _unpacked
	tar -xf _unpacked/data.tar.* -C _unpacked
}

package() {
	cd "\$srcdir/_unpacked"
	# Binary
	install -Dm0755 "usr/bin/$APP_ID" "\$pkgdir/usr/bin/$APP_ID"
	# Desktop entry
	install -Dm0644 "usr/share/applications/$APP_NAME.desktop" \\
		"\$pkgdir/usr/share/applications/$APP_NAME.desktop"
	# Hicolor icon (deb ships a single high-res PNG; install at all sizes)
	local icon="usr/share/icons/hicolor/5116x5116/apps/$APP_ID.png"
	if [[ -f "\$icon" ]]; then
		local s
		for s in 16 22 24 32 48 64 128 256 512 1024; do
			install -Dm0644 "\$icon" "\$pkgdir/usr/share/icons/hicolor/\${s}x\${s}/apps/$APP_ID.png"
		done
		install -Dm0644 "\$icon" "\$pkgdir/usr/share/icons/hicolor/scalable/apps/$APP_ID.png"
	fi
}
EOF

	# Try to pin the download with its sha256 (best-effort; not fatal).
	local tmpdeb="$workdir/$deb_name"
	if download "$deb_url" "$tmpdeb" 2>/dev/null; then
		DEB_SHA256="$(sha256sum "$tmpdeb" | awk '{print $1}')"
		# Inject the real checksum in place of SKIP.
		# Uses a literal match on the placeholder line.
		sed -i "s/^sha256sums=('SKIP')/sha256sums=('$DEB_SHA256')/" "$workdir/PKGBUILD"
		log "Pinned .deb sha256: $DEB_SHA256"
	else
		warn "Could not pre-download for checksumming; building with sha256=SKIP."
	fi

	( cd "$workdir" && makepkg -si --noconfirm --needed )
	local status=$?
	if [[ $status -ne 0 ]]; then
		die "makepkg failed (exit $status). You can retry in $workdir:\n    cd \"$workdir\" && makepkg -si"
	fi

	printf "%s✓%s %s installed via pacman%s\n" "$C_GREEN" "$C_RESET" "$BOLD$APP_NAME$C_RESET" "$C_RESET"
	echo "  Start it from your application menu, or run:  $APP_ID"
	echo "  Upgrade later by re-running this script; uninstall with:  sudo pacman -R $APP_ID"
}

# ============================================================================
#  Platform detection & dispatch
# ============================================================================
detect_platform() {
	case "$(uname -s)" in
		Darwin) echo "macos" ;;
		Linux)
			if [[ -f /etc/arch-release ]]; then
				echo "arch"
			elif command -v pacman >/dev/null 2>&1 && ! command -v apt >/dev/null 2>&1; then
				# pacman present without apt: EndeavourOS, Manjaro, etc.
				echo "arch"
			elif [[ -f /etc/redhat-release || -f /etc/fedora-release ]] \
				|| { command -v rpm >/dev/null 2>&1 && ! command -v dpkg >/dev/null 2>&1; }; then
				# Red Hat / CentOS / Fedora / Rocky / Alma; rpm present without dpkg.
				echo "redhat"
			elif command -v dpkg >/dev/null 2>&1 || command -v apt-get >/dev/null 2>&1; then
				echo "debian"
			else
				echo "unknown"
			fi
			;;
		*) echo "unknown" ;;
	esac
}

usage() {
	sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
}

main() {
	# ---- argument parsing ----
	while [[ $# -gt 0 ]]; do
		case "$1" in
			-y|--yes) ASSUME_YES=1; shift ;;
			-h|--help) usage; exit 0 ;;
			--) shift; break ;;
			-*) err "Unknown option: $1"; usage; exit 2 ;;
			*) break ;;
		esac
	done

	echo "${BOLD}Lumina Terminal Installer${C_RESET}"
	echo

	ensure_curl
	ensure_jq_or_py

	local platform
	platform="$(detect_platform)"

	# Resolve the Linux deb/pacman arch suffix once for the deb-based paths.
	[[ "$platform" == "debian" || "$platform" == "arch" || "$platform" == "redhat" ]] && resolve_linux_arch

	if [[ "$platform" == "unknown" ]]; then
		cat >&2 <<EOF
${C_RED}Unsupported platform.${C_RESET}
This installer supports:
  • macOS  (.dmg)
  • Debian / Ubuntu and derivatives  (.deb)
  • Red Hat / CentOS / Fedora / Rocky / Alma and derivatives  (.rpm)
  • Arch / Manjaro / EndeavourOS and derivatives  (PKGBUILD from .deb)
EOF
		exit 1
	fi

	# Fetch the release up front so we can show what will be installed and
	# let the user confirm before touching the system.
	case "$platform" in
		macos) need_cmd hdiutil ;;
		arch)  need_cmd makepkg; need_cmd ar ;;
	esac
	fetch_release

	local tag asset_kind target_file
	tag="$(json_get '.tag_name')"
	case "$platform" in
		macos)
			local arch dmg_re
			arch="$(uname -m)"
			case "$arch" in
				arm64) dmg_re='_aarch64\.dmg$' ;;
				x86_64) dmg_re='_x64\.dmg$' ;;
				*) die "Unsupported macOS architecture: $arch" ;;
			esac
			target_file="$(asset_url "$dmg_re" | head -n1 | sed 's#.*/##')"
			asset_kind="disk image"
			;;
		debian)
			target_file="$(asset_url "_${LINUX_DEB_ARCH}\.deb\$" | head -n1 | sed 's#.*/##')"
			asset_kind=".deb package"
			;;
		redhat)
			target_file="$(asset_url "\.${LINUX_RPM_ARCH}\.rpm\$" | head -n1 | sed 's#.*/##')"
			asset_kind=".rpm package"
			;;
		arch)
			target_file="$(asset_url "_${LINUX_DEB_ARCH}\.deb\$" | head -n1 | sed 's#.*/##')"
			asset_kind=".deb → pacman package (rebuilt locally)"
			;;
	esac
	[[ -n "$target_file" ]] || die "No matching release asset found."

	echo "${BOLD}Ready to install:${C_RESET}"
	echo "  ${BOLD}App${C_RESET}      $APP_NAME"
	echo "  ${BOLD}Version${C_RESET}  $tag"
	echo "  ${BOLD}Asset${C_RESET}    $target_file"
	echo "  ${BOLD}Method${C_RESET}   $asset_kind"
	echo

	if ! confirm_yes "Proceed with installation?"; then
		echo "Aborted."
		exit 0
	fi
	echo

	case "$platform" in
		macos) install_macos ;;
		debian) install_debian ;;
		redhat) install_redhat ;;
		arch)   install_arch ;;
	esac
}

main "$@"
