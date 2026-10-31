#!/usr/bin/env bash
# Downloads the bundled fonts (all SIL Open Font License / Apache, from Google Fonts) into resources/fonts
# and writes resources/fonts/fonts.json. Re-run to refresh. Inter is kept as-is.
set -euo pipefail
cd "$(dirname "$0")/../resources/fonts"
FAMILIES=(
  "Montserrat|sans" "Poppins|sans" "Roboto|sans" "Lato|sans" "Raleway|sans" "Nunito|sans" "Rubik|sans" "Space Grotesk|sans"
  "Oswald|display" "Bebas Neue|display" "Anton|display" "Archivo Black|display" "Teko|display" "Bangers|display" "Luckiest Guy|display" "Righteous|display" "Abril Fatface|display"
  "Playfair Display|serif" "Merriweather|serif"
  "Lobster|script" "Pacifico|script" "Dancing Script|script" "Satisfy|script" "Caveat|handwriting" "Permanent Marker|handwriting" "Kalam|handwriting"
  "Noto Sans Devanagari|sans" "Space Mono|mono"
)
json='[{"family":"Inter","category":"sans","faces":{"400":"Inter-Regular.ttf","700":"Inter-Bold.ttf"}}'
for entry in "${FAMILIES[@]}"; do
  fam="${entry%%|*}"; cat="${entry##*|}"; q="${fam// /+}"; slug="${fam// /}"
  css=$(curl -sf "https://fonts.googleapis.com/css2?family=${q}:wght@400;700" || curl -sf "https://fonts.googleapis.com/css2?family=${q}")
  faces=""
  while read -r w url; do
    f="${slug}-${w}.ttf"; curl -sf -o "$f" "$url"
    faces+="${faces:+,}\"$w\":\"$f\""
  done < <(echo "$css" | sed -nE 's/.*font-weight: ([0-9]+);.*/\1/p; s/.*src: url\(([^)]*)\).*/\1/p' | paste -d' ' - -)
  json+=",{\"family\":\"$fam\",\"category\":\"$cat\",\"faces\":{$faces}}"
  echo "$fam: $faces"
done
echo "$json]" > fonts.json
