Vendored third-party asset — do not edit by hand.
===============================================

Package:      esp-web-tools 10.4.0 (Open Home Foundation)
License:      Apache-2.0 — see LICENSE.Apache-2.0 (redistribution notice included)
Source:       npm registry tarball `esp-web-tools-10.4.0.tgz`
              sha256(tarball) = f18da75335d2f0dca044c4bb052848c0696e7b03cc23d61d8530dd6eba0a9008
Contents:     dist/web/* copied verbatim (26 files, relative imports only)

Why self-hosted (audit W11-2, wave 11 MQTT/TLS supply-chain review)
-------------------------------------------------------------------
The /install page previously loaded the ESP Web Tools web component from
https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module:

  1. "@10" is a FLOATING major — unpkg silently resolves it to the newest
     10.x, so the bytes served can change without any change on our side.
  2. The script had NO Subresource Integrity hash.
  3. SRI alone would NOT have closed the hole: the ?module variant performs
     dynamic `import("./install-dialog-*.js?module")` back to unpkg.com —
     the actual serial-flashing code was fetched from the CDN without any
     integrity check.

ESP Web Tools drives WebSerial and can FLASH FIRMWARE into devices. A
compromised/hijacked CDN response would therefore be arbitrary firmware
code execution on hardware. Self-hosting pins the entire import chain to
this repository (CSP script-src 'self'); upgrades are now an explicit,
reviewable commit.

Upgrade procedure
-----------------
  1. curl -O https://registry.npmjs.org/esp-web-tools/-/esp-web-tools-<VER>.tgz
  2. sha256sum the tarball, extract, copy dist/web/* to a NEW directory
     public/vendor/esp-web-tools/<VER>/ (+ LICENSE.Apache-2.0).
  3. Update this PROVENANCE.md (hash + version), the script src in
     src/app/install/page.tsx, and the version references in README.md.
  4. Verify: load /install, click Connect, confirm the dialog opens from
     same-origin network requests only (no unpkg.com in devtools).

Integrity reference (entry point)
----------------------------------
  install-button.js            sha256 46128e030adf46ce3876ac28ca2103ee842cc50526e49409e8430e3b4c795f79
  install-dialog-im156JnI.js   sha256 6dcfc30fb4bbf18e19a141c5eb9a694edafc5d4480b45762c221173f47effdb5
  index-Dt9w-IG1.js            sha256 1967f0ef76d492c982284c15c48f5c5022a37137786bc16a1e2d012cf69a2166
