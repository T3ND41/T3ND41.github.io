#!/usr/bin/env bash
# Compile and run the Hanekom product image pipeline with the vendored jars in lib/.
# No Maven/Gradle needed - a JDK (javac) and a JRE (java) are enough.
#
#   tools/image-optimizer/run.sh                # convert assets/cat
#   tools/image-optimizer/run.sh assets/img     # convert another folder
#   tools/image-optimizer/run.sh --report-only  # dry run
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v java >/dev/null 2>&1; then
  echo "java not found on PATH. Install a JDK 11+ (e.g. Temurin 21)." >&2
  exit 1
fi
if ! command -v javac >/dev/null 2>&1; then
  # A JRE-only install still works if JAVA_HOME points at a full JDK.
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
    JAVAC="$JAVA_HOME/bin/javac"; JAVA_BIN="$JAVA_HOME/bin/java"
  else
    echo "javac not found. Install the full JDK (Temurin 21 recommended)." >&2
    exit 1
  fi
else
  JAVAC="$(command -v javac)"; JAVA_BIN="$(command -v java)"
fi

CP="$(printf '%s:' "$DIR"/lib/*.jar)"
BUILD="$DIR/build"
mkdir -p "$BUILD"

"$JAVAC" -encoding UTF-8 -cp "$CP" -d "$BUILD" \
  "$DIR"/src/main/java/com/hanekom/images/*.java

exec "$JAVA_BIN" -cp "$CP$BUILD" com.hanekom.images.BatchConvert "$@"
