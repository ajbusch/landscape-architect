#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -rf nodejs
mkdir -p nodejs
cd nodejs
npm init -y --silent
# Install sharp core without optional platform binaries or audit
npm install --no-audit --omit=optional sharp --silent
# Force-install only the ARM64 native binaries needed by Lambda
npm install --no-audit --force @img/sharp-linux-arm64 @img/sharp-libvips-linux-arm64 --silent
# Remove host-platform binaries that npm auto-installed (not needed in Lambda)
rm -rf node_modules/@img/sharp-linux-x64 \
       node_modules/@img/sharp-libvips-linux-x64 \
       node_modules/@img/sharp-libvips-linuxmusl-x64 \
       node_modules/@img/sharp-linuxmusl-x64
cd ..
echo "Sharp layer built successfully"
