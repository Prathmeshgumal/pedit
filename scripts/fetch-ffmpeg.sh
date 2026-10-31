#!/usr/bin/env bash
# Downloads a static GPL ffmpeg/ffprobe build (BtbN FFmpeg-Builds) into resources/ffmpeg/<platform>-<arch>/
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=resources/ffmpeg/linux-x64
URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz"
mkdir -p "$DEST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fL --retry 3 -o "$TMP/ff.tar.xz" "$URL"
tar -xJf "$TMP/ff.tar.xz" -C "$TMP"
cp "$TMP"/ffmpeg-*/bin/ffmpeg "$TMP"/ffmpeg-*/bin/ffprobe "$DEST/"
chmod +x "$DEST/ffmpeg" "$DEST/ffprobe"
"$DEST/ffmpeg" -hide_banner -version | head -1
