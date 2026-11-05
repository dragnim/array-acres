# Array Acres

**Farm the whole field. All at once.**

A programming puzzle game where your farm is an array and APL is your toolkit. Each day, your `Harvest` function receives the whole field as a matrix and returns a boolean matrix of plots to harvest. Simple code works; cleverer array reasoning scores more.

This is an early prototype. The APL runs on a small interpreter written in JavaScript, covering a subset of Dyalog APL, so the game can be tried in any browser. If it proves fun and valuable as a teaching tool, the plan is to move it to proper Dyalog APL.

## Play

Open `index.html` in a browser. There's no build step and nothing to install.

## How it's built

Everything is in `index.html`, in three scripts:

- `apl-interpreter`: the APL subset. Glyphs outside it report `NONCE ERROR`, which is where future unlocks will slot in.
- `acres-core`: the rules and simulation, with no access to the page, so the browser and the tests share one implementation.
- The page script: drawing, the editor, the live harvest preview and diagnostics.

Seasons are seeded, so the same field and the same code always give the same score.

## Tests

Core tests need only Node:

```
npm test
```

They check interpreter results against known Dyalog answers, exact season totals for two reference strategies over 200 seeded fields, that previewing never changes the game, and fixed-field masks for edge cases.

Browser tests use Playwright and are kept separate:

```
npm install
npx playwright install chromium
npm run test:browser
```

`npm run test:all` runs both.

## Reference solution

`reference/hybrid.apl` clears rot, harvests complete ripe 2×2 blocks, and takes any ripe plot that can't become part of a block. Over the 200 test fields it averages 1,535 against 1,216 for `Harvest←{⍵≥3}`, winning on every field. It uses only the current subset and is part of the regression tests.

## Design principles

1. **The field is the array.** Players manipulate the whole field directly with APL.
2. **Every mechanic teaches an array concept.** Complexity is added only when it gives a reason to use a particular primitive or technique.
3. **Simple solutions work, clever solutions work better.** Straightforward code makes progress; better array reasoning earns meaningfully more.

Every new mechanic should answer: what's the obvious solution, why does it work but fall short, and which APL idea does meaningfully better?

## Next

End-of-season diagnostics, starting with a day-by-day breakdown of score and rot.

## Credits

The editor uses [APL386](https://github.com/abrudz/APL386), released into the public domain, subset and embedded in the page.
