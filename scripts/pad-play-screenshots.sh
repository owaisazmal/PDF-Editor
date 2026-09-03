#!/bin/sh
# Copyright (c) 2026 Owais Khan
# Licensed under the Apache License, Version 2.0
#
# Pads Android captures to the widest aspect ratio Google Play accepts.
#
# Play rejects any screenshot whose longest side is more than twice its shortest. A modern
# phone is taller than that: the emulator this project captures on is 1080x2400, a ratio of
# 2.222, so every Android screenshot in the repository would have been refused at upload.
# There is nothing wrong with the captures; the store simply predates tall phones.
#
# Padding rather than cropping, because cropping a screenshot removes app. The pad colour is
# the canvas colour from src/theme/tokens.ts, so the added bars read as part of the design
# rather than as letterboxing.
#
# Usage: sh scripts/pad-play-screenshots.sh
set -e

DIR="store/screenshots/android"
PAD="FDFBD4"

for file in "$DIR"/*.png; do
  case "$file" in *-play.png) continue;; esac

  width=$(sips -g pixelWidth "$file" | awk '/pixelWidth/{print $2}')
  height=$(sips -g pixelHeight "$file" | awk '/pixelHeight/{print $2}')

  # The narrowest width that brings the ratio to exactly 2:1, rounded up to stay inside it.
  target=$(( (height + 1) / 2 ))
  if [ "$width" -ge "$target" ]; then
    echo "  $file is already within 2:1, left alone"
    continue
  fi

  out="${file%.png}-play.png"
  sips -p "$height" "$target" --padColor "$PAD" "$file" --out "$out" >/dev/null
  echo "  $(basename "$file") ${width}x${height} -> $(basename "$out") ${target}x${height}"
done
