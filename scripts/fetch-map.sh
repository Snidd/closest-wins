#!/usr/bin/env bash
# Produces the self-hosted world basemap: ${DATA_DIR:-./data}/map/world.pmtiles
#
#   scripts/fetch-map.sh            # skip if the file already exists
#   FORCE=1 scripts/fetch-map.sh    # rebuild
#   BUILD=20261115 MAXZOOM=7 scripts/fetch-map.sh
#
# 1. Downloads the go-pmtiles CLI (a single static binary, no sudo) into data/tools/.
# 2. Finds the newest Protomaps daily planet build (https://build.protomaps.com/, listed in
#    https://build-metadata.protomaps.dev/builds.json) unless BUILD is set.
# 3. `pmtiles extract` the whole world up to MAXZOOM (default 8, matching TILE_MAX_ZOOM in
#    src/lib/map/config.ts) over HTTP Range requests; only the needed tiles are downloaded
#    (the planet file is ~140 GB; z0-8 is ~560 MB, z0-9 ~1.6 GB). Cached in data/map/.cache/.
# 4. scripts/map/strip-tiles.ts keeps only the layers/attributes our labels-free style draws
#    (earth, water, landcover, country boundaries; no labels, roads, POIs, buildings) and
#    writes MBTiles; `pmtiles convert` makes a clustered, deduplicated PMTiles archive again.
#    z0-8 shrinks from ~560 MB to ~118 MB, z0-9 would be ~345 MB.
#    It also bakes in a `rivers` line layer from Natural Earth 10m rivers (Protomaps only has
#    river lines from z9 on), downloaded from the natural-earth-vector GitHub repository.
# 5. Checks that the vector layers our style uses are present, then moves the file into place.
#    KEEP_RAW=1 keeps the raw extract in the cache (otherwise it is deleted on success).
#
# Data: (c) OpenStreetMap contributors (ODbL, attribution required), Natural Earth (public
# domain) for low zooms and the rivers, packaged by Protomaps (basemap schema v4,
# https://docs.protomaps.com/basemaps/layers). The map components show
# "© OpenStreetMap · Protomaps" unobtrusively in a corner (ATTRIBUTION_HTML in config.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-data}"
DATA_DIR="${DATA_DIR#./}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$ROOT/$DATA_DIR" ;; esac
OUT_DIR="$DATA_DIR/map"
OUT="$OUT_DIR/world.pmtiles"
TOOLS_DIR="$ROOT/data/tools"
PMTILES_VERSION="${PMTILES_VERSION:-1.31.2}"
MAXZOOM="${MAXZOOM:-8}"
BUILD="${BUILD:-}"
FORCE="${FORCE:-0}"
KEEP_RAW="${KEEP_RAW:-0}"
REQUIRED_LAYERS=(earth water boundaries landcover rivers)
RIVERS_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson"

log() { printf '\033[1m[fetch-map]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[fetch-map] %s\033[0m\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v node >/dev/null || die "node (22+) is required"
[[ -d "$ROOT/node_modules/pmtiles" ]] || die "run pnpm install first (needs the pmtiles package)"

# ------------------------------------------------------------------------------------------
# pmtiles CLI
# ------------------------------------------------------------------------------------------
PMTILES="$TOOLS_DIR/pmtiles-$PMTILES_VERSION"
if [[ ! -x "$PMTILES" ]]; then
	os="$(uname -s)"
	arch="$(uname -m)"
	case "$arch" in
		x86_64 | amd64) arch=x86_64 ;;
		aarch64 | arm64) arch=arm64 ;;
		*) die "unsupported architecture: $arch" ;;
	esac
	case "$os" in
		Linux) asset="go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz" ;;
		Darwin) asset="go-pmtiles-${PMTILES_VERSION}_Darwin_${arch}.zip" ;;
		*) die "unsupported OS: $os" ;;
	esac
	url="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${asset}"
	log "downloading pmtiles CLI $PMTILES_VERSION ($asset)"
	mkdir -p "$TOOLS_DIR"
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT
	curl -fsSL --retry 3 -o "$tmp/$asset" "$url"
	case "$asset" in
		*.tar.gz) tar -xzf "$tmp/$asset" -C "$tmp" pmtiles ;;
		*.zip) (cd "$tmp" && unzip -q "$asset" pmtiles) ;;
	esac
	install -m 0755 "$tmp/pmtiles" "$PMTILES"
	rm -rf "$tmp"
	trap - EXIT
fi
log "pmtiles CLI: $("$PMTILES" version 2>/dev/null | head -n1 || echo "$PMTILES")"

# ------------------------------------------------------------------------------------------
# Skip if done
# ------------------------------------------------------------------------------------------
if [[ -s "$OUT" && "$FORCE" != "1" ]]; then
	log "$OUT already exists ($(du -h "$OUT" | cut -f1)); FORCE=1 to rebuild"
	"$PMTILES" show "$OUT" 2>/dev/null | grep -E '^(max zoom|tile type|planetiler:osm:osmosistime|version)' >&2 || true
	exit 0
fi

# ------------------------------------------------------------------------------------------
# Pick the build
# ------------------------------------------------------------------------------------------
if [[ -z "$BUILD" ]]; then
	log "looking up the newest Protomaps daily build"
	BUILD="$(curl -fsSL --retry 3 https://build-metadata.protomaps.dev/builds.json |
		grep -oE '"key": *"[0-9]{8}\.pmtiles"' | grep -oE '[0-9]{8}' | sort | tail -n1)"
	[[ -n "$BUILD" ]] || die "could not determine the latest build; set BUILD=YYYYMMDD"
fi
SOURCE="https://build.protomaps.com/${BUILD}.pmtiles"
log "source: $SOURCE (max zoom $MAXZOOM)"

# ------------------------------------------------------------------------------------------
# Extract (raw, all layers) → strip → convert
# ------------------------------------------------------------------------------------------
CACHE="$OUT_DIR/.cache"
mkdir -p "$CACHE"
RAW="$CACHE/protomaps-${BUILD}-z${MAXZOOM}.pmtiles"
if [[ -s "$RAW" ]]; then
	log "reusing raw extract $RAW"
else
	"$PMTILES" extract "$SOURCE" "$RAW.part" --maxzoom="$MAXZOOM" --download-threads=8
	mv -f "$RAW.part" "$RAW"
fi
log "raw extract: $(du -h "$RAW" | cut -f1); stripping unused layers"

RIVERS="$CACHE/ne_10m_rivers_lake_centerlines.geojson"
if [[ ! -s "$RIVERS" ]]; then
	log "downloading Natural Earth rivers"
	curl -fsSL --retry 3 -o "$RIVERS.part" "$RIVERS_URL"
	mv -f "$RIVERS.part" "$RIVERS"
fi

MBT="$CACHE/stripped.mbtiles"
node "$ROOT/scripts/map/strip-tiles.ts" "$RAW" "$MBT" "$RIVERS"
PART="$CACHE/world.pmtiles.part"
rm -f "$PART"
"$PMTILES" convert "$MBT" "$PART" --tmpdir="$CACHE" --quiet
rm -f "$MBT"

# ------------------------------------------------------------------------------------------
# Verify the schema our style relies on
# ------------------------------------------------------------------------------------------
"$PMTILES" verify "$PART" >/dev/null || die "pmtiles verify failed for $PART"
meta="$("$PMTILES" show "$PART" --metadata)"
for layer in "${REQUIRED_LAYERS[@]}"; do
	grep -qE "\"id\": *\"$layer\"" <<<"$meta" || die "layer '$layer' missing (Protomaps schema changed?)"
done
schema="$(grep -oE '"version": *"[0-9.]+"' <<<"$meta" | head -n1 || true)"
log "basemap schema $schema; layers OK: ${REQUIRED_LAYERS[*]}"

mv -f "$PART" "$OUT"
[[ "$KEEP_RAW" == "1" ]] || rm -f "$RAW"
log "wrote $OUT ($(du -h "$OUT" | cut -f1)) from build $BUILD, max zoom $MAXZOOM"
