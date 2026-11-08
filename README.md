# Array Acres

**Farm the whole field. All at once.**

A programming puzzle game where your farm is an array and APL is your toolkit. Each day, your `Harvest` function receives the whole field as a matrix and returns a boolean matrix of plots to harvest. Simple code works; cleverer array reasoning scores more.

This is an early prototype. The APL runs on a small interpreter written in JavaScript, covering a subset of Dyalog APL, so the game can be tried in any browser. If it proves fun and valuable as a teaching tool, the plan is to move it to proper Dyalog APL.

## Play

Play it at https://dragnim.github.io/array-acres/, or open `index.html` in a browser: there's no build step and nothing to install. Only the leaderboard needs an internet connection.

## How to play

You write one function, `Harvest`. Every day of the season, the game gives it today's field as `⍵`, and it gives back a yes (1) or no (0) for every plot: 1 harvests that plot, 0 leaves it. Your code works on the whole field at once, so one expression like `⍵=Ripe` decides all 64 plots.

- **Write your code.** In the simple view, `Harvest←{` and `}` are already in place and you only write what goes inside. The code view lets you edit the whole program. Every name, symbol and key can be tapped, so the game works on a tablet without the keyboard; ⌨ brings the keyboard back.
- **Check it before you play.** Dashed outlines on the field show what your code would harvest today, and they update as you type.
- **Play** a whole season, or step through it a day at a time with Next day.
- **Read the season report** to see how it went: your score, plants lost to rot, plants wasted, and what happened day by day.
- **Earn medals** to unlock new symbols, helpers and farms. The farming guide explains each new tool with examples you can try on the field, and What is APL? introduces the language.

For testing, adding `?god` to the address (or pressing G) unlocks everything; `?god=off` turns it off.

## Rules

- The field is 8×8, and a season lasts 100 days.
- Every plot holds a plant at one of five stages, in order: Seed, Sprout, Growing, Ripe and Rotten. In code, compare `⍵` with the stage names, as in `⍵=Ripe` or `⍵≥Ripe`. Underneath they're the numbers 0 to 4, but you never need to use the numbers.
- Harvesting a ripe plant scores 1. Four ripe plants in a 2×2 square, harvested on the same day, are a bumper crop and score 3 each.
- Harvesting a sprout or a growing plant wastes it. Harvesting a seed or a rotten plant scores nothing, so clearing rot is free. Every harvested plot is replanted as a seed.
- Overnight, each unripe plant grows one stage with the chance given by the farm's sunshine, and each ripe plant left standing rots with the chance given by its rainfall.
- Each farm's starting field and luck are fixed, so the same code always scores the same there.
- On Blightwick Farm, some plants are `Blighted`: they never ripen, and each night they spread blight to each sprout, growing or ripe plant directly beside them with a 50% chance, even if cleared that day. Clearing blight is free, and seeds and rotten plants can't catch it.
- On Crowhurst Farm, a flock of crows lands on a 3×3 patch each night and eats the ripe plants there. A second function, `Scare`, can stand up to two scarecrows. Crows eat nothing within one plot of a scarecrow, but a scarecrow tramples the plant on its own plot back to a seed.

## Tips

- **Start simple.** `⍵=Ripe` is a perfectly good first season. Get something working, then improve it.
- **Step before you play.** Use Next day and watch the dashed outlines for a few days before playing a whole season.
- **Try before you type.** Show me in the farming guide marks what an expression would pick on today's field, without touching your code.
- **Experiment on Practice Farm.** It has every tool, and New field gives you a fresh field whenever you like.
- **Read the report.** It shows what went wrong, such as rot or waste, without telling you what to change; working that out is the game.

## The farms

Every farm follows the rules above. Each has its own weather, its own fixed starting field and luck, and its own Bronze, Silver and Gold targets. Some add a mechanic of their own.

### Middlebourne Farm

- **Weather:** sunshine 55%, rainfall 20%.
- **Medals:** Bronze 1200, Silver 1350, Gold 1500.
- **Unlocks:** open from the start. Bronze here unlocks `∧ ∨ ~`, the `BumperCrops` helper and Sunnyhill Farm.
- **Character:** mild weather, and the farm everyone starts on.

### Sunnyhill Farm

- **Weather:** sunshine 65%, rainfall 15%.
- **Medals:** Bronze 1450, Silver 1750, Gold 2100.
- **Unlocks:** Bronze on Middlebourne Farm. Silver here unlocks the `Promising` helper and Marshgate Farm.
- **Character:** sunny and dry: plants grow quickly and rarely rot.

### Marshgate Farm

- **Weather:** sunshine 50%, rainfall 25%.
- **Medals:** Bronze 1050, Silver 1150, Gold 1200.
- **Unlocks:** Silver on Sunnyhill Farm.
- **Character:** wet and slow: plants take longer to ripen and rot more often. The targets are lower to match.

### Crowhurst Farm (experimental)

- **Weather:** sunshine 55%, rainfall 20%, plus one flock of crows.
- **Medals:** Bronze 1050, Silver 1150, Gold 1250.
- **Unlocks:** Gold on any farm.
- **Crows:** after the field grows each night, a flock lands on a 3×3 patch and eats every ripe plant there, leaving seeds. A flock at the edge of the field only reaches the plots inside it.
- **Scarecrows:** a second function, `Scare`, is given the same field and gives back 1s where scarecrows should stand tonight, two at most. Crows eat nothing within one plot of a scarecrow. A scarecrow tramples the plant on its own plot back to a seed, though that seed can still grow that night.
- **Character:** the first farm where something works against you overnight.

### Blightwick Farm (experimental)

- **Weather:** sunshine 55%, rainfall 20%, plus blight.
- **Medals:** Bronze 1050, Silver 1300, Gold 1450.
- **Unlocks:** Gold on any farm.
- **Blight:** three plants start the season `Blighted`. A blighted plant never ripens and scores nothing, and harvesting it is free and replants a seed. Each night, every plant that was blighted that morning spreads blight to each sprout, growing or ripe plant directly above, below, left or right of it, each with a 50% chance, even if you cleared it that day: its spores are already out. Whether a plant can catch it is decided after the day's harvest, so seeds and rotten plants can't, even if a seed sprouts that night. Each night there's also a 10% chance of a new outbreak on a random plant.
- **Character:** the first farm where trouble spreads from plot to plot.

### Practice Farm

A new random field each time, with Middlebourne's weather and every symbol and helper unlocked. No medals and no leaderboard: it's for experimenting. Once Gold has unlocked Crowhurst and Blightwick, Practice Farm can switch on their crows and blight too, separately or together, to try ideas on fresh fields.

## Accessibility

- **Screen readers** get a text version of the field: every plot's stage, row by row, with what `Harvest` would pick and where scarecrows will stand. Next day announces what happened, and errors and status changes are announced as they appear.
- **Keyboard:** everything works without a mouse. The first Tab offers a skip link straight to the code, every name and symbol button explains itself on focus, and Ctrl+Enter (⌘+Enter) plays the next day.
- **Touch:** every action can be tapped, and a long press on a button explains it.
- **Comfort:** effects respect reduced motion, colours meet contrast standards in both themes, and on small screens the game behind an open panel is set aside, so focus stays in the panel.
- **Checked automatically:** every browser test run scans the page, its panels, a played day, Crowhurst and the code view with [axe](https://github.com/dequelabs/axe-core), in both themes.

## How it's built

The game is in `index.html`, in three scripts:

- `apl-interpreter`: the APL subset, with limits on size, recursion and work so no expression can freeze the page. Glyphs outside the subset report `NONCE ERROR`; symbols a player hasn't unlocked yet say what unlocks them.
- `acres-core`: the rules and simulation, with no access to the page, so the browser and the tests share one implementation.
- The page script: drawing and effects, the editor (simple and code views, with buttons for tapping code in), the live preview and diagnostics, progression, and the side panel for What is APL?, How to play, the farming guide, the leaderboard and the season report.

The art is separate, in `assets/plants`: the plants, crows and scarecrow, and the image shown when a link to the game is shared, with notes on how they were made in [its own README](assets/plants/README.md). If an image can't load, the page draws it in code instead, so the game never depends on them. The leaderboard's server code is in `leaderboard/`.

A season is 100 days. There are five farms under ruleset `v2`. Middlebourne, Sunnyhill and Marshgate each have their own weather: sunshine sets how likely an unripe plant is to grow overnight, and rainfall how likely a ripe plant left in the ground is to rot. Crowhurst has Middlebourne's weather plus crows, which eat ripe plants at night unless a second function, `Scare`, stands scarecrows nearby. Blightwick has Middlebourne's weather plus blight, which spreads from plant to plant overnight. Each farm also has its own starting field and fixed luck, so the same farm and the same code always give the same score, and its own Bronze, Silver and Gold targets. Personal bests are kept in the browser, and Practice Farm plays random fields with Middlebourne Farm's weather. At the end of a season, a report shows what happened day by day, without suggesting what to change.

## Progression

Medals unlock the game. A new player starts on Middlebourne Farm with only `⍵` and the comparisons `= ≠ < > ≤ ≥`. Bronze on Middlebourne Farm unlocks `∧ ∨ ~`, the `BumperCrops` helper and Sunnyhill Farm. Silver on Sunnyhill Farm unlocks the `Promising` helper and Marshgate Farm. Gold on any farm unlocks every symbol and the helpers' APL source, so players can see how they work and write better ones. It also unlocks Crowhurst Farm, an experiment: each night a flock of crows eats the ripe plants on a 3×3 patch, and players can write a second function, `Scare`, to stand up to two scarecrows that protect the plots around them. And it unlocks Blightwick Farm, also an experiment, where blight spreads between neighbouring plants. Practice Farm always has everything.

Unlocks are worked out from personal bests, so there's nothing extra to save, and the in-game farming guide explains each tool with a small example as it unlocks.

## Leaderboard

Every farm has a top 10, shown on the Leaderboard page and in each season report. When a season's score makes it, the player enters three initials, arcade style, and the score and the code that earned it go to a small Cloudflare Worker on the free plan (`leaderboard/worker.mjs`), which keeps everything in a D1 database (`leaderboard/schema.sql`). Nothing counts until it's checked: a scheduled GitHub Actions job (`leaderboard/verify.js`) replays each new entry's code with the game's own rules, and only a score the code really earns goes on the board.

- **Timing.** The job is set to run every 15 minutes, though GitHub sometimes runs scheduled jobs later. To check entries straight away, run the Leaderboard workflow from the Actions tab. GitHub pauses scheduled jobs in repositories with no commits for 60 days; if scores stop being checked, re-enable the workflow there.
- **Limits.** Each player has one entry waiting per farm, which a better score replaces. Entries left unchecked for a day expire. A sender can submit 10 scores an hour, remembered only as a hash of their address, and each board holds 20 waiting entries at most. Each replay stops after 10 seconds, so one slow program can't hold up the rest.
- **The secret.** The job and the Worker share a secret, `LEADERBOARD_TOKEN`, set in the repository's Actions secrets and in the Worker's settings. It's never stored in the code.
- **Deploying.** The Worker runs the code in `leaderboard/worker.mjs`, pasted into its editor in the Cloudflare dashboard, so keep the two in step.
- **Crowhurst and Blightwick.** Their boards are marked experimental and start fresh whenever their rules change: bump `boardVersion` for the farm in the game and `VERSIONS` in the Worker together.

## Tests

Core tests need only Node:

```
npm test
```

They check interpreter results against known Dyalog answers and its limits, exact season totals for two reference strategies over 200 seeded fields, each farm's pinned scores and targets, that every rule stated on the page matches what the simulation actually does, that previewing never changes the game, the unlock journey from first harvest to Gold, Crowhurst's crows and scarecrows including their edge cases, and fixed-field masks for edge cases.

`npm test` also runs the leaderboard tests, against a real SQLite database standing in for D1: replaying entries (including Crowhurst's `Scare`), rejecting faked scores and old experiment versions, simultaneous submissions and checks, expiry, rate limits, the token, and the arcade rules for initials and places.

Browser tests use Playwright and are kept separate. They use a stand-in leaderboard, so they never touch the real one:

```
npm install
npx playwright install chromium
npm run test:browser
```

`npm run test:all` runs both.

## Reference solution

`reference/hybrid.apl` is a strong strategy that the regression tests use to check each farm's balance. It isn't described here, so as not to spoil the puzzle: open the file only if you want an answer.

## Design principles

1. **The field is the array.** Players manipulate the whole field directly with APL.
2. **Every mechanic teaches an array concept.** Complexity is added only when it gives a reason to use a particular primitive or technique.
3. **Simple solutions work, clever solutions work better.** Straightforward code makes progress; better array reasoning earns meaningfully more.

Every new mechanic should answer: what's the obvious solution, why does it work but fall short, and which APL idea does meaningfully better?

## Next

Human playtesting of the five farms and the unlock ladder, before adding another crop. A gentler Starter Farm, to come before Middlebourne Farm, is a candidate for later.

## Credits

The editor uses [APL386](https://github.com/abrudz/APL386), released into the public domain, subset and embedded in the page. Headings and text use [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), self-hosted in `assets/fonts` under the SIL Open Font License, so the game loads nothing from other sites. All the illustrations in `assets/plants`, the plants, blight, crow and scarecrow, were generated with ChatGPT for this project, then prepared for the game.

## Licence

Released under the [MIT licence](LICENSE).
