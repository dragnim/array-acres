# Array Acres

**Farm the whole field. All at once.**

A programming puzzle game where your farm is an array and APL is your toolkit. Each day, your `Harvest` function receives the whole field as a matrix and returns a boolean matrix of plots to harvest. Simple code works; cleverer array reasoning scores more.

This is an early prototype. The APL runs on a small interpreter written in JavaScript, covering a subset of Dyalog APL, so the game can be tried in any browser. If it proves fun and valuable as a teaching tool, the plan is to move it to proper Dyalog APL.

## Play

Open `index.html` in a browser. There's no build step and nothing to install.

## How it's built

The game is in `index.html`, in three scripts:

- `apl-interpreter`: the APL subset. Glyphs outside it report `NONCE ERROR`, which is where future unlocks will slot in.
- `acres-core`: the rules and simulation, with no access to the page, so the browser and the tests share one implementation.
- The page script: drawing, the editor, the live harvest preview and diagnostics.

The plant art is separate, in `assets/plants`, with notes on how it was made and how to replace it in [its own README](assets/plants/README.md). If the images can't load, the page draws simple plants in code instead, so the game never depends on them.

A season is 100 days. There are three farms, Middlebourne, Sunnyhill and Marshgate, each with its own weather under ruleset `v2`: sunshine sets how likely an unripe plant is to grow overnight, and rainfall how likely a ripe plant left in the ground is to rot. Each farm also has its own starting field and fixed luck, so the same farm and the same code always give the same score, and its own Bronze, Silver and Gold targets. Personal bests are kept in the browser, and Practice Farm plays random fields with Middlebourne Farm's weather. At the end of a season, a report shows what happened day by day, without suggesting what to change.

## Progression

Medals unlock the game. A new player starts on Middlebourne Farm with only `⍵` and the comparisons `= ≠ < > ≤ ≥`. Bronze on Middlebourne Farm unlocks `∧ ∨ ~`, the `BumperCrops` helper and Sunnyhill Farm. Silver on Sunnyhill Farm unlocks the `Promising` helper and Marshgate Farm. Gold on any farm unlocks every symbol and the helpers' APL source, so players can see how they work and write better ones. Practice Farm always has everything.

Unlocks are worked out from personal bests, so there's nothing extra to save, and the in-game farming guide explains each tool with a small example as it unlocks.

## Tests

Core tests need only Node:

```
npm test
```

They check interpreter results against known Dyalog answers, exact season totals for two reference strategies over 200 seeded fields, each farm's pinned scores and targets, that every rule stated on the page matches what the simulation actually does, that previewing never changes the game, and fixed-field masks for edge cases.

Browser tests use Playwright and are kept separate:

```
npm install
npx playwright install chromium
npm run test:browser
```

`npm run test:all` runs both.

## Reference solution

`reference/hybrid.apl` clears rot, harvests every bumper crop, and takes any ripe plant that can't become part of one. Over the 200 test fields, with Middlebourne Farm's weather, it averages 1,535 against 1,216 for `Harvest←{⍵≥Ripe}`, winning on every field. It uses only the current subset and is part of the regression tests.

## Design principles

1. **The field is the array.** Players manipulate the whole field directly with APL.
2. **Every mechanic teaches an array concept.** Complexity is added only when it gives a reason to use a particular primitive or technique.
3. **Simple solutions work, clever solutions work better.** Straightforward code makes progress; better array reasoning earns meaningfully more.

Every new mechanic should answer: what's the obvious solution, why does it work but fall short, and which APL idea does meaningfully better?

## Next

Human playtesting of the three farms and the unlock ladder, before adding another crop. A gentler Starter Farm, to come before Middlebourne Farm, is a candidate for later.

## Credits

The editor uses [APL386](https://github.com/abrudz/APL386), released into the public domain, subset and embedded in the page. The plant illustrations in `assets/plants` were generated with ChatGPT for this project, then aligned and resized for the game.

## Licence

Released under the [MIT licence](LICENSE).
