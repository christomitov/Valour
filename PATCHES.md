# Local patches (`sauce`)

`sauce` tracks upstream releases and carries the patches this instance needs.
It is based on `v0.9.20`. `main` stays a plain mirror of `valour-software/valour`.

## Build

Release builds need the licensed Village atlas, which upstream CI restores
before compiling:

```
python3 Tools/Villages/restore-release-assets.py
docker build --build-arg SHORTHASH=<short sha> -t valour-sauce:1 .
```

## Patches

1. **Channel tab replacement** (`0774238`): adds
   `ChannelWindowFactory.FocusedChannelTab` and passes it to
   `WindowService.OpenWindowAtFocused` from the sidebar, favorites and terminal,
   so switching channels replaces the focused channel tab instead of stacking a
   new one. Only fires when the focused tab is itself a chat or call window.

2. **Krisp noise suppression** (`f177388c`): vendors
   `@livekit/krisp-noise-filter` 0.4.5 at
   `Valour/Client/wwwroot/js/krisp-noise-filter.umd.js` and attaches it as a
   track processor on the published microphone track in
   `livekit.interop.js`, so peers receive denoised audio. The filter runs in the
   speaker's browser and pulls its models from LiveKit's public model endpoint,
   so no LiveKit Cloud account is needed. Unsupported browsers are skipped.

## Syncing with upstream

```
git fetch upstream --tags
git rebase vX.Y.Z sauce
```

If upstream fixes a patch natively, drop the local commit and send it upstream
as a PR instead.
