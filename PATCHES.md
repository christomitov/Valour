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

## Syncing with upstream

```
git fetch upstream --tags
git rebase vX.Y.Z sauce
```

If upstream fixes a patch natively, drop the local commit and send it upstream
as a PR instead.
