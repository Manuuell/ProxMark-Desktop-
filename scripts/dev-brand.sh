#!/usr/bin/env bash
# En desarrollo la app corre dentro del bundle Electron.app de node_modules, así
# que el Dock muestra "Electron" y su icono. Esto renombra ese bundle local y le
# pone nuestro icono. Solo afecta a node_modules (se pierde al reinstalar) y
# nunca falla el arranque: si algo no está, sale sin hacer nada.
set -u

app_name="ProxMark Desktop"
root="$(cd "$(dirname "$0")/.." && pwd)"
bundle="$root/node_modules/electron/dist/Electron.app"
plist="$bundle/Contents/Info.plist"
icns="$root/build/icon.icns"

[ "$(uname)" = "Darwin" ] || exit 0
[ -f "$plist" ] || exit 0

pb=/usr/libexec/PlistBuddy
current="$($pb -c "Print :CFBundleName" "$plist" 2>/dev/null || echo '')"

if [ "$current" != "$app_name" ]; then
  $pb -c "Set :CFBundleName $app_name" "$plist" 2>/dev/null ||
    $pb -c "Add :CFBundleName string $app_name" "$plist" 2>/dev/null
  $pb -c "Set :CFBundleDisplayName $app_name" "$plist" 2>/dev/null ||
    $pb -c "Add :CFBundleDisplayName string $app_name" "$plist" 2>/dev/null
fi

# Icono del bundle de desarrollo (guardamos el original la primera vez).
target="$bundle/Contents/Resources/electron.icns"
if [ -f "$icns" ] && [ -f "$target" ] && ! cmp -s "$icns" "$target"; then
  [ -f "$target.orig" ] || cp "$target" "$target.orig"
  cp "$icns" "$target"
fi

# Refresca LaunchServices para que el Dock no reutilice el icono cacheado.
touch "$bundle" 2>/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$bundle" >/dev/null 2>&1

exit 0
