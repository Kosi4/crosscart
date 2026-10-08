#!/bin/sh
# Cloudflare Pages build: publish only the web app and the files it loads.
# Pages settings: build command `sh scripts/pages-build.sh`, output directory `site`.
set -e
rm -rf site
mkdir site
cp -R web shared fonts icons site/
cp hosting/_headers hosting/_redirects site/
