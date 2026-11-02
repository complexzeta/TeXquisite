# Mac release signing

The tested Mac previews work, but enabled Gatekeeper rejects their ad-hoc signatures. Removing an app's quarantine attribute in a test is not a repair for public distribution. The remaining requirement is an Apple Developer Program membership, a Developer ID Application signing certificate/private key and notarization credentials. No membership or signing secrets were available for this pass.

Apple describes the [signing and notarization process](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution); Electron documents the [membership and certificate prerequisites](https://www.electronjs.org/docs/latest/tutorial/code-signing). Enrollment is a paid account decision for the owner. No enrollment or purchase is performed by the workflow.

## Two separate modes

Use the existing **TeX Live compatibility** workflow on the development branch:

- `mac-release-rehearsal` builds and tests a hardened-runtime Mac package with an explicit ad-hoc signature. It requires no Apple credentials and uploads small reports only. It cannot establish Gatekeeper acceptance or notarization.
- `mac-release-candidate` requires the signing inputs below. Missing inputs fail before Mac runners start. It requires Developer ID signing, notarizes the app, signs/notarizes/staples the DMG, validates tickets and requires Gatekeeper acceptance for both the app and disk image. Functional testing must also pass before candidate artifacts are uploaded. It never publishes a GitHub release automatically.

The normal preview build remains separate. These release modes do not silently fall back to that unsigned preview configuration.

## Secure credential setup

After enrollment, create a protected GitHub environment named `mac-release`. Require owner review and restrict its allowed deployment branches before adding credentials. Configure these environment secrets through GitHub's encrypted secret settings:

| Secret | Required content |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | Base64 of the exported Developer ID Application certificate **and its private key**, in an encrypted PKCS#12 file |
| `MAC_CERTIFICATE_PASSWORD` | Password protecting that PKCS#12 export |
| `MAC_SIGNING_IDENTITY` | Certificate common name, such as `Name (TEAMID)`; the `Developer ID Application:` prefix is also accepted |
| `MAC_NOTARY_KEY_BASE64` | Base64 of a Team App Store Connect API private key (`.p8`) authorized for notarization |
| `MAC_NOTARY_KEY_ID` | That API key's key ID |
| `MAC_NOTARY_ISSUER` | Its issuer ID |

Base64 is an encoding, not encryption. Do not commit these files, upload them as artifacts, or paste passwords/private keys into chat. The workflow writes credential files only into a disposable runner directory, with private permissions, and removes that directory in its cleanup block. Error reports redact configured credential values and private-key blocks. Signing tools use the temporary certificate/key files; credentials are not included in the app or reports.

The production workflow must be run again with real credentials before any signed-release claim can be made. Its Apple service calls, certificate import, Team ID library validation and final notarization have not been exercised by a credential-free rehearsal.

## Runtime policy and verification

Production uses hardened runtime and the JIT entitlement needed by Electron/V8. Its entitlements do not enable debugger attachment, unsigned executable memory or disabled library validation. Developer ID signing is mandatory; a development or ad-hoc identity cannot qualify as a production candidate.

Ad-hoc hardened rehearsals require a separate library-validation exception because their signatures have no Team ID. This exception exists only in `entitlements.mac-rehearsal.plist`. Tests ensure production selects the separate release entitlement file. A successful rehearsal therefore proves the hardened JIT/rendering path, not the certificate-dependent production library-validation policy.

Release verification checks the actual runtime signature and entitlements. The production path additionally checks the Developer ID authority, Apple acceptance of the DMG submission, stapled tickets and Gatekeeper assessments. Asset SHA-256 checksums are calculated after stapling, so they identify the final candidate bytes. Candidate downloads still need the fresh-run installation checks documented in [DESKTOP-PORTABILITY.md](DESKTOP-PORTABILITY.md) before publication.
