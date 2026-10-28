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

## Round 3 - soundboard inside the client

`SoundboardPanel.razor` (+ CSS isolation), `SoundboardState.cs`, a composer button
cloned from the emoji button in `InputComponent.razor`, single-window navigation
(`WindowService.SingleWindowMode`, tab strip removed from `WindowComponent.razor`),
and the soundboard route registered in `ServiceCollectionExtensions.cs` /
`_Imports.razor`. Favorites come from soundbored `GET /api/favorites` through the
bot's `/sb/favorites` proxy.

## Round 4 - microphone settings

Noise suppression toggle, quality select and an input sensitivity slider in
`EditDevicePreferencesComponent.razor`, persisted through `IAppStorage` as
`valour.noiseFilter.*` and `valour.noiseGate.threshold`.

## Round 5 - why the microphone was never filtered

Two independent bugs, both verified in a real browser:

1. `KrispNoiseFilter.init()` was called with `{track}` only. Krisp reads
   `options.audioContext.sampleRate`, so it threw
   `Cannot read properties of undefined (reading 'sampleRate')` within a few
   milliseconds and the raw microphone was published.
2. `SecurityHeaders.cs` allowed `blob:` for images and media but not for scripts.
   Krisp loads its AudioWorklet from a `blob:` URL, so `addModule()` failed with
   `AbortError: Unable to load a worklet's module`, surfaced as
   `WORKLET_NOT_SUPPORTED`.

Both had to be fixed before noise suppression could work at all. The policy now
lists `blob:` in `script-src`.

## Round 6 - processor contract and clip routing

`LocalTrack.setProcessor()` in livekit-client 2.7.5 ignores what `init()` returns
and publishes `processor.processedTrack`, then calls `destroy()` and `restart()`.
The mixer now sets `processedTrack`, implements both methods, reuses LiveKit's own
`audioContext` and media element, and reads `processedTrack` off the Krisp
instance. Attaches are deduplicated per track with an in-flight `WeakMap`, so the
publish path, the retry timer and the panel cannot double-process a track.

Clips no longer travel through the browser at all: the panel POSTs `/sb/sound`
with the clip URL, and the bot mixes the clip over the music it already publishes,
so every listener hears it and nothing depends on the client's audio graph. The
settings page gained a live input meter whose amber marker sits on the gate cutoff.
