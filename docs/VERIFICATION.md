# Verification scope

Prepared for public source publication on **1 November 2026**. These are technical checks, not a usability-study sample or business-impact measurement.

## This portable source export

- Clean `npm ci --prefix windows` installation completed.
- `npm run prepare:desktop` completed from the relocated shared inputs.
- `npm test`: **141 passes, zero failures, one skipped Windows symlink capability test** (142 cases total).
- The browser demo was run from the repository's actual `npm run demo` command on port 5289. **28 functional checks passed**, including actual media decoding, real timed English captions, subtitle Off, live search, saved-title persistence, timeline previews and playback resume. No external requests or console errors were recorded in that journey.
- The public demo files match the approved portfolio edition byte-for-byte; source packaging did not expand its content.
- Native startup, clean-profile state, existing provider registry, real title details, saving to My List and Settings are checked separately from the browser edition. Loading a metadata page does not establish playable provider availability.
- The public upload is scanned for credential patterns, private workspace paths, unwanted executables and missing local documentation/media links. Generated output, dependencies, private profiles and research folders are excluded from Git.

## Dependency review

`npm audit --omit=dev` reported **zero runtime dependency advisories** on this date. The full development dependency tree reported **15 moderate advisories**, centered on the existing electron-builder packaging dependency chain; no high or critical advisory was reported by that run. These remain documented rather than applying the tool's suggested major-version downgrade without release validation. Review packaging dependencies before producing a public installer release. Audit results are time-sensitive, not a permanent security guarantee.

## Existing Windows review-build evidence

Windows 0.6.6 previously recorded 141 automated passes and 18 packaged content-preference checks in the private development workspace. This repository's portable packaging is verified separately. The historical packaged checks are not a new end-to-end test of an installer built from this export.

External playback limitations remain explicit:

- VidFast returned upstream failures in recorded permitted-sample tests.
- VidLink decoded licensed samples, but tested subtitle-file requests returned HTTP 403.
- CineSrc and Vidly remain existing integrations with title-dependent availability.
- StreamFlix catalogue availability is distinct from its unconnected direct playback host.
- AnimeEmbed is not integrated and its real subtitle rendering remains unverified.
- Listed extension metadata does not establish a working plugin runtime.

No new installer, universal provider-readiness claim, cross-device sync, Mobile release or TV release is included in this source publication. GitHub Actions results, once available, are separate from these local checks.
