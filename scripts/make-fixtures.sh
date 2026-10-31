#!/usr/bin/env bash
# Generates synthetic test media into tests/fixtures/media/ using the bundled ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=resources/ffmpeg/linux-x64/ffmpeg
OUT=tests/fixtures/media
mkdir -p "$OUT/day1" "$OUT/day2" "$OUT/music" "$OUT/bench"
Q=(-hide_banner -loglevel error -y)
HLG=(-color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc)

# HEVC 10-bit encoder: NVENC if usable, else libx265
if "$FF" "${Q[@]}" -f lavfi -i testsrc2=s=256x144:d=0.1 -c:v hevc_nvenc -profile:v main10 -pix_fmt p010le -f null - 2>/dev/null; then
  HEVC=(-c:v hevc_nvenc -profile:v main10 -pix_fmt p010le -preset p4 -b:v 40M)
else
  HEVC=(-c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params log-level=error)
fi

hevc4k() { # $1 duration, $2 out, $3 creation time
  "$FF" "${Q[@]}" -f lavfi -i "testsrc2=s=3840x2160:r=120:d=$1" -f lavfi -i "sine=f=330:d=$1" \
    -vf setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc \
    -ac 2 "${HEVC[@]}" "${HLG[@]}" -tag:v hvc1 -c:a aac -shortest -metadata creation_time="$3" "$2"
}

hevc4k 5 "$OUT/day1/hevc_4k120_hlg.mov" 2026-03-01T10:00:00Z
"$FF" "${Q[@]}" -f lavfi -i testsrc2=s=1920x1080:r=30:d=5 -f lavfi -i sine=f=440:d=5 -ac 2 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest -metadata creation_time=2026-03-01T09:00:00Z "$OUT/day1/h264_1080p30.mp4"
"$FF" "${Q[@]}" -f lavfi -i testsrc2=s=1920x1080:r=30:d=3 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -metadata creation_time=2026-03-01T11:00:00Z "$OUT/day1/Tōkyō day 1 'final'.mov"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
"$FF" "${Q[@]}" -f lavfi -i testsrc2=s=1920x1080:r=30:d=3 -f lavfi -i sine=f=550:d=3 -ac 2 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest -metadata creation_time=2026-03-02T08:00:00Z "$TMP/p.mp4"
"$FF" "${Q[@]}" -display_rotation 90 -i "$TMP/p.mp4" -c copy -metadata creation_time=2026-03-02T08:00:00Z "$OUT/day2/portrait_rot90.mp4"
"$FF" "${Q[@]}" -f lavfi -i sine=f=440:d=30 -ac 2 -c:a libmp3lame -b:a 192k "$OUT/music/track_02.mp3"
hevc4k 60 "$OUT/bench/long_4k120.mov" 2026-03-03T12:00:00Z
ls -la "$OUT"/*/
