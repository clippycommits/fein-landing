# Avatars

The three faces in the Slack thread mock in `#memory`. Inlined as base64 WebP
by `build.js` (`__AV_DR__`, `__AV_MF__`, `__AV_AL__`), the same way the fonts
and the logo sprite are, so the page stays one self-contained file.

All three are from Unsplash, free for commercial use under the [Unsplash
License](https://unsplash.com/license), which requires no attribution. Credited
here anyway, and kept with the source so the provenance survives the next person
who wonders where these came from.

| file | person in the mock | photo | photographer |
|---|---|---|---|
| `dev-raman.webp` | Dev Raman | [iFgRcqHznqg](https://unsplash.com/photos/iFgRcqHznqg) | Joseph Gonzalez ([@miracletwentyone](https://unsplash.com/@miracletwentyone)) |
| `marcus-feld.webp` | Marcus Feld | [7YVZYZeITc8](https://unsplash.com/photos/7YVZYZeITc8) | Jurica Koletić ([@juricakoletic](https://unsplash.com/@juricakoletic)) |
| `anna-lindqvist.webp` | Anna Lindqvist | [ij6JGuYzCd4](https://unsplash.com/photos/ij6JGuYzCd4) | Devin Santiago ([@ydcphotography](https://unsplash.com/@ydcphotography)) |

Each is cropped square on the face at 0.72 of the source width, resized to 128px
(the avatar renders at 36px, so this holds up to a 3x screen) and encoded with
`cwebp -q 82`. About 2.6 KB each, ~10 KB of base64 across the three.

**One thing to know about these:** the Unsplash License grants the copyright,
not a model release, and Unsplash does not collect releases from the people in
its photos. Here each face is captioned with an invented name and an invented
quote about an invented funding decision, on a commercial page. That is ordinary
practice for a product mock and the licence permits it, but if fein ever wants
to be strict about it, the fix is model-released stock (Getty, Adobe Stock) or
synthetic faces. Re-crop with the numbers above and nothing else has to change.

To replace one: drop a square image in here under the same filename, and
`build.js` picks it up. It fails the build if a file is missing.
