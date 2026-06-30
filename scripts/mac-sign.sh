#!/usr/bin/env bash
# mac-sign.sh — 给 JuggleMate.app 做自签名并重新打包成 dmg / zip
#
# 用法：
#   ./scripts/mac-sign.sh           # 默认签 release/mac-arm64/JuggleMate.app
#   ./scripts/mac-sign.sh path/to/Some.app
#
# 第一次跑会建一个 10 年有效期的自签代码签名证书（名字：
# "JuggleMate Self-Signed Code Sign"），存在登录钥匙串里。之后跑就只签名。
#
# 重要：
#   - 自签名 ≠ Apple 信任。对方第一次打开会被 Gatekeeper 拦下，需要
#     右键 → 打开，或去"系统设置 → 隐私与安全"点"仍要打开"。
#   - 彻底解决得用 Apple Developer ID ($99/年) + notarytool 公证。
#     这条路见 docs/mac-distribute.md。

set -eo pipefail

# ---- 路径与常量 ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
CERT_NAME="JuggleMate Self-Signed Code Sign"
CERT_DIR="$HOME/.mac-self-sign-certs"
CERT_KEY="$CERT_DIR/jugglemate-codesign.key"
CERT_CRT="$CERT_DIR/jugglemate-codesign.crt"
OPENSSL_CNF="$SCRIPT_DIR/openssl-codesign.cnf"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

APP_PATH="${1:-$RELEASE_DIR/mac-arm64/JuggleMate.app}"
PRODUCT_NAME="JuggleMate"
VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
ARCH="$(uname -m)"   # arm64 / x86_64

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

# ---- 1. 自签证书：不存在就建，存在就复用 -----------------------------------------
ensure_cert() {
  # 先查钥匙串里有没有这个 identity。
  # 注意：不要用 `security ... | grep`，因为 set -u + pipefail + pipeline
  # 在某些 bash 版本下会把正常变量误判成 unbound，所以先存变量再匹配。
  local existing_ids
  existing_ids="$(security find-identity -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null || true)"
  if [[ "$existing_ids" == *"$CERT_NAME"* ]]; then
    green "✓ 钥匙串里已有 identity: $CERT_NAME"
    return
  fi

  yellow "→ 钥匙串里没找到 $CERT_NAME，开始创建自签证书（一次性操作）"

  mkdir -p "$CERT_DIR"
  chmod 700 "$CERT_DIR"

  # 1.1 生成私钥
  openssl genpkey -algorithm RSA -out "$CERT_KEY" -pkeyopt rsa_keygen_bits:2048 >/dev/null
  chmod 600 "$CERT_KEY"

  # 1.2 用我们写的 openssl.cnf 生成自签证书（含 codeSigning EKU）
  openssl req -new -x509 \
    -key "$CERT_KEY" \
    -out "$CERT_CRT" \
    -days 3650 \
    -config "$OPENSSL_CNF" \
    -extensions v3_code_sign >/dev/null

  # 1.3 导入钥匙串。-A 允许任何应用访问，-T /usr/bin/codesign 让 codesign
  #     不弹密码框（不写这个的话每次 codesign 都会弹窗）
  security import "$CERT_KEY" -k "$LOGIN_KEYCHAIN" -A -T /usr/bin/codesign >/dev/null
  security import "$CERT_CRT" -k "$LOGIN_KEYCHAIN" -A -T /usr/bin/codesign >/dev/null

  green "✓ 证书已生成并导入钥匙串：$CERT_NAME"
  yellow "  私钥：$CERT_KEY"
  yellow "  证书：$CERT_CRT"
  yellow "  注意：私钥别删、别传出去；丢了别人就能用你身份签垃圾软件"
}

# ---- 2. 校验目标 .app 存在 -----------------------------------------------------
validate_app() {
  if [[ ! -d "$APP_PATH" ]]; then
    red "✗ 找不到 .app: $APP_PATH"
    red "  先跑 npm run electron:build 生成 .app，或把路径作为参数传进来"
    exit 1
  fi
  green "✓ 目标 .app: $APP_PATH"
}

# ---- 3. 深层签名 ----------------------------------------------------------------
#   Electron 的 .app 里 Frameworks 下还有一堆 helper（chrome_crashpad_handler、
#   Electron Framework、Helper.app、Squirrel 等），必须按依赖顺序从最深处
#   往外签。Apple 已经废弃 --deep，所以这里手动分层签。
#
#   顺序：
#     1) framework 内部嵌套的可执行（chrome_crashpad_handler 等）
#     2) 所有 .framework bundle
#     3) 所有 helper .app（如 JuggleMate Helper.app）
#     4) 主 .app
sign_app() {
  yellow "→ 开始签名（顺序：内 → 外）"

  # 一份通用 entitlements：放宽 library validation、允许 JIT。
  # 自签名场景下没必要做严格的 sandbox / hardened runtime。
  local entitlements_file
  entitlements_file="$(mktemp -t jugglemate-entitlements.XXXXXX.plist)"
  cat > "$entitlements_file" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
EOF

  # 3.1 先签 framework 内部嵌套的可执行 helper（chrome_crashpad_handler 等）
  #     这些是普通 Mach-O binary，不带 .framework/.app 后缀，所以前面那
  #     两条 find 不会抓到它们，必须单独来。
  while IFS= read -r -d '' bin; do
    if file -b "$bin" 2>/dev/null | grep -q "Mach-O"; then
      printf "  · %s\n" "${bin#$APP_PATH/Contents/}"
      codesign --force --timestamp=none \
        --entitlements "$entitlements_file" \
        --sign "$CERT_NAME" "$bin" 2>/dev/null
    fi
  done < <(find "$APP_PATH/Contents/Frameworks" -type f -print0)

  # 3.2 再签所有 .framework bundle（按字典序）
  while IFS= read -r -d '' fw; do
    printf "  · %s\n" "${fw#$APP_PATH/Contents/}"
    codesign --force --timestamp=none \
      --entitlements "$entitlements_file" \
      --sign "$CERT_NAME" "$fw" 2>/dev/null
  done < <(find "$APP_PATH" -type d -name "*.framework" -print0 | sort -z)

  # 3.3 再签所有 helper .app（按字典序，跳过主 app 自己）
  while IFS= read -r -d '' helper; do
    if [[ "$helper" != "$APP_PATH" ]]; then
      printf "  · %s\n" "${helper#$APP_PATH/Contents/}"
      codesign --force --timestamp=none \
        --entitlements "$entitlements_file" \
        --sign "$CERT_NAME" "$helper" 2>/dev/null
    fi
  done < <(find "$APP_PATH" -type d -name "*.app" -print0 | sort -z)

  # 3.4 最后签主 app
  printf "  · %s\n" "${APP_PATH#$PROJECT_ROOT/}"
  codesign --force --timestamp=none \
    --entitlements "$entitlements_file" \
    --sign "$CERT_NAME" "$APP_PATH" 2>/dev/null

  rm -f "$entitlements_file"
  green "✓ 签名完成"
}

# ---- 4. 校验签名 ---------------------------------------------------------------
verify_signature() {
  yellow "→ 校验签名"
  codesign --verify --verbose=2 "$APP_PATH"
  echo "---"
  codesign -dv --verbose=2 "$APP_PATH" 2>&1 | head -20
  green "✓ 签名校验通过"
}

# ---- 5. 重新打 dmg 和 zip ------------------------------------------------------
repackage() {
  yellow "→ 重新打包 dmg / zip"

  local staged_dir="$RELEASE_DIR/staging"
  local dmg_path="$RELEASE_DIR/${PRODUCT_NAME}-${VERSION}-${ARCH}-mac.dmg"
  local zip_path="$RELEASE_DIR/${PRODUCT_NAME}-${VERSION}-${ARCH}-mac.zip"

  # 5.1 准备 staging：把签好的 .app 拷到一个干净目录
  rm -rf "$staged_dir"
  mkdir -p "$staged_dir"
  cp -R "$APP_PATH" "$staged_dir/"

  # 5.2 打 zip（最简单，用户解压就能用）
  rm -f "$zip_path" "${zip_path}.blockmap"
  (cd "$staged_dir" && zip -r -q -y "$zip_path" "${PRODUCT_NAME}.app")
  green "✓ zip: $zip_path"

  # 5.3 打 dmg
  rm -f "$dmg_path" "${dmg_path}.blockmap"
  local tmp_dmg="${dmg_path%.dmg}-temp.dmg"

  # 5.3.1 用 udif（read-only）格式打一个临时 dmg
  hdiutil create \
    -volname "$PRODUCT_NAME" \
    -srcfolder "$staged_dir" \
    -ov \
    -format UDRO \
    "$tmp_dmg" >/dev/null

  # 5.3.2 转成压缩的 UDZO（最终 dmg）
  hdiutil convert "$tmp_dmg" \
    -format UDZO \
    -o "$dmg_path" \
    -imagekey zlib-level=9 >/dev/null
  rm -f "$tmp_dmg"

  green "✓ dmg: $dmg_path"
  rm -rf "$staged_dir"
}

# ---- main ---------------------------------------------------------------------
echo "=========================================="
echo " JuggleMate mac 自签名脚本"
echo "=========================================="

ensure_cert
validate_app
sign_app
verify_signature
repackage

echo ""
green "✅ 全部搞定。产物："
echo "   $RELEASE_DIR/${PRODUCT_NAME}-${VERSION}-${ARCH}-mac.dmg"
echo "   $RELEASE_DIR/${PRODUCT_NAME}-${VERSION}-${ARCH}-mac.zip"
echo ""
yellow "下一步："
echo "   1. 把 .dmg 或 .zip 发给对方"
echo "   2. 对方装好后第一次打开会被 Gatekeeper 拦下"
echo "      教他们：右键 → 打开，或去'系统设置 → 隐私与安全'点'仍要打开'"
echo "   3. 一次性信任后就不再问了"
echo "   4. 详细文档：docs/mac-distribute.md"