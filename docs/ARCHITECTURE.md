# PC source edition

The original development workspace had shared build inputs inside the Android project. This export preserves those source-owned helpers under `shared/` so the PC application builds without an Android SDK or a separate Mobile/TV build.

## Packaging differences from the installed review app

- The source app uses a separate `VPlus-Source` user-data folder.
- `windows/prepare.mjs` copies explicit shared inputs and builds the same desktop player core. It does not build an Android player or copy downloaded engines.
- `windows/player/build.mjs` reads the playback core from its relocated shared path. The player logic is preserved.
- Node unit tests resolve jsdom from the PC dependency installation rather than a sibling Android installation.
- The seed catalogue keeps existing numeric title identities. When the fallback contains a verified IMDb identity, artwork uses the existing metadata image service. Missing identifiers do not become invented image URLs.
- Standalone commercial artwork and fallback cast photographs are omitted. Live metadata can supply artwork; empty artwork is handled by the renderer.
- Optional TMDB environment-token handling does not discover the original developer’s private local credential file.
- The optional CS3 interface remains source only. Missing engine prerequisites produce an unavailable state; no inventory count is presented as proof of working providers.

## Data boundaries

The Windows host saves library/preferences locally and validates renderer requests. External player frames retain their own documented capabilities and failure modes. The public browser demo replaces that native transport with a small, local catalogue and bundled licensed media. It has no live commercial catalogue or third-party player frames.

No complete development history, private profile, API token, unpublished research result, signing key or installed application directory was copied into this repository.
