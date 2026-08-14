# Avatars

`daniel.webp` is the real one: Daniel Hull's own photo, 216px square, inlined
as `__AV_DH__` into the fork's engineer row and the founder signature in
`#choose`. It is not stock and everything below about licences does not apply
to it.

The other three are the faces in the Slack thread mock in `#memory`. Inlined as base64 WebP
by `build.js` (`__AV_DR__`, `__AV_MF__`, `__AV_AL__`), the same way the fonts
and the logo sprite are, so the page stays one self-contained file.

All three are from Unsplash, free for commercial use under the [Unsplash
License](https://unsplash.com/license), which requires no attribution. Credited
here anyway, and kept with the source so the provenance survives the next person
who wonders where these came from.

| file | person in the mock | photo | photographer |
|---|---|---|---|
| `dev-raman.webp` | Dev Raman | [vAXmZOtLfo0](https://unsplash.com/photos/vAXmZOtLfo0) | DICSON ([@smartdicson](https://unsplash.com/@smartdicson)) |
| `marcus-feld.webp` | Marcus Feld | [InWUkRKyNbI](https://unsplash.com/photos/InWUkRKyNbI) | Af Hfmn ([@alex_hfmn54](https://unsplash.com/@alex_hfmn54)) |
| `anna-lindqvist.webp` | Anna Lindqvist | [0Zx1bDv5BNY](https://unsplash.com/photos/0Zx1bDv5BNY) | Christina @ wocintechchat.com ([@wocintechchat](https://unsplash.com/@wocintechchat)) |

**Why these three and not three headshots.** The first set here was studio
headshots: seamless backdrops, key light, camera smiles. Three of them in a row
read as a stock library rather than as a team, because the thing that gives a
real Slack roster away is that no two avatars match. These are picked to
disagree with each other -- warm bokeh at night, flat office daylight, an orange
wall beside a window -- and every one is a photograph someone took of a person
somewhere, rather than a headshot session.

Two of the pictures that did not survive are worth naming, because both looked
right in a search grid and wrong at 36px. A white-cyc studio portrait
(`FKLesO1D3Sk`) reads as a dark, striking picture in a thumbnail because the
subject's hair is dark; cropped to the face it is a bright white square in a
black UI. And most of the moodier editorial portraits lose the face entirely at
this size: the light that makes them good photographs is the light that leaves
half a face in shadow. Judge a replacement at 36px on the dark ground, never in
the search grid.

Crops are per photo, not one rule, since the subjects are not centred the way a
headshot is. As (centre-x, centre-y, side) in fractions, the side measured on
the source's **short** edge:

| file | crop |
|---|---|
| `dev-raman.webp` | 0.48, 0.32, 0.46 |
| `marcus-feld.webp` | 0.58, 0.27, 0.45 |
| `anna-lindqvist.webp` | 0.575, 0.29, 0.48 |

Each is then resized to 128px (the avatar renders at 36px, so this holds up to a
3x screen) and encoded with `cwebp -q 82`. About 2.6 KB each, ~10 KB of base64
across the three. Check any recrop at 36px and not at full size: at this scale
the face has to survive being a third of an inch wide, which is what rules out
most of the moodier editorial portraits.

**One thing to know about these:** the Unsplash License grants the copyright,
not a model release, and Unsplash does not collect releases from the people in
its photos. Here each face is captioned with an invented name and an invented
quote about an invented funding decision, on a commercial page. That is ordinary
practice for a product mock and the licence permits it, but if fein ever wants
to be strict about it, the fix is model-released stock (Getty, Adobe Stock) or
synthetic faces. Re-crop with the numbers above and nothing else has to change.

To replace one: drop a square image in here under the same filename, and
`build.js` picks it up. It fails the build if a file is missing.
