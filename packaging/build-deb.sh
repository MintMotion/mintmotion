#!/bin/bash
# Genera dist/mintmotion_<versión>_all.deb
set -euo pipefail
VERSION="${1:-1.4.0}"
cd "$(dirname "$0")/.."
ROOT="build/mintmotion_${VERSION}_all"
rm -rf "$ROOT"
make install DESTDIR="$ROOT" PREFIX=/usr >/dev/null
install -Dm644 LICENSE "$ROOT/usr/share/doc/mintmotion/copyright"
mkdir -p "$ROOT/DEBIAN"
SIZE=$(du -sk "$ROOT/usr" | cut -f1)
sed -e "s/@VERSION@/$VERSION/" -e "s/@SIZE@/$SIZE/" packaging/control.in > "$ROOT/DEBIAN/control"
install -m755 packaging/postinst "$ROOT/DEBIAN/postinst"
install -m755 packaging/postrm "$ROOT/DEBIAN/postrm"
find "$ROOT" -type d -exec chmod 755 {} +
mkdir -p dist
dpkg-deb --root-owner-group --build "$ROOT" "dist/mintmotion_${VERSION}_all.deb" >/dev/null
echo "dist/mintmotion_${VERSION}_all.deb"
