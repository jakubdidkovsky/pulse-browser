#!/usr/bin/env bash
# Installs (or updates) Pulse on Linux, picking the right package for the distro and processor:
#   Debian, Ubuntu, Mint, Pop!_OS…  → .deb via apt
#   Fedora, RHEL, openSUSE…         → .rpm via dnf / zypper
#   anything else, or no sudo       → AppImage unpacked into ~/.local (no root needed)
#
#   curl -fsSL https://raw.githubusercontent.com/jakubdidkovsky/pulse-browser/main/install.sh | bash
#   … | bash -s -- --appimage      install just for you, without sudo
#   … | bash -s -- --uninstall     remove Pulse (your data in ~/.config/Pulse stays)
set -euo pipefail

REPO="${PULSE_REPO:-jakubdidkovsky/pulse-browser}"
BASE="${PULSE_DOWNLOAD_URL:-https://github.com/$REPO/releases/latest/download}"
PKG="pulse-browser"
HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_HOME/$PKG"
BIN_LINK="$HOME/.local/bin/$PKG"
DESKTOP_FILE="$DATA_HOME/applications/$PKG.desktop"
ICON_FILE="$DATA_HOME/icons/hicolor/512x512/apps/$PKG.png"
ONE_LINER="curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s --"

say() { printf '\033[1;35m✦\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

download() { # url file
  if has curl; then curl -fsSL "$1" -o "$2"
  elif has wget; then wget -qO "$2" "$1"
  else die "Install curl or wget first."
  fi
}

fetch() { # url file: with a progress bar; stops the install on failure
  if has curl; then curl -fL --progress-bar "$1" -o "$2"
  elif has wget; then wget -q --show-progress -O "$2" "$1"
  else die "Install curl or wget first."
  fi || die "Download failed: $1
  Is there a published release at https://github.com/$REPO/releases ?"
}

verify() { # file: checks it against the release's SHA256SUMS.txt
  local sums="$TMP/SHA256SUMS.txt" name expected="" hash file
  has sha256sum || return 0
  if ! download "$BASE/SHA256SUMS.txt" "$sums"; then
    say "This release has no checksums; skipping verification."
    return 0
  fi
  name="${1##*/}"
  while read -r hash file; do
    if [ "${file#\*}" = "$name" ]; then expected="$hash"; fi
  done < "$sums"
  [ -n "$expected" ] || die "$name is missing from the release checksums. Please report this."
  echo "$expected  $1" | sha256sum -c --status - || die "The download of $name is damaged (checksum mismatch). Please try again."
}

as_root() { # command…: runs it with sudo when needed
  [ "$SUDO" != "none" ] || die "This needs administrator rights (sudo). To install just for yourself instead, run:
  $ONE_LINER --appimage"
  $SUDO "$@"
}

remove_appimage() {
  rm -rf "$APP_DIR" "$BIN_LINK" "$DESKTOP_FILE" "$ICON_FILE"
  if has update-desktop-database; then update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true; fi
}

uninstall() {
  local removed=0
  if has dpkg && dpkg -s "$PKG" >/dev/null 2>&1; then
    say "Removing the $PKG package…"
    as_root apt-get remove -y "$PKG"
    removed=1
  elif has rpm && rpm -q "$PKG" >/dev/null 2>&1; then
    say "Removing the $PKG package…"
    if has dnf; then as_root dnf remove -y "$PKG"
    elif has zypper; then as_root zypper --non-interactive remove "$PKG"
    else as_root rpm -e "$PKG"
    fi
    removed=1
  fi
  if [ -e "$APP_DIR" ] || [ -e "$DESKTOP_FILE" ]; then
    remove_appimage
    removed=1
  fi
  if [ "$removed" -eq 1 ]; then
    say "Pulse is uninstalled. Your settings and history stay in ~/.config/Pulse (delete that folder to remove them too)."
  else
    say "Pulse isn't installed."
  fi
}

install_appimage() {
  local stage="$APP_DIR.new"
  local file="$stage/Pulse-$APPIMAGE_ARCH.AppImage"
  rm -rf "$stage"
  mkdir -p "$stage"
  # Kept under ~/.local rather than /tmp, which is mounted noexec on some systems.
  fetch "$BASE/Pulse-$APPIMAGE_ARCH.AppImage" "$file"
  verify "$file"
  chmod +x "$file"
  # Unpacked instead of mounted: starts faster and doesn't need FUSE (missing on Ubuntu 24.04+ by default).
  (cd "$stage" && "$file" --appimage-extract >/dev/null) || die "Could not unpack the AppImage."
  rm -rf "$APP_DIR"
  mv "$stage/squashfs-root" "$APP_DIR"
  rm -rf "$stage"

  mkdir -p "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
  ln -sf "$APP_DIR/AppRun" "$BIN_LINK" # AppRun turns the Chromium sandbox off only where the system blocks it
  cp -f "$APP_DIR/$PKG.png" "$ICON_FILE" 2>/dev/null || cp -fL "$APP_DIR/.DirIcon" "$ICON_FILE" 2>/dev/null || true
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Pulse
GenericName=Web Browser
Comment=Browser with a built-in AI agent
Exec="$APP_DIR/AppRun" %U
Icon=$PKG
Terminal=false
Categories=Network;WebBrowser;
Keywords=browser;web;internet;ai;
MimeType=x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Pulse
EOF
  if has update-desktop-database; then update-desktop-database "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true; fi
  LAUNCH="$APP_DIR/AppRun"
}

install_deb() {
  local file="$TMP/Pulse-$DEB_ARCH.deb"
  # A 32-bit system on a 64-bit kernel (e.g. Raspberry Pi OS 32-bit) reports aarch64 but can't run it.
  [ "$(dpkg --print-architecture)" = "$DEB_ARCH" ] || die "Pulse needs a 64-bit system; this one is $(dpkg --print-architecture)."
  fetch "$BASE/Pulse-$DEB_ARCH.deb" "$file"
  verify "$file"
  say "Installing (your password may be needed)…"
  as_root apt-get install -y "$file" || die "Installation failed. To install just for yourself instead, run:
  $ONE_LINER --appimage"
  LAUNCH="/usr/bin/$PKG"
}

install_rpm() {
  local file="$TMP/Pulse-$RPM_ARCH.rpm"
  fetch "$BASE/Pulse-$RPM_ARCH.rpm" "$file"
  verify "$file"
  say "Installing (your password may be needed)…"
  if has dnf; then as_root dnf install -y "$file"
  elif has zypper; then as_root zypper --non-interactive install --allow-unsigned-rpm "$file"
  else as_root yum install -y "$file"
  fi || die "Installation failed. To install just for yourself instead, run:
  $ONE_LINER --appimage"
  LAUNCH="/usr/bin/$PKG"
}

main() {
  local mode="auto"
  for arg in "$@"; do
    case "$arg" in
      --appimage) mode="appimage" ;;
      --uninstall) mode="uninstall" ;;
      -h|--help) printf '%s\n' "Usage: install.sh [--appimage | --uninstall]" \
        "  (no option)   install or update Pulse system-wide (.deb / .rpm), or per-user without sudo" \
        "  --appimage    install just for you into ~/.local, no sudo needed" \
        "  --uninstall   remove Pulse; your data in ~/.config/Pulse stays"; return 0 ;;
      *) die "Unknown option: $arg (see --help)" ;;
    esac
  done

  if [ "$(id -u)" -eq 0 ]; then SUDO=""; elif has sudo; then SUDO="sudo"; else SUDO="none"; fi
  if [ "$mode" = "uninstall" ]; then uninstall; return 0; fi

  [ "$(uname -s)" = "Linux" ] || die "This installer is for Linux. On Windows, get Pulse-Setup-x64.exe from https://github.com/$REPO/releases/latest"
  case "$(uname -m)" in
    # Each package format names the processor its own way.
    x86_64|amd64) ARCH="x64"; APPIMAGE_ARCH="x86_64"; DEB_ARCH="amd64"; RPM_ARCH="x86_64" ;;
    aarch64|arm64) ARCH="arm64"; APPIMAGE_ARCH="arm64"; DEB_ARCH="arm64"; RPM_ARCH="aarch64" ;;
    *) die "Pulse needs a 64-bit Intel/AMD or ARM processor (this one is $(uname -m))." ;;
  esac

  if [ "$mode" = "auto" ]; then
    if [ "$SUDO" = "none" ]; then mode="appimage"
    elif has apt-get && has dpkg; then mode="deb"
    elif has dnf || has zypper || has yum; then mode="rpm"
    else mode="appimage"
    fi
  fi

  TMP="$(mktemp -d)"
  chmod 755 "$TMP" # apt reads the .deb as its own unprivileged user
  trap 'rm -rf "$TMP" "$APP_DIR.new"' EXIT

  say "Installing Pulse ($mode, $ARCH)…"
  "install_$mode"
  # One copy at a time: drop an earlier per-user install once the system package is in.
  if [ "$mode" != "appimage" ] && [ -e "$APP_DIR" ]; then remove_appimage; fi

  say "Done! Open Pulse from your apps menu, or run: $PKG"
  # Not as root: Chromium refuses to run that way, and it would leave root-owned files in the user's profile.
  if [ "$(id -u)" -ne 0 ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ -z "${PULSE_NO_LAUNCH:-}" ] && has setsid; then
    setsid "$LAUNCH" >/dev/null 2>&1 < /dev/null &
  fi
}

# Everything runs from main, so a download cut off halfway (curl | bash) never executes.
main "$@"
