// Browser test for the editor: preview, stale state, diagnostics, stepping and a full season.
// Run with `npm run test:browser`. Waits on the page's own state, never on fixed delays.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const AxeBuilder = require('@axe-core/playwright').default;

// How to play opens by itself on a first visit. Most tests start as a returning player, editing the
// full program; the simple view has its own test.
// (Set by visiting once, not with an init script: init scripts that touch storage can lose it on reload.)
const returning = async page => {
  await page.goto(PAGE);
  // A returning player: How to play already seen, the code view, and Middlebourne Farm as their last farm.
  await page.evaluate(() => { localStorage.setItem('acres:help-seen', '1'); localStorage.setItem('acres:editor', 'full'); localStorage.setItem('acres:farm', 'middlebourne-farm'); });
  await page.reload();
};
// The leaderboard is a real server; tests use a stand-in board instead.
const LEADERBOARD = 'https://array-acres-leaderboard.long-tree-e1ed.workers.dev';
// The title screen opens at the start of each visit. Tests start mid-visit, past it, except the title screen's own
// test, which uses browser.rawNewContext.
const pastTitle = () => { try { sessionStorage.setItem('acres:welcomed', '1'); } catch (e) {} };
test.beforeAll(({ browser }) => {
  if (browser.rawNewContext) return;
  const raw = browser.newContext.bind(browser);
  browser.rawNewContext = raw;
  browser.newContext = async options => { const context = await raw(options); await context.addInitScript(pastTitle); return context; };
  browser.newPage = async options => {
    const context = await browser.newContext(options), page = await context.newPage(), close = page.close.bind(page);
    page.close = async (...args) => { await close(...args); await context.close(); };
    return page;
  };
});
test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(pastTitle);
  await page.route(`${LEADERBOARD}/**`, route => route.fulfill({ json: { entries: [], pending: [] } }));
  await returning(page);
});

test('preview and diagnostics follow the code and the field', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);
  await page.selectOption('#farm', 'practice'); // every symbol is unlocked on Practice Farm
  // This test times the preview's pause after typing, so it leaves out the purely visual harvest effects.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const code = page.locator('#code');
  const status = page.locator('#status');
  const diag = page.locator('#diag');
  const field = page.locator('#field'); // data-preview is none, live or stale
  const day = page.locator('#sTick');

  // Valid code: a live preview, no diagnostics, no day spent.
  await code.fill('Harvest←{⍵≥3}');
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(diag).toHaveText('');

  // Start editing: the old preview goes stale straight away.
  await code.press('End');
  await code.press('Backspace');
  await expect(status).toHaveAttribute('data-state', 'editing');
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // The edit left invalid APL: quiet code error, old preview kept but stale.
  await expect(status).toHaveAttribute('data-state', 'code');
  await expect(diag).toContainText('ERROR');
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // Valid APL with an unusable result: reported as a result problem, not a code error.
  await code.fill('Harvest←{+/⍵}');
  await expect(status).toHaveAttribute('data-state', 'result');
  await expect(diag).toHaveText(/^Invalid result: /);
  await expect(field).toHaveAttribute('data-preview', 'stale');

  // Recovery: live preview again and diagnostics cleared.
  await code.fill('Harvest←{⍵≥3}');
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(diag).toHaveText('');

  // None of that spent a day.
  await expect(day).toHaveText('0/100');

  // Stepping moves the field on and the preview is recalculated for the new day.
  await page.click('#step');
  await expect(day).toHaveText('1/100');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(status).toHaveAttribute('data-state', 'ready');

  // Stepping mid-edit: the preview stays stale until the pending edit settles.
  await code.press('End');
  await code.press('Space');
  await page.click('#step');
  await expect(day).toHaveText('2/100');
  await expect(field).toHaveAttribute('data-preview', 'stale');
  await expect(field).toHaveAttribute('data-preview', 'live');
  await expect(status).toHaveAttribute('data-state', 'ready');

  // Play out the season.
  await page.selectOption('#speed', '30');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText(/^Season complete\. You scored \d+ points\.$/, { timeout: 30000 });
  await expect(day).toHaveText('100/100');

  // The season report appears, agrees with the scoreboard, and switches chart views.
  const report = page.locator('#report'), chart = page.locator('#chart');
  await expect(report).toBeVisible();
  await expect(page.locator('#rScore')).toHaveText(await page.locator('#sScore').textContent());
  await expect(page.locator('#rWasted')).toHaveText(await page.locator('#sWasted').textContent());
  await expect(chart).toHaveAttribute('data-view', 'score');
  await page.click('.seg button[data-view="rot"]');
  await expect(chart).toHaveAttribute('data-view', 'rot');
  await expect(page.locator('.seg button[data-view="rot"]')).toHaveAttribute('aria-pressed', 'true');
  await chart.focus();
  await chart.press('End');
  await expect(page.locator('#readout')).toHaveText(/^Day 100: \d+ ripe plants? lost to rot$/);

  // A new season hides the report.
  await page.click('#restart');
  await expect(report).toBeHidden();

  expect(errors).toEqual([]);
});

test('medals unlock farms, symbols and helpers, and bests survive a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);

  const code = page.locator('#code'), status = page.locator('#status');
  const best = page.locator('#sBest'), msg = page.locator('#msg'), unlock = page.locator('#cmpUnlock');
  const playSeason = async src => {
    await code.fill(src);
    await expect(status).toHaveAttribute('data-state', 'ready');
    await page.click('#restart');
    await page.click('#run');
    await expect(msg).toHaveText(/^Season complete\./, { timeout: 30000 });
  };
  await page.selectOption('#speed', '30');

  // A new player starts on Middlebourne Farm.
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
  await expect(page.locator('#weather')).toHaveText('Sunshine 55%Rainfall 20%');
  await expect(page.locator('#farm option[value="sunnyhill-farm"]')).toBeDisabled();
  await expect(page.locator('#newField')).toBeDisabled();

  // Bronze on Middlebourne Farm.
  await playSeason('Harvest←{⍵≥3}');
  await expect(page.locator('#cmpThis')).toHaveText('1213');
  await expect(page.locator('#cmpStatus')).toHaveText('Your first result on this farm.');
  await expect(page.locator('#cmpTier')).toHaveText('You reached Bronze. Silver is 1350.');
  await expect(unlock).toHaveText('Unlocked: ∧ ∨ ~, the BumperCrops helper and Sunnyhill Farm. See the farming guide.');
  // The farming guide button shows New until the guide is opened, here from the report's link.
  await expect(page.locator('#guideNew')).toBeVisible();
  await unlock.getByRole('button', { name: 'See the farming guide' }).click();
  await expect(page.locator('#panelTitle')).toHaveText('Farming guide');
  await expect(page.locator('#guideNew')).toBeHidden();
  await expect(page.locator('.tier[data-tier="bronze"]')).toHaveAttribute('data-earned', 'true');
  await expect(page.locator('#farm option[value="sunnyhill-farm"]')).toBeEnabled();

  // A run that doesn't improve keeps the best and unlocks nothing new.
  await playSeason('Harvest←{⍵=3}');
  await expect(page.locator('#cmpStatus')).toHaveText('Your personal best stays at 1213.');
  await expect(unlock).toBeHidden();

  // Bests, unlocks and the chosen farm survive a reload.
  await page.reload();
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
  await expect(best).toHaveText('1213');
  await expect(page.locator('#farm option[value="sunnyhill-farm"]')).toBeEnabled();

  // Silver on Sunnyhill Farm, harvesting only bumper crops.
  await page.selectOption('#farm', 'sunnyhill-farm');
  await expect(best).toHaveText('–');
  await page.selectOption('#speed', '30');
  await playSeason('Harvest←{(⍵=4)∨BumperCrops ⍵}');
  await expect(page.locator('#cmpTier')).toHaveText('You reached Silver. Gold is 2100.');
  await expect(unlock).toHaveText('Unlocked: the Promising helper and Marshgate Farm. See the farming guide.');

  // Gold with the helpers, which unlocks everything else.
  await playSeason('Harvest←{(⍵=4)∨(BumperCrops ⍵)∨(⍵=3)∧~Promising ⍵}');
  await expect(page.locator('#cmpTier')).toHaveText('Gold reached! You’ve found a powerful strategy. Can you do even better?');
  await expect(unlock).toHaveText(/^Unlocked: every symbol, the Squares helper, the helpers’ source code, Crowhurst Farm and Blightwick Farm\. See the farming guide\.$/);
  await expect(page.locator('.tier[data-earned="true"]')).toHaveCount(3);

  // Practice Farm keeps no bests.
  await page.selectOption('#farm', 'practice');
  await expect(page.locator('#newField')).toBeEnabled();
  await expect(page.locator('#bestLabel')).toHaveText('Best on this field');
  await expect(page.locator('#targets')).toBeHidden();

  expect(errors).toEqual([]);
});

test('locked symbols and helpers say what unlocks them, except on Practice Farm', async ({ page }) => {
  await page.goto(PAGE);
  const code = page.locator('#code'), status = page.locator('#status'), diag = page.locator('#diag');
  const glyph = ch => page.locator('#glyphs button', { hasText: ch });

  await expect(glyph('∨')).toBeDisabled();
  await expect(glyph('≠')).toBeEnabled();
  await code.fill('Harvest←{(⍵=3)∨⍵=4}');
  await expect(status).toHaveAttribute('data-state', 'locked');
  await expect(diag).toHaveText('∨ unlocks with Bronze on Middlebourne Farm. Practice Farm has every symbol and helper.');
  await expect(page.locator('.guide-item[data-locked="true"]')).toHaveCount(8);

  await page.selectOption('#farm', 'practice');
  await expect(glyph('∨')).toBeEnabled();
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.guide-item[data-locked="true"]')).toHaveCount(0);
});

test('bumper crops appear exactly where ripe 2×2 squares are', async ({ page }) => {
  // The expected squares come from the game core itself, run in Node on the same season.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  const { AcresCore } = new Function(script('apl-interpreter') + '\n' + script('acres-core') + '\nreturn { AcresCore };')();
  const st = AcresCore.newSeason(AcresCore.FARMS[0].seed, AcresCore.FARMS[0]), nothing = AcresCore.compileHarvest('Harvest←{0}');

  await page.goto(PAGE);
  await page.locator('#code').fill('Harvest←{0}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  for (let day = 0; day < 8; day++) {
    await expect(page.locator('#field')).toHaveAttribute('data-bumpers', String(AcresCore.ripeSquares(st.field).length));
    AcresCore.advance(st, AcresCore.runHarvest(nothing, st.field));
    await page.click('#step');
  }
});

test('days cross-fade, except when reduced motion is preferred', async ({ browser }) => {
  for (const [reducedMotion, fades] of [['no-preference', 'true'], ['reduce', 'false']]) {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await returning(page);
    await page.goto(PAGE);
    await page.locator('#code').fill('Harvest←{⍵=3}');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.click('#step');
    expect(await page.locator('#field').getAttribute('data-fading')).toBe(fades);
    await expect(page.locator('#field')).toHaveAttribute('data-fading', 'false');
    await expect(page.locator('#sTick')).toHaveText('1/100');
    await context.close();
  }
});

test('painted plant art is used, and the game still works without it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);
  await expect(page.locator('#field')).toHaveAttribute('data-art', 'images');

  // A copy of the page with no assets folder falls back to plants drawn in code.
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'acres-'));
  fs.copyFileSync(path.join(__dirname, '..', 'index.html'), path.join(dir, 'index.html'));
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  await page.locator('#code').fill('Harvest←{⍵=3}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.click('#step');
  await expect(page.locator('#sTick')).toHaveText('1/100');
  await expect(page.locator('#field')).toHaveAttribute('data-art', 'drawn');

  // Images load one by one: with the crow and scarecrow art missing, the plants are still painted.
  fs.mkdirSync(path.join(dir, 'assets', 'plants'), { recursive: true });
  for (const f of ['0-seed', '1-sprout', '2-growing', '3-ripe', '4-rotten', 'bumper-crop'])
    fs.copyFileSync(path.join(__dirname, '..', 'assets', 'plants', `${f}.webp`), path.join(dir, 'assets', 'plants', `${f}.webp`));
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  await expect(page.locator('#field')).toHaveAttribute('data-art', 'images');
  expect(errors).toEqual([]);
});

test('the rules on the page state the numbers the game actually uses', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  const { AcresCore } = new Function(script('apl-interpreter') + '\n' + script('acres-core') + '\nreturn { AcresCore };')();
  const R = AcresCore.RULES, pct = p => `${Math.round(p * 100)}%`;

  // The rules follow the chosen farm's weather. Every farm is unlocked for this test.
  await page.addInitScript(() => localStorage.setItem('acres:bests', JSON.stringify({
    'v2:middlebourne-farm': { score: 9999 }, 'v2:sunnyhill-farm': { score: 9999 }, 'v2:marshgate-farm': { score: 9999 } })));
  await page.goto(PAGE);
  for (const f of AcresCore.FARMS) {
    await page.selectOption('#farm', f.id);
    const rules = await page.locator('#rules').innerText();
    for (const claim of [`${f.size}×${f.size}`, `${f.days} days`, `${pct(f.sunshine)} chance to grow`, `${pct(f.rainfall)} chance to rot`, `scores ${R.bonus} instead`])
      expect(rules).toContain(claim);
  }
});

test('Reset code restores the starter code, and undo brings the player’s code back', async ({ page }) => {
  await page.goto(PAGE);
  const code = page.locator('#code');
  const starter = await code.inputValue();
  expect(starter).toMatch(/Harvest←\{0\}\n$/);

  await code.fill('Harvest←{⍵≥3}');
  await page.click('#resetCode');
  await expect(code).toHaveValue(starter);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');

  // The reset is kept, like any other edit.
  await page.reload();
  await expect(code).toHaveValue(starter);

  // And it can be undone.
  await code.fill('Harvest←{⍵≥3}');
  await page.click('#resetCode');
  await code.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(code).toHaveValue('Harvest←{⍵≥3}');
});

test('the field can show its numbers, exactly as Harvest sees them, once Gold unlocks them', async ({ page }) => {
  await page.goto(PAGE);
  const field = page.locator('#field'), btn = page.locator('#showNumbers');
  // A new player meets stages by name only: the button appears at Gold, and on Practice Farm.
  await expect(btn).toBeHidden();
  await page.selectOption('#farm', 'practice');
  await expect(btn).toBeVisible();
  await expect(page.locator('.field-title')).toHaveText('Your field on day 1, ⍵');
  await expect(field).toHaveAttribute('data-numbers', 'off');
  await btn.click();
  await expect(field).toHaveAttribute('data-numbers', 'on');
  await expect(btn).toHaveText('Hide numbers');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(field).toHaveAttribute('data-numbers', 'on');
  await page.selectOption('#farm', 'middlebourne-farm'); // locked again here, so no numbers
  await expect(field).toHaveAttribute('data-numbers', 'off');
  await page.selectOption('#farm', 'practice');
  await page.locator('#showNumbers').click();
  await expect(field).toHaveAttribute('data-numbers', 'off');
});

test('How to play opens on a first visit (unless the tutorial is showing), and the side panel switches and closes', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(PAGE);
  const panel = page.locator('#panel'), title = page.locator('#panelTitle');
  // A new player starts on the tutorial, which explains things itself: no panel on top of it.
  await expect(page.locator('#tutStep')).toHaveText('Tutorial, step 1 of 12');
  await expect(panel).toBeHidden();
  // A first visit that starts on another farm opens How to play.
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('acres:farm', 'middlebourne-farm'); });
  await page.reload();

  await expect(panel).toBeVisible();
  await expect(title).toHaveText('How to play');
  await expect(page.locator('#rules li')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Only on the first visit.
  await page.reload();
  await expect(panel).toBeHidden();

  await page.click('#openGuide');
  await expect(title).toHaveText('Farming guide');
  await expect(page.locator('#openGuide')).toHaveAttribute('aria-expanded', 'true');
  await page.click('#openHelp');
  await expect(title).toHaveText('How to play');
  await expect(page.locator('#pGuide')).toBeHidden();
  await expect(page.locator('#openGuide')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#openHelp');
  await expect(panel).toBeHidden();
  await page.click('#openGuide');
  await page.click('#closePanel');
  await expect(panel).toBeHidden();

  // What is APL? opens its own page in the same panel.
  await page.click('#openAbout');
  await expect(title).toHaveText('What is APL?');
  await expect(page.locator('#pAbout')).toContainText('Why it suits farming');
  // Its example shows ⍵=Ripe on a tiny field, and Show me runs it on today's field.
  await expect(page.locator('.apl-example-result span.on')).toHaveCount(4);
  await page.click('#aplExampleShow');
  await expect(page.locator('#field')).toHaveAttribute('data-preview', 'example');
  await expect(page.locator('#exampleCode')).toHaveText('⍵=Ripe');
  if (await panel.isVisible()) await page.click('#closePanel');

  // Esc in the editor leaves it for Tab, and doesn't close the panel.
  await page.click('#openGuide');
  await page.locator('#hBody').focus(); // a first visit starts in the simple view
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page.close();
});

test('farming guide snippets can be shown on the field and put in your code', async ({ page }) => {
  const field = page.locator('#field'), note = page.locator('#exampleNote'), code = page.locator('#code');
  await code.fill('Harvest←{⍵≥3}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.click('#openGuide');

  // Show me marks what the snippet picks, without touching your code.
  await page.getByRole('button', { name: 'Show me what ⍵≤Sprout would harvest today' }).click();
  await expect(field).toHaveAttribute('data-preview', 'example');
  await expect(note).toHaveText(/^Showing what ⍵≤Sprout would harvest today: \d+ plots?\. Back to your code$/);
  await expect(code).toHaveValue('Harvest←{⍵≥3}');

  // Back to your code, or pressing Show me again, returns to your own preview.
  await page.getByRole('button', { name: 'Back to your code' }).click();
  await expect(field).toHaveAttribute('data-preview', 'live');
  await page.getByRole('button', { name: 'Show me what ⍵=Rotten would harvest today' }).click();
  await page.getByRole('button', { name: 'Show me what ⍵=Rotten would harvest today' }).click();
  await expect(note).toBeHidden();

  // A new day returns to your preview too.
  await page.getByRole('button', { name: 'Show me what ⍵≠Seed would harvest today' }).click();
  await page.click('#step');
  await expect(field).toHaveAttribute('data-preview', 'live');

  // Use puts the snippet in your code at the cursor, selected.
  await code.evaluate(el => { el.setSelectionRange(9, 12); });
  await page.getByRole('button', { name: 'Use ⍵≠Seed in your code' }).click();
  await expect(code).toHaveValue('Harvest←{⍵≠Seed}');
  expect(await code.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('⍵≠Seed');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
});

test('harvests are celebrated on the field, except with reduced motion', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await returning(page);
    await page.goto(PAGE);
    await page.locator('#code').fill('Harvest←{⍵≥Ripe}');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.click('#step');
    const fx = page.locator('#fx');
    expect(Number(await fx.getAttribute('data-ripe'))).toBeGreaterThan(0);
    await expect(fx).toHaveAttribute('data-shown', reducedMotion === 'reduce' ? 'no' : 'yes');
    // Bad moments are counted too: harvesting sprouts wastes them, and ripe plants left standing can rot.
    await page.locator('#code').fill('Harvest←{⍵=Sprout}');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    let rotted = 0;
    for (let i = 0; i < 6 && !rotted; i++) { await page.click('#step'); rotted = Number(await fx.getAttribute('data-rotted')); }
    expect(rotted).toBeGreaterThan(0);
    await context.close();
  }
});

test('Crowhurst Farm: scarecrows from Scare, a limit of two, and crows in the report', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('acres:bests', JSON.stringify({ 'v2:marshgate-farm': { score: 9999 } })));
  await page.goto(PAGE);
  await page.selectOption('#farm', 'crowhurst-farm');
  await expect(page.locator('#weather')).toContainText('Crows 1 flock');
  await expect(page.locator('#rules')).toContainText('trampling whatever grew there back to a seed (which can still sprout that night), and crows eat nothing within one plot of it');
  const code = page.locator('#code'), status = page.locator('#status'), field = page.locator('#field');

  await code.fill('Harvest←{⍵≥Ripe}\nScare←{⍵≥0}');
  await expect(status).toHaveAttribute('data-state', 'result');
  await expect(page.locator('#diag')).toHaveText('Invalid result: Scare placed 64 scarecrows, but you only have 2');

  await code.fill('Harvest←{⍵≥Ripe}\nScare←{8 8⍴(⍳64)∊10 30}');
  await expect(status).toHaveAttribute('data-state', 'ready');
  await expect(field).toHaveAttribute('data-scarecrows', '2');

  await page.selectOption('#speed', '30');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText(/^Season complete\./, { timeout: 30000 });
  await expect(page.locator('#rEatenStat')).toBeVisible();
  await expect(page.locator('#rTrampledStat')).toBeVisible();
  expect(Number(await page.locator('#rEaten').textContent())).toBeGreaterThan(0);
});

test('G turns god mode on and off, unlocking every farm for testing', async ({ page }) => {
  const crowhurst = page.locator('#farm option[value="crowhurst-farm"]'), badge = page.locator('#godBadge');
  await expect(crowhurst).toBeDisabled();
  await page.locator('.topbar .intro').click(); // somewhere outside the code
  await page.keyboard.press('g');
  await expect(badge).toBeVisible();
  await expect(crowhurst).toBeEnabled();
  await page.selectOption('#farm', 'crowhurst-farm');
  await expect(page.locator('#weather')).toContainText('Crows 1 flock');

  // Typing g in the editor is just typing.
  await page.locator('#code').press('g');
  await expect(badge).toBeVisible();

  // It stays on after a reload, and G again turns it off, back to a farm you have unlocked.
  await page.reload();
  await expect(badge).toBeVisible();
  await page.locator('.topbar .intro').click(); // somewhere outside the code
  await page.keyboard.press('g');
  await expect(badge).toBeHidden();
  await expect(crowhurst).toBeDisabled();
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
});

test('the leaderboard takes three initials from a top-10 score, and sends the code to be checked', async ({ page }) => {
  let sent = null;
  await page.route(`${LEADERBOARD}/**`, async route => {
    const req = route.request();
    if (req.method() === 'POST') { sent = req.postDataJSON(); return route.fulfill({ json: { status: 'checking' } }); }
    return route.fulfill({ json: { entries: [{ initials: 'ACE', score: 1600, date: '2026-11-01' }], pending: [] } });
  });
  await page.goto(PAGE);
  await page.selectOption('#speed', '30');
  await page.locator('#code').fill('Harvest←{⍵≥Ripe}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText(/^Season complete\./, { timeout: 30000 });
  await expect(page.locator('#rMissed')).toHaveText('384'); // harvesting at once: ripe plants taken alone where a bumper crop could form
  await expect(page.locator('#rEatenStat')).toBeHidden(); // no crows on Middlebourne
  await expect(page.locator('#rTrampledStat')).toBeHidden();
  await expect(page.locator('#lbList li')).toHaveCount(1);
  await expect(page.locator('#lbList')).toContainText('ACE');
  await expect(page.locator('#lbEnter')).toBeVisible();
  await page.locator('#lbInitials').pressSequentially('m1kx');
  await expect(page.locator('#lbInitials')).toHaveValue('MKX');
  await page.click('#lbSubmit');
  await expect(page.locator('#lbMsg')).toContainText('Thanks, MKX!');
  expect(sent).toEqual({ farm: 'middlebourne-farm', version: 0, score: 1213, code: 'Harvest←{⍵≥Ripe}', initials: 'MKX' });
});

test('the Leaderboard page shows every farm’s top 10, without playing a season', async ({ page }) => {
  await page.route(`${LEADERBOARD}/**`, route => {
    const farm = new URL(route.request().url()).searchParams.get('farm');
    return route.fulfill({ json: farm === 'sunnyhill-farm'
      ? { entries: [{ initials: 'SUN', score: 2132, date: '2026-11-01' }], checking: 2, pending: [] }
      : { entries: [], pending: [] } });
  });
  await page.goto(PAGE);
  await page.click('#openBoard');
  await expect(page.locator('#panelTitle')).toHaveText('Leaderboard');
  await expect(page.locator('#boards h3')).toHaveText(['Middlebourne Farm', 'Sunnyhill Farm', 'Marshgate Farm', 'Crowhurst Farm (experimental)', 'Blightwick Farm (experimental)']);
  await expect(page.locator('#boards ol[data-farm="sunnyhill-farm"]')).toContainText('SUN');
  await expect(page.locator('#boards ol[data-farm="sunnyhill-farm"] li.checking')).toHaveText('2 scores being checked');
  await expect(page.locator('#boards ol[data-farm="middlebourne-farm"]')).toContainText('No scores yet');
});

test('the simple view frames Harvest, taps in names, and switches to the code view and back', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('acres:editor'));
  await page.goto(PAGE);
  const body = page.locator('#hBody'), code = page.locator('#code'), status = page.locator('#status');
  await expect(page.locator('#framed')).toBeVisible();
  await expect(code).toBeHidden();
  await expect(body).toHaveValue('0');
  await expect(page.locator('.frame-edge').first()).toHaveText('Harvest←{');

  // Typing and tapping names edit the inside; the full program is what's run and saved.
  await body.fill('');
  for (const w of ['⍵', '=', 'Ripe']) await page.locator('#words button', { hasText: new RegExp(`^${w}$`) }).click();
  await expect(body).toHaveValue('⍵=Ripe');
  await expect(status).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => localStorage.getItem('allotment:apl'))).toBe('Harvest←{⍵=Ripe}\n');

  // The full view shows the whole program, and a program that still fits goes back to the simple view.
  await page.click('#viewToggle');
  await expect(code).toBeVisible();
  await expect(code).toHaveValue('Harvest←{⍵=Ripe}\n');
  await code.fill('Harvest←{\n  r←⍵=Ripe\n  r∨⍵=Rotten\n}\n');
  await page.click('#viewToggle');
  await expect(body).toHaveValue('r←⍵=Ripe\nr∨⍵=Rotten');

  // A program with more than Harvest and Scare stays in the full view, and says why.
  await page.click('#viewToggle');
  await code.fill('Ripe2←{⍵=Ripe}\nHarvest←{Ripe2 ⍵}\n');
  await page.click('#viewToggle');
  await expect(code).toBeVisible();
  await expect(page.locator('#msg')).toContainText('can only be edited in the code view');
  await page.reload();
  await expect(code).toBeVisible();
  await expect(code).toHaveValue('Ripe2←{⍵=Ripe}\nHarvest←{Ripe2 ⍵}\n');

  // On Crowhurst Farm, reached with ?god on a touch screen, Scare gets its own frame.
  await code.fill('Harvest←{0}\n');
  await page.click('#viewToggle');
  await page.goto(`${PAGE}?god`);
  await expect(page.locator('#godBadge')).toBeVisible();
  await page.selectOption('#farm', 'crowhurst-farm');
  await expect(page.locator('#scareFrame')).toBeVisible();
  await page.locator('#sBody').fill('8 8⍴(⍳64)∊10 30');
  await expect(status).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => localStorage.getItem('allotment:apl'))).toBe('Harvest←{0}\nScare←{8 8⍴(⍳64)∊10 30}\n');
  await expect(page.locator('#field')).toHaveAttribute('data-scarecrows', '2');
  await page.goto(`${PAGE}?god=off`);
  await expect(page.locator('#godBadge')).toBeHidden();
});

test('on a touch screen the simple view builds code by tapping, without the keyboard', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });
  const page = await context.newPage();
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
  await page.reload();
  await page.selectOption('#farm', 'practice'); // where ∨ is already unlocked
  const body = page.locator('#hBody'), tap = async label => page.locator('#words button, #keys button').filter({ hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }).first().tap();
  await expect(body).toHaveAttribute('inputmode', 'none');
  await body.tap();
  await tap('⌫');
  await expect(body).toHaveValue('');
  for (const label of ['(', '⍵', '=', 'Rotten', ')']) await tap(label);
  await page.locator('#glyphs button[aria-label="Or"]').tap();
  for (const label of ['⍵', '=', 'Ripe']) await tap(label);
  await expect(body).toHaveValue('(⍵=Rotten)∨⍵=Ripe');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await tap('⌨');
  await expect(body).toHaveAttribute('inputmode', 'text');
  await context.close();
});

test('errors show once, under the code, and a helper used like a stage gets a plain explanation', async ({ page }) => {
  await page.selectOption('#farm', 'practice');
  const code = page.locator('#code'), diag = page.locator('#diag'), msg = page.locator('#msg');
  await code.fill('Harvest←{(⍵=Rotten)∧⍵=BumperCrops}');
  await expect(diag).toHaveText('BumperCrops is a helper, not a stage: give it the field, as in BumperCrops ⍵');
  await page.click('#step');
  await expect(msg).toHaveText('Fix the error shown under your code to play.');
  await expect(diag).toHaveText('BumperCrops is a helper, not a stage: give it the field, as in BumperCrops ⍵');
  await code.fill('Harvest←{(⍵=Rotten)∨BumperCrops ⍵}');
  await expect(diag).toHaveText('');
});

test('the farming guide shows why brackets matter, reading right to left', async ({ page }) => {
  await page.selectOption('#farm', 'practice');
  await page.click('#openGuide');
  const field = page.locator('#field');
  await page.getByRole('button', { name: 'Show me what (⍵=Rotten)∨⍵=Ripe would harvest today' }).click();
  await expect(field).toHaveAttribute('data-preview', 'example');
  const withBrackets = Number(await field.getAttribute('data-picked'));
  await page.getByRole('button', { name: 'Show me what ⍵=Rotten∨⍵=Ripe would harvest today' }).click();
  const without = Number(await field.getAttribute('data-picked'));
  expect(withBrackets).toBeGreaterThan(without);
  await page.getByRole('button', { name: 'Show me what ripe←⍵=Ripe ⋄ ripe∨⍵=Rotten would harvest today' }).click();
  expect(Number(await field.getAttribute('data-picked'))).toBe(withBrackets);
});

test('the game loads nothing from other sites, apart from the leaderboard', async ({ page }) => {
  const elsewhere = [];
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith(LEADERBOARD)) elsewhere.push(u); });
  await page.goto(PAGE);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => document.fonts.check('800 40px "Bricolage Grotesque"'))).toBe(true);
  expect(elsewhere).toEqual([]);
});

test('on big screens the field grows but the field and stats still fit without scrolling; smaller screens keep the old size', async ({ browser }) => {
  for (const [width, height, fits] of [[2560, 1300, true], [2560, 1150, true], [1440, 900, false], [1366, 768, false]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(PAGE);
    await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
    await page.reload();
    const field = await page.locator('#field').boundingBox(), panel = await page.locator('section.plot').boundingBox();
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // opens at the top, not jumped to the code
    expect(field.width).toBeGreaterThanOrEqual(479);
    if (fits) expect(panel.y + panel.height).toBeLessThanOrEqual(height);
    expect(panel.width - field.width).toBeLessThan(40); // the panel hugs the field, with no empty space beside it
    await page.close();
  }
});

test('each farm has its own soil and field edge', async ({ page }) => {
  await page.goto(`${PAGE}?god`);
  const look = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return cs.getPropertyValue('--soil').trim() + cs.getPropertyValue('--frame').trim(); });
  const seen = new Set();
  for (const farm of ['middlebourne-farm', 'sunnyhill-farm', 'marshgate-farm', 'crowhurst-farm']) {
    await page.selectOption('#farm', farm);
    await expect(page.locator('html')).toHaveAttribute('data-farm', farm);
    seen.add(await look());
  }
  expect(seen.size).toBe(4);
});

test('on a phone nothing runs off the side of the page', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(PAGE);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.close();
});

test('every name and key button explains itself when you hover over it', async ({ page }) => {
  await page.selectOption('#farm', 'practice');
  const buttons = page.locator('#words button, #keys button');
  const titles = await buttons.evaluateAll(bs => bs.map(b => b.title));
  expect(titles.length).toBeGreaterThan(20);
  expect(titles.every(t => t && t.length > 0)).toBe(true);
  await expect(page.locator('#words button', { hasText: /^Promising$/ })).toHaveAttribute('title', /bumper crop could form/);
});

test('accessibility: axe finds no problems on the page, its panels, a played day, Crowhurst or the code view', async ({ browser }) => {
  test.setTimeout(150000); // sixteen full scans, in both themes
  for (const colorScheme of ['light', 'dark']) {
    // Reduced motion, so panels appear at once: mid-slide, their text is still faint and fails contrast.
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route(`${LEADERBOARD}/**`, route => route.fulfill({ json: { entries: [], checking: 0, pending: [] } }));
    await page.goto(`${PAGE}?god`);
    await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
    await page.reload();
    const check = async where => {
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      expect(violations.map(v => `${colorScheme} ${where}: ${v.id} at ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await check('tutorial');                // a new player starts on the tutorial, with its locked controls
    await page.selectOption('#farm', 'middlebourne-farm');
    await check('main');
    for (const panel of ['openAbout', 'openHelp', 'openGuide', 'openBoard']) { await page.click(`#${panel}`); await check(panel); await page.click('#closePanel'); }
    await page.click('#step');
    await check('after a day');
    await page.selectOption('#farm', 'crowhurst-farm');
    await check('Crowhurst');
    await page.click('#viewToggle');
    await check('code view');
    await context.close();
  }
});

test('screen readers get the field as text, and hear what each day brought', async ({ page }) => {
  await page.selectOption('#farm', 'practice');
  await page.locator('#code').fill('Harvest←{⍵=Ripe}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const text = page.locator('#fieldText');
  await expect(page.locator('#field')).toHaveAttribute('aria-describedby', 'fieldText');
  await expect(text).toContainText('Your field on day 1 of 100. Row 1: ');
  await expect(text).toContainText('Row 8: ');
  await expect(text).toContainText('Ripe, picked');
  await page.click('#step');
  await expect(page.locator('#announce')).toHaveText(/^Day 1: \d+ points?.*\. Score \d+\.$/);
  await expect(text).toContainText('Your field on day 2 of 100.');
});

test('keyboard and touch: a skip link to the code, explanations on focus and long press, and the panel keeps focus on small screens', async ({ browser }) => {
  // Skip link: the first Tab reaches it, and it goes straight to the code box.
  let page = await browser.newPage();
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('acres:help-seen', '1')); // a first visit opens How to play instead
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#hBody')).toBeFocused();
  // Explanations show on keyboard focus.
  await page.locator('#words button').first().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.tip')).toBeVisible();
  await expect(page.locator('.tip')).toHaveText(/Equals/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tip')).toBeHidden();
  await page.close();

  // On a phone-sized touch screen: a long press explains without adding the name, and the panel takes over focus.
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
  await page.reload();
  const ripe = page.locator('#words button', { hasText: /^Ripe$/ });
  const box = await ripe.boundingBox();
  const before = await page.locator('#hBody').inputValue();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ripe.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('.tip')).toHaveText(/Ripe: ready to harvest/);
  await ripe.dispatchEvent('pointerup', { pointerType: 'touch' });
  await ripe.dispatchEvent('click');
  await expect(page.locator('#hBody')).toHaveValue(before);
  await page.click('#openHelp');
  expect(await page.evaluate(() => document.querySelector('.game').inert)).toBe(true);
  await page.click('#closePanel');
  expect(await page.evaluate(() => document.querySelector('.game').inert)).toBe(false);
  await context.close();
});

test('Blightwick Farm: blight in the field, the key, the name buttons, the guide, the rules and the report', async ({ page }) => {
  await page.goto(`${PAGE}?god`);
  const blighted = page.locator('#words button', { hasText: /^Blighted$/ });
  await expect(blighted).toHaveAttribute('aria-disabled', 'true'); // always there, but faded where blight doesn't grow
  await page.selectOption('#farm', 'blightwick-farm');
  await expect(page.locator('#weather')).toContainText('Blight 50%');
  await expect(blighted).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#fieldText')).toContainText('Blighted');
  expect(await page.locator('#rBlightStat').getAttribute('hidden')).toBeNull(); // shown in the report on Blightwick
  await page.click('#openHelp');
  await expect(page.locator('#rules')).toContainText('even if you cleared it that day');
  await page.click('#openGuide');
  await page.getByRole('button', { name: 'Show me what b←⍵=Blighted ⋄ 1↓b⍪0 would harvest today' }).click();
  await expect(page.locator('#field')).toHaveAttribute('data-preview', 'example');
  expect(Number(await page.locator('#field').getAttribute('data-picked'))).toBeGreaterThan(0);
  await page.click('#closePanel');
  await page.selectOption('#farm', 'middlebourne-farm');
  expect(await page.locator('#rBlightStat').getAttribute('hidden')).not.toBeNull();
});

test('switching from Practice Farm to a farm doesn’t shift the page, on desktop, tablet or phone', async ({ browser }) => {
  const parts = ['.farm-bar', 'section.plot', '#field', 'section.editor', '#words', '#run'];
  for (const [width, height] of [[1561, 877], [820, 1180], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(PAGE);
    await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
    await page.reload();
    const where = () => page.evaluate(sel => sel.map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.y), Math.round(b.height)]; }), parts);
    await page.selectOption('#farm', 'practice');
    const before = await where();
    await page.selectOption('#farm', 'middlebourne-farm');
    const after = await where();
    after.forEach(([y, h], i) => {
      expect(Math.abs(y - before[i][0]), `${parts[i]} moved at ${width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(h - before[i][1]), `${parts[i]} changed size at ${width}px`).toBeLessThanOrEqual(1);
    });
    await page.close();
  }
});

test('helpers are always there to see, greyed out until unlocked, and pressing a locked one says what unlocks it', async ({ page }) => {
  const promising = page.locator('#words button', { hasText: /^Promising$/ });
  await expect(promising).toHaveAttribute('aria-disabled', 'true');
  await expect(promising).toHaveAttribute('title', /unlocks with Silver on Sunnyhill Farm/);
  const before = await page.locator('#code').inputValue();
  await promising.click({ force: true }); // Playwright won't press an aria-disabled button by default; players can
  await expect(page.locator('#msg')).toHaveText('Promising unlocks with Silver on Sunnyhill Farm.');
  await expect(page.locator('#code')).toHaveValue(before);
  await page.selectOption('#farm', 'practice');
  await expect(promising).not.toHaveAttribute('aria-disabled', 'true');
});

test('a newcomer’s first taps replace the starter 0, so ⍵ = Ripe gives ⍵=Ripe', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('acres:editor', 'simple')); // the view a newcomer sees
  await page.reload();
  const body = page.locator('#hBody');
  await expect(body).toHaveValue('0');
  for (const word of ['⍵', '=', 'Ripe']) await page.locator('#words button', { hasText: new RegExp(`^${word}$`) }).click();
  await expect(body).toHaveValue('⍵=Ripe');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  // Clicking into the untouched starter selects it, so typing replaces it too.
  await page.click('#resetCode');
  await body.click();
  await page.keyboard.type('1');
  await expect(body).toHaveValue('1');
});

test('Practice Farm can borrow crows and blight, but only once Gold has unlocked them', async ({ page }) => {
  // A new player: the toggles are there, so nothing jumps, but faded, and pressing one says what unlocks it.
  await page.selectOption('#farm', 'practice');
  await expect(page.locator('#practiceCrows')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#practiceBlight')).toHaveAttribute('title', /unlocks with Gold on any farm/);
  await page.locator('#practiceCrows').click({ force: true });
  await expect(page.locator('#msg')).toHaveText('Crows for Practice Farm unlock with Gold on any farm.');
  await expect(page.locator('#weather')).not.toContainText('Crows');
  // With everything unlocked, both appear, and each one switches its mechanic on, with a new field.
  await page.goto(`${PAGE}?god`);
  await page.selectOption('#farm', 'practice');
  const crows = page.locator('#practiceCrows'), blight = page.locator('#practiceBlight');
  await expect(crows).not.toHaveAttribute('aria-disabled', 'true');
  await expect(crows).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#weather')).not.toContainText('Crows');
  await crows.click();
  await expect(crows).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rules')).toContainText('Crows:'); // the pressed button shows crows are on; no extra chip
  await expect(page.locator('#weather')).not.toContainText('Crows');
  await expect(page.locator('#rules')).toContainText('Crows:');
  await expect(page.locator('#msg')).toHaveText('New field planted, with crows.');
  await blight.click();
  await expect(page.locator('#msg')).toHaveText('New field planted, with crows and blight.');
  await expect(page.locator('#rules')).toContainText('Blight:');
  await expect(page.locator('#words button', { hasText: /^Blighted$/ })).not.toHaveAttribute('aria-disabled', 'true');
  // Scarecrows work on Practice too.
  await page.locator('#code').fill('Harvest←{⍵=Ripe}\nScare←{8 8⍴1,63⍴0}');
  await expect(page.locator('#field')).toHaveAttribute('data-scarecrows', '1');
  // The message always describes the field you have, whichever button was pressed.
  await crows.click();
  await expect(page.locator('#msg')).toHaveText('New field planted, with blight.');
  await blight.click();
  await expect(page.locator('#msg')).toHaveText('New field planted, with no crows or blight.');
  await crows.click();
  // The choices are remembered, and other farms are unaffected.
  await page.reload();
  await expect(page.locator('#practiceCrows')).toHaveAttribute('aria-pressed', 'true');
  await page.selectOption('#farm', 'middlebourne-farm');
  await expect(page.locator('#weather')).not.toContainText('Crows');
  await expect(page.locator('#practiceCrows')).toBeHidden();
});

test('changing code mid-season is allowed, but the mixed score sets no best or medal, and one click replays it properly', async ({ page }) => {
  await page.locator('#code').fill('Harvest←{⍵=Ripe}');
  await page.click('#step');
  await page.click('#step');
  await page.locator('#code').fill('Harvest←{⍵≥Ripe}');
  await page.click('#step');
  await expect(page.locator('#msg')).toHaveText(/^Your code changed on day 3: this season’s score now mixes two programs/);
  await page.selectOption('#speed', '30');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText(/Season complete\. You scored \d+ points, with your code changed on day 3\./, { timeout: 60000 });
  await expect(page.locator('#mixedNote')).toBeVisible();
  await expect(page.locator('#compare')).toBeHidden();
  await expect(page.locator('#lbSection')).toBeHidden();
  await expect(page.locator('#sBest')).toHaveText('–'); // no personal best from a mixed season
  // Restart with this code plays the current program from day 1, and that season counts.
  await page.click('#restartSame');
  await expect(page.locator('#msg')).toHaveText('Season complete. You scored 1213 points.', { timeout: 60000 });
  await expect(page.locator('#mixedNote')).toBeHidden();
  await expect(page.locator('#sBest')).toHaveText('1213');
});

test('buttons never move: not when pressing Crows or Blight, and not when switching farms', async ({ browser }) => {
  const where = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('button, select')]
    .filter(b => b.offsetParent && !b.closest('#panel'))
    .map(b => { const r = b.getBoundingClientRect(); return [b.id || b.textContent.trim(), [Math.round(r.x), Math.round(r.y)]]; })));
  const same = (a, b, what) => { for (const k of Object.keys(b)) if (a[k]) expect(b[k], `${k} moved ${what}`).toEqual(a[k]); };
  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${PAGE}?god`);
    await page.evaluate(() => { localStorage.setItem('acres:help-seen', '1'); localStorage.setItem('acres:editor', 'simple'); });
    await page.reload();
    await page.selectOption('#farm', 'practice');
    for (const id of ['practiceCrows', 'practiceBlight', 'practiceCrows', 'practiceBlight']) {
      const before = await where(page);
      await page.click(`#${id}`);
      same(before, await where(page), `pressing ${id} at ${width}px`);
    }
    // Tutorial Farm is left out: it shows a simpler interface, so moving into or out of it may shift things.
    for (const farm of ['middlebourne-farm', 'crowhurst-farm', 'blightwick-farm', 'practice']) {
      const before = await where(page);
      await page.selectOption('#farm', farm);
      same(before, await where(page), `switching to ${farm} at ${width}px`);
    }
    await page.close();
  }
});

test('the page has its own icon: the ripe plant, built into the page', async ({ page }) => {
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/png;base64,/);
});

test('the footer shows the version and rules for bug reports, with a link to report a problem', async ({ page }) => {
  await expect(page.locator('#buildInfo')).toHaveText(/^Array Acres prototype \d+\.\d+ · rules v2$/);
  await expect(page.getByRole('link', { name: 'Report a problem' })).toHaveAttribute('href', 'https://github.com/dragnim/array-acres/issues');
});

test('the tutorial: twelve steps, each with only its own controls working and a glow on whatever it talks about, then free play', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(PAGE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('acres:help-seen', '1'); });
  await page.reload();
  const step = page.locator('#tutStep'), next = page.locator('#tutNext');
  const glowing = id => expect(page.locator(`#${id}`)).toHaveClass(/tut-glow/);
  const plots = list => expect(page.locator('#field')).toHaveAttribute('data-tut-plots', list);
  const at = n => expect(step).toHaveText(`Tutorial, step ${n} of 12`);
  await expect(page.locator('#farm')).toHaveValue('tutorial-farm');
  await expect(page.locator('#farm option').first()).toHaveText('Tutorial Farm');
  await expect(page.locator('#targets')).toBeHidden();
  await expect(page.locator('#glyphs')).toBeHidden();
  await expect(page.locator('#resetCode')).toBeHidden(); // Restart puts a step's rule back instead
  await expect(page.locator('#words button')).toHaveText(['⍵', '=', '≥', 'Seed', 'Sprout', 'Growing', 'Ripe', 'Rotten']);
  // 1: the farm. Nothing works yet but Next and Restart; on a reading step, Next glows too.
  await at(1); await glowing('field'); await glowing('tutNext');
  for (const id of ['step', 'run', 'prevDay']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.locator('#words')).toHaveClass(/tut-locked/);
  await expect(page.locator('#field')).toHaveAttribute('data-answers', 'off'); // no 1s and 0s until step 4
  await next.click();
  // 2: the stages, with the ripe plants and the rotten one glowing.
  await at(2); await plots('0,3 1,2 1,3 2,1 3,0');
  await next.click();
  // 3: ⍵.
  await at(3); await glowing('framed'); await glowing('tutNext');
  await next.click();
  // 4: the glow leads from ⍵ to = to Ripe; Next waits until it's done.
  await at(4); await expect(next).toBeDisabled(); await expect(next).not.toHaveClass(/tut-glow/); // not until it's done
  for (const word of ['⍵', '=', 'Ripe']) {
    const button = page.locator('#words button', { hasText: new RegExp(`^${word}$`) });
    await expect(button).toHaveClass(/tut-glow/);
    await button.click();
  }
  await expect(next).toBeEnabled(); await glowing('tutNext');
  await expect(page.locator('#field')).toHaveAttribute('data-answers', 'on');
  await next.click();
  // 5: the 1s glow.
  await at(5); await plots('0,3 1,2 2,1 3,0');
  await next.click();
  // 6 and 7: Next day, and nothing else, works.
  await at(6); await glowing('step'); await expect(page.locator('#run')).toBeDisabled();
  await page.click('#step');
  // What happened is told inside the tutorial box, and scores say points.
  await expect(page.locator('#tutMsg')).toHaveText(/^Day 1: you harvested 4 plots, scoring 4 points\. 15 plants grew a stage overnight\.$/);
  await expect(page.locator('#msg')).toHaveText('');
  await next.click();
  await at(7); await plots('0,2 1,1 2,0 2,2 3,1');
  // Back and Next move the farm with the steps: back to step 6 undoes day 1, and the rule stays ⍵=Ripe.
  await page.click('#tutBack');
  await at(6); await expect(page.locator('#sTick')).toHaveText('0/20'); await expect(next).toBeDisabled();
  await page.click('#step');
  await next.click();
  await at(7); await expect(page.locator('#sTick')).toHaveText('1/20');
  await page.click('#step');
  await next.click();
  // 8 to 10: pick too early, see the waste, undo it.
  await at(8); await page.locator('#hBody').fill('⍵≥Growing');
  await next.click();
  await at(9); await glowing('step');
  await page.click('#step');
  await expect(page.locator('#tutMsg')).toContainText('harvested too early and wasted');
  await next.click();
  await at(10); await glowing('prevDay'); await expect(page.locator('#step')).toBeDisabled();
  await page.click('#prevDay');
  await expect(page.locator('#sWasted')).toHaveText('0');
  await next.click();
  // 11: Play season only works once the rule is ⍵=Ripe again; a season that leaves ripe plants doesn't finish it.
  await at(11); await expect(page.locator('#run')).toBeDisabled();
  await page.locator('#hBody').fill('⍵=Ripe');
  await expect(page.locator('#run')).toBeEnabled(); await glowing('run');
  await page.click('#run');
  await expect(page.locator('#tutMsg')).toHaveText('Season complete. You scored 99 points, with nothing wasted.', { timeout: 30000 });
  await expect(page.locator('#panel')).toBeHidden();
  await next.click();
  // 12: done. Back from here un-plays the season; Restart puts a step back to its start.
  await at(12);
  await page.click('#tutBack');
  await at(11); await expect(page.locator('#sTick')).toHaveText('2/20'); await expect(page.locator('#hBody')).toHaveValue('⍵≥Growing');
  await page.locator('#hBody').fill('⍵=Ripe');
  await page.click('#restart');
  await expect(page.locator('#hBody')).toHaveValue('⍵≥Growing');
  await expect(page.locator('#tutMsg')).toContainText('Your rule was reset to match this step.');
  await page.locator('#hBody').fill('⍵=Ripe');
  await page.click('#run');
  await expect(page.locator('#tutMsg')).toHaveText('Season complete. You scored 99 points, with nothing wasted.', { timeout: 30000 });
  await next.click();
  // Play freely unlocks the farm, remembered between visits.
  await at(12);
  await expect(next).toHaveText('Play freely');
  await expect(page.locator('#tutSkip')).toHaveText('Go to Middlebourne');
  await next.click();
  await expect(step).toHaveText('Tutorial complete');
  for (const id of ['step', 'run', 'prevDay']) await expect(page.locator(`#${id}`)).toBeEnabled();
  await expect(page.locator('#glyphs')).toBeVisible();
  await page.reload();
  await expect(step).toHaveText('Tutorial complete');
  await expect(next).toHaveText('Replay the tutorial');
  await next.click();
  await at(1);
  // Skip tutorial, for players who know APL already; the intro's link starts it again.
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
  await expect(page.locator('#prevDay')).toHaveAttribute('aria-disabled', 'true');
  await page.click('#playTutorial');
  await at(1);
  await page.close();
});

test('nothing moves between the tutorial’s steps, on desktop, tablet or phone', async ({ browser }) => {
  const where = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('button, select')]
    .filter(b => b.offsetParent && !['tutNext', 'tutSkip'].includes(b.id) && getComputedStyle(b).visibility !== 'hidden')
    // Positions on the page, not the screen, since pressing Next may scroll it into view.
    .map(b => { const r = b.getBoundingClientRect(); return [b.id || b.textContent.trim(), [Math.round(r.x + scrollX), Math.round(r.y + scrollY)]]; })));
  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${PAGE}?god`); // ?god lets Next skip ahead without doing each step's task
    await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
    await page.reload();
    await page.selectOption('#farm', 'tutorial-farm');
    const first = await where(page);
    for (let i = 2; i <= 12; i++) {
      await page.click('#tutNext');
      await expect(page.locator('#tutStep')).toHaveText(`Tutorial, step ${i} of 12`);
      expect(await where(page), `step ${i} at ${width}px`).toEqual(first);
    }
    await page.close();
  }
});

test('no key: the stage buttons show their pictures, plots explain themselves, and Show answers works on any farm', async ({ page }) => {
  await expect(page.locator('#legend')).toHaveCount(0);
  for (const stage of ['Seed', 'Sprout', 'Growing', 'Ripe', 'Rotten'])
    await expect(page.locator('#words button', { hasText: new RegExp(`${stage}$`) }).locator('img.word-pic')).toHaveCount(1);
  await page.locator('#code').fill('Harvest←{⍵=Ripe}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  // Hovering over a plot says what's there and what Harvest makes of it.
  const box = await page.locator('#field').boundingBox();
  await page.mouse.move(box.x + box.width / 16, box.y + box.height / 16);
  await expect(page.locator('.tip')).toHaveText(/^Row 1, column 1: (Seed|Sprout|Growing|Ripe|Rotten)\. Harvest (picks|leaves) it \([01]\)\.$/);
  await page.mouse.move(0, 0);
  // Show answers puts the 1s and 0s on the field, and is remembered.
  await expect(page.locator('#field')).toHaveAttribute('data-answers', 'off');
  await page.click('#showAnswers');
  await expect(page.locator('#field')).toHaveAttribute('data-answers', 'on');
  await expect(page.locator('#showAnswers')).toHaveText('Hide answers');
  await page.reload();
  await expect(page.locator('#field')).toHaveAttribute('data-answers', 'on');
});

test('the tutorial never touches a returning player’s own program or their choice of the code view', async ({ page }) => {
  const mine = 'Harvest←{\n  ripe←⍵=Ripe\n  ripe∨⍵=Rotten\n}\nNote←{⍵}\n';
  await page.evaluate(code => { localStorage.setItem('allotment:apl', code); localStorage.setItem('acres:editor', 'full'); }, mine);
  await page.reload();
  await expect(page.locator('#code')).toHaveValue(mine);
  // Into the tutorial: the simple view and the lesson's own starting rule.
  await page.click('#playTutorial');
  await expect(page.locator('#hBody')).toBeVisible();
  await expect(page.locator('#hBody')).toHaveValue('0');
  for (let i = 0; i < 3; i++) await page.click('#tutNext');
  for (const word of ['⍵', '=', 'Ripe']) await page.locator('#words button', { hasText: new RegExp(`${word}$`) }).click();
  await page.click('#tutNext'); await page.click('#tutNext');
  await page.click('#step');
  // Back to Middlebourne: the player's program and the code view, exactly as they were.
  await page.selectOption('#farm', 'middlebourne-farm');
  await expect(page.locator('#code')).toBeVisible();
  await expect(page.locator('#code')).toHaveValue(mine);
  expect(await page.evaluate(() => [localStorage.getItem('allotment:apl'), localStorage.getItem('acres:editor')])).toEqual([mine, 'full']);
  await page.reload();
  await expect(page.locator('#code')).toHaveValue(mine);
});

test('free play on Tutorial Farm: Previous day undoes several days, and a new rule carries the season on', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('acres:tutorial-done', '1'); localStorage.setItem('acres:editor', 'simple'); });
  await page.reload();
  await page.selectOption('#farm', 'tutorial-farm');
  await expect(page.locator('#tutStep')).toHaveText('Tutorial complete');
  await page.locator('#hBody').fill('⍵=Ripe');
  await page.click('#step'); await page.click('#step');
  await page.locator('#hBody').fill('⍵≥Growing');
  await page.click('#step'); await page.click('#step');
  await expect(page.locator('#sTick')).toHaveText('4/20');
  await expect(page.locator('#sWasted')).not.toHaveText('0');
  // Undo the two wasteful days, then carry on with ⍵=Ripe: the same as playing ⍵=Ripe all season.
  await page.click('#prevDay'); await page.click('#prevDay');
  await expect(page.locator('#sTick')).toHaveText('2/20');
  await expect(page.locator('#sWasted')).toHaveText('0');
  await expect(page.locator('#msg')).toHaveText('Back to the start of day 3.');
  await page.locator('#hBody').fill('⍵=Ripe');
  await page.click('#run');
  await expect(page.locator('#msg')).toHaveText('Season complete. You scored 99 points.', { timeout: 30000 });
  await expect(page.locator('#sWasted')).toHaveText('0');
});

test('the title screen: at the start of each visit, with ways in for new and returning players, and links', async ({ browser }) => {
  const context = await browser.rawNewContext({ reducedMotion: 'reduce' }); // the stages are still, so the scan sees them as players do
  const page = await context.newPage();
  await page.goto(PAGE);
  const title = page.locator('#welcome'), start = page.locator('#welcomeStart'), second = page.locator('#welcomeSkip');
  await expect(title).toBeVisible();
  await expect(page.locator('#welcomeTitle svg')).toHaveAttribute('aria-label', 'Array Acres');
  await expect(start).toBeFocused();
  await expect(page.locator('#welcomeStages img')).toHaveCount(4);
  expect(await page.evaluate(() => document.querySelector('.wrap').inert)).toBe(true); // the page behind can't be reached
  const scan = async () => {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(violations.map(v => `${v.id} at ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await scan();
  // A new player: start or skip the tutorial. Tab stays inside the title screen.
  await expect(start).toHaveText('Start the tutorial');
  await expect(second).toHaveText('Skip the tutorial');
  await expect(page.locator('.welcome-links a')).toHaveAttribute('href', 'https://github.com/dragnim/array-acres');
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('.welcome-links a')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(start).toBeFocused();
  await start.click();
  await expect(title).toBeHidden();
  await expect(page.locator('#tutStep')).toHaveText('Tutorial, step 1 of 12');
  await expect(page.locator('#panel')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('.wrap').inert)).toBe(false);
  // Not on a reload, but the logo in the header opens it again; Escape carries on.
  await page.reload();
  await expect(title).toBeHidden();
  await page.click('#openWelcome');
  await expect(title).toBeVisible();
  await expect(start).toHaveText('Continue the tutorial');
  await page.keyboard.press('Escape');
  await expect(title).toBeHidden();
  // A returning player's next visit (a new tab): carry on where they were, or play the tutorial again.
  await page.evaluate(() => localStorage.setItem('acres:farm', 'middlebourne-farm'));
  const next = await context.newPage();
  await next.goto(PAGE);
  await expect(next.locator('#welcome')).toBeVisible();
  await expect(next.locator('#welcomeStart')).toHaveText('Continue on Middlebourne Farm');
  await expect(next.locator('#welcomeSkip')).toHaveText('Play the tutorial');
  // The links: the leaderboard and What is APL? open their panels.
  await next.click('#welcomeBoard');
  await expect(next.locator('#welcome')).toBeHidden();
  await expect(next.locator('#panelTitle')).toHaveText('Leaderboard');
  await next.click('#openWelcome');
  await next.click('#welcomeAbout');
  await expect(next.locator('#panelTitle')).toHaveText('What is APL?');
  await next.click('#openWelcome');
  await next.click('#welcomeSkip');
  await expect(next.locator('#farm')).toHaveValue('tutorial-farm');
  await expect(next.locator('#tutStep')).toHaveText('Tutorial, step 1 of 12');
  // Skip the tutorial, on a first visit: Middlebourne Farm, with How to play open.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await second.click();
  await expect(page.locator('#farm')).toHaveValue('middlebourne-farm');
  await expect(page.locator('#panelTitle')).toHaveText('How to play');
  await context.close();
});
