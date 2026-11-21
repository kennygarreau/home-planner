#!/bin/sh
# Build wifi-survey-x86_64.AppImage.
#   build.sh fetch <dl_dir>                 download + verify pinned inputs (cacheable)
#   build.sh build <src_dir> <out_dir> <dl_dir>
# Needs: curl, sha256sum, uv (for `uv export`), network access to PyPI.
set -eu

PY_APPIMAGE=python3.12.15-cp312-cp312-manylinux2014_x86_64.AppImage   # glibc >= 2.17
PY_SHA=a6a9bf619a3e21c5623be144d8ac4e458e1a5b5c133b1cc99b142d6e71b82c76
TOOL_VER=1.9.1
TOOL_SHA=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
RUNTIME_VER=20251108
RUNTIME_SHA=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

fetch() {
    dl=$1; mkdir -p "$dl"; cd "$dl"
    get() { # url file sha
        [ -f "$2" ] || curl -fsSL --retry 3 -o "$2" "$1"
        echo "$3  $2" | sha256sum -c -
    }
    get "https://github.com/niess/python-appimage/releases/download/python3.12/$PY_APPIMAGE" python.AppImage "$PY_SHA"
    get "https://github.com/AppImage/appimagetool/releases/download/$TOOL_VER/appimagetool-x86_64.AppImage" appimagetool.AppImage "$TOOL_SHA"
    get "https://github.com/AppImage/type2-runtime/releases/download/$RUNTIME_VER/runtime-x86_64" runtime-x86_64 "$RUNTIME_SHA"
    chmod +x python.AppImage appimagetool.AppImage
}

build() {
    src=$1; out=$2; dl=$3
    here=$(cd "$(dirname "$0")" && pwd)
    work=$(mktemp -d); mkdir -p "$out"
    cp -r "$src" "$work/src"   # source may be read-only
    cd "$work"

    "$dl/python.AppImage" --appimage-extract >/dev/null
    app="$work/squashfs-root"
    py="$app/opt/python3.12/bin/python3.12"

    # Exact dependency versions from uv.lock, then the package itself.
    (cd "$work/src" && uv export --frozen --no-dev --no-emit-project --no-hashes -q -o "$work/requirements.txt")
    "$py" -m pip install --no-cache-dir --disable-pip-version-check -q -r "$work/requirements.txt"
    "$py" -m pip install --no-cache-dir --disable-pip-version-check -q --no-deps "$work/src"

    # Trim what a CLI agent never uses.
    rm -rf "$app/usr/share/tcltk" "$app"/opt/python3.12/lib/python3.12/tkinter \
           "$app"/opt/python3.12/lib/python3.12/idlelib "$app"/opt/python3.12/lib/python3.12/ensurepip \
           "$app"/opt/python3.12/lib/python3.12/lib-dynload/_tkinter* "$app"/opt/python3.12/lib/libtcl* \
           "$app"/opt/python3.12/lib/libtk* "$app"/usr/bin/pip* \
           "$app"/*.desktop "$app"/python.png "$app"/.DirIcon "$app"/AppRun

    cp "$here/AppRun" "$app/AppRun"
    cp "$here/wifi-survey.desktop" "$app/wifi-survey.desktop"
    cp "$here/wifi-survey.svg" "$app/wifi-survey.svg"
    ln -s wifi-survey.svg "$app/.DirIcon"

    "$py" -s -m wifi_survey version >/dev/null   # smoke test inside the AppDir
    version=$("$py" -s -c 'import wifi_survey; print(wifi_survey.__version__)')

    name=wifi-survey-x86_64.AppImage
    ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$dl/appimagetool.AppImage" --no-appstream \
        --runtime-file "$dl/runtime-x86_64" "$app" "$out/$name" >/dev/null
    chmod 755 "$out/$name"

    sha=$(sha256sum "$out/$name" | cut -d' ' -f1)
    size=$(stat -c %s "$out/$name")
    cat > "$out/wifi-survey.json" <<JSON
{
  "name": "wifi-survey",
  "version": "$version",
  "filename": "$name",
  "url": "/downloads/$name",
  "sha256": "$sha",
  "size": $size,
  "arch": "x86_64",
  "python": "3.12.15",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
    rm -rf "$work"
    echo "Built $out/$name ($size bytes, sha256 $sha)"
}

cmd=${1:-}; shift || true
case "$cmd" in
    fetch) fetch "$@" ;;
    build) build "$@" ;;
    *) echo "usage: $0 fetch <dl_dir> | build <src_dir> <out_dir> <dl_dir>" >&2; exit 2 ;;
esac
