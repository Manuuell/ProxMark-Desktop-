#!/usr/bin/env bash
# Genera los iconos de la app a partir de build/icon.svg (solo macOS: usa
# qlmanage para rasterizar el SVG, sips para escalar e iconutil para el .icns).
#   ./scripts/make-icons.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
build="$root/build"
svg="$build/icon.svg"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1) Master PNG 1024. Fuente: build/icon.svg, o build/icon-master.png si
#    prefieres partir de un PNG ya hecho (p. ej. un logo oficial).
if [ -f "$svg" ]; then
  qlmanage -t -s 1024 -o "$tmp" "$svg" >/dev/null 2>&1
  master="$tmp/icon.svg.png"
  [ -f "$master" ] || { echo "qlmanage no pudo rasterizar el SVG"; exit 1; }
elif [ -f "$build/icon-master.png" ]; then
  master="$tmp/master.png"
  sips -Z 1024 "$build/icon-master.png" --out "$master" >/dev/null
else
  echo "falta build/icon.svg (o build/icon-master.png)"
  exit 1
fi
cp "$master" "$build/icon.png"

# 2) PNGs sueltos (Linux/Windows y dock en desarrollo)
mkdir -p "$build/icons"
for s in 16 32 64 128 256 512; do
  sips -Z "$s" "$master" --out "$build/icons/${s}x${s}.png" >/dev/null
done
cp "$master" "$build/icons/1024x1024.png"

# 3) .icns para el empaquetado en macOS
set="$tmp/icon.iconset"
mkdir -p "$set"
for s in 16 32 128 256 512; do
  sips -Z "$s" "$master" --out "$set/icon_${s}x${s}.png" >/dev/null
  sips -Z "$((s * 2))" "$master" --out "$set/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o "$build/icon.icns"

echo "ok: build/icon.png, build/icons/*.png, build/icon.icns"
