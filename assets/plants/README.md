# Plant art

The images the game uses to draw the field: six for the plants, one for Blightwick Farm and two for Crowhurst Farm.

| File | Shown for |
|---|---|
| `0-seed.webp` | Stage 0, seed |
| `1-sprout.webp` | Stage 1, sprout |
| `2-growing.webp` | Stage 2, growing |
| `3-ripe.webp` | Stage 3, ripe |
| `4-rotten.webp` | Stage 4, rotten |
| `bumper-crop.webp` | A bumper crop, spanning a ripe 2×2 square of plots |
| `blight.webp` | Blightwick Farm: a blighted plant, which never ripens and spreads to its neighbours |
| `crow.webp` | Crowhurst Farm: a plot the crows ate from last night (a single crow, which reads clearly at small sizes) |
| `scarecrow.webp` | Crowhurst Farm: where `Scare` will stand a scarecrow tonight |
| `share.jpg` | Not used in the game: the 1200×630 image shown when a link to it is shared |

## How they were made

The illustrations were generated with ChatGPT for Array Acres, from a brief asking for:

- a square, transparent canvas for each image
- the soil mound at the same height in every image, about 90% of the way down, and centred
- ripe as the tallest single plant, so growth reads as a progression
- rotten clearly darker and duller than ripe, so the two differ by colour as well as shape, including for colour-blind players

They were then prepared for the game: ripe was moved down onto the shared baseline and scaled up by 15%, and all six were resized to the size they're shown at, with room for high-resolution screens (128 px for plants, 256 px for the bumper crop) and saved as WebP. Together they come to about 46 KB.

## How the game uses them

Each plant image fills its plot, and the bumper crop covers the four plots of a ripe 2×2 square. The images load when the page opens, and each is used as soon as it arrives. Any image that hasn't loaded, or fails, is drawn more simply in code instead, so the game never depends on these files. The crow and scarecrow images were added later at 512 px, generated with ChatGPT in the same painted style.

## Replacing them

Keep the same file names and follow the brief above: square and transparent, soil at the same baseline in every image (462 px down on a 512 px canvas), 128 px for plants and 256 px for the bumper crop. Check ripe and rotten side by side at game size before committing: telling stage 3 from stage 4 at a glance matters for play.
