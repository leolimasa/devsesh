#!/bin/zsh
# Run on the Mac after `npm run build:mac`: wrap the Secure Enclave helper in a tiny app bundle
# (so it can carry its own provisioning profile; a bare binary is killed by AMFI) and re-sign.
set -e
ID="Apple Development: leo@leo-sa.com (ATA7UD88JS)"
APP=${1:-$HOME/spike/devsesh-spike/app/dist/mac/DevseshSpike.app}
H=$HOME/spike/devsesh-spike/se-helper
HA="$APP/Contents/Helpers/SEHelper.app"
rm -rf "$APP/Contents/Helpers"
mkdir -p "$HA/Contents/MacOS"
cp "$H/se-helper" "$HA/Contents/MacOS/se-helper"
cp "$APP/Contents/embedded.provisionprofile" "$HA/Contents/embedded.provisionprofile"
cat > "$HA/Contents/Info.plist" <<EOP
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>se-helper</string>
<key>CFBundleIdentifier</key><string>com.leosa.devseshspike</string>
<key>CFBundleName</key><string>SEHelper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
</dict></plist>
EOP
codesign --force --options runtime --sign "$ID" --entitlements "$H/helper.entitlements" "$HA"
codesign --force --options runtime --sign "$ID" --entitlements "$HOME/spike/devsesh-spike/app/entitlements.mac.plist" "$APP"
codesign --verify --deep --strict "$APP" && echo "signature ok"
