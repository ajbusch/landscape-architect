#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -rf nodejs
mkdir -p nodejs
cd nodejs
npm init -y --silent
# TODO: npm --platform/--arch flags don't filter optional deps, so all platform
# binaries (~100MB) get downloaded instead of just linux-arm64 (~10MB). Optimize
# by pruning unwanted @img/sharp-* dirs after install, or using a targeted
# `npm install @img/sharp-linux-arm64` approach instead.
npm install --platform=linux --arch=arm64 sharp --silent
cd ..
echo "Sharp layer built successfully"
