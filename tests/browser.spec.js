// Browser test for the editor: preview, stale state, diagnostics, stepping and a full season.
// Run with `npm run test:browser`. Waits on the page's own state, never on fixed delays.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

// How to play opens by itself on a first visit. Most tests start as a returning player.
// (Set by visiting once, not with an init script: init scripts that touch storage can lose it on reload.)
const returning = async page => {
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.setItem('acres:help-seen', '1'));
};
test.beforeEach(async ({ page }) => { await returning(page); });

test('preview and diagnostics follow the code and the field', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);
  await page.selectOption('#farm', 'practice'); // every symbol is unlocked on Practice Farm

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
  await expect(page.locator('#msg')).toHaveText(/^Season over\. You scored \d+\.$/, { timeout: 30000 });
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
  await expect(page.locator('#readout')).toHaveText(/^Day 100: \d+ ripe plots? lost to rot$/);

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
    await expect(msg).toHaveText(/^Season over\./, { timeout: 30000 });
  };
  await page.selectOption('#speed', '30');

  // A new player starts on Manor Farm.
  await expect(page.locator('#farm')).toHaveValue('manor-farm');
  await expect(page.locator('#weather')).toHaveText('Sunshine 55%Rainfall 20%');
  await expect(page.locator('#farm option[value="bramley-farm"]')).toBeDisabled();
  await expect(page.locator('#newField')).toBeDisabled();

  // Bronze on Manor Farm.
  await playSeason('Harvest←{⍵≥3}');
  await expect(page.locator('#cmpThis')).toHaveText('1213');
  await expect(page.locator('#cmpStatus')).toHaveText('Your first result on this farm.');
  await expect(page.locator('#cmpTier')).toHaveText('You reached Bronze. Silver is 1350.');
  await expect(unlock).toHaveText('Unlocked: ∧ ∨ ~, the BumperCrops helper and Bramley Farm. See the field guide.');
  // The field guide button shows New until the guide is opened, here from the report's link.
  await expect(page.locator('#guideNew')).toBeVisible();
  await unlock.getByRole('button', { name: 'See the field guide' }).click();
  await expect(page.locator('#panelTitle')).toHaveText('Field guide');
  await expect(page.locator('#guideNew')).toBeHidden();
  await expect(page.locator('.tier[data-tier="bronze"]')).toHaveAttribute('data-earned', 'true');
  await expect(page.locator('#farm option[value="bramley-farm"]')).toBeEnabled();

  // A run that doesn't improve keeps the best and unlocks nothing new.
  await playSeason('Harvest←{⍵=3}');
  await expect(page.locator('#cmpStatus')).toHaveText('Your personal best stays at 1213.');
  await expect(unlock).toBeHidden();

  // Bests, unlocks and the chosen farm survive a reload.
  await page.reload();
  await expect(page.locator('#farm')).toHaveValue('manor-farm');
  await expect(best).toHaveText('1213');
  await expect(page.locator('#farm option[value="bramley-farm"]')).toBeEnabled();

  // Silver on Bramley Farm, harvesting only bumper crops.
  await page.selectOption('#farm', 'bramley-farm');
  await expect(best).toHaveText('–');
  await page.selectOption('#speed', '30');
  await playSeason('Harvest←{(⍵=4)∨BumperCrops ⍵}');
  await expect(page.locator('#cmpTier')).toHaveText('You reached Silver. Gold is 2100.');
  await expect(unlock).toHaveText('Unlocked: the Promising helper and Nuthanger Farm. See the field guide.');

  // Gold with the helpers, which unlocks everything else.
  await playSeason('Harvest←{(⍵=4)∨(BumperCrops ⍵)∨(⍵=3)∧~Promising ⍵}');
  await expect(page.locator('#cmpTier')).toHaveText('Gold reached! You’ve found a powerful strategy. Can you do even better?');
  await expect(unlock).toHaveText('Unlocked: every symbol, the Squares helper and the helpers’ source code. See the field guide.');
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
  await expect(diag).toHaveText('∨ unlocks with Bronze on Manor Farm. Practice Farm has every symbol and helper.');
  await expect(page.locator('.guide-item[data-locked="true"]')).toHaveCount(4);

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
    await expect(page.locator('#field')).toHaveAttribute('data-giants', String(AcresCore.ripeSquares(st.field).length));
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
  expect(errors).toEqual([]);
});

test('the rules on the page state the numbers the game actually uses', async ({ page }) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
  const { AcresCore } = new Function(script('apl-interpreter') + '\n' + script('acres-core') + '\nreturn { AcresCore };')();
  const R = AcresCore.RULES, pct = p => `${Math.round(p * 100)}%`;

  // The rules follow the chosen farm's weather. Every farm is unlocked for this test.
  await page.addInitScript(() => localStorage.setItem('acres:bests', JSON.stringify({
    'v2:manor-farm': { score: 9999 }, 'v2:bramley-farm': { score: 9999 }, 'v2:nuthanger-farm': { score: 9999 } })));
  await page.goto(PAGE);
  for (const f of AcresCore.FARMS) {
    await page.selectOption('#farm', f.id);
    const rules = await page.locator('#rules').innerText();
    for (const claim of [`${R.size}×${R.size}`, `${R.days} days`, `${pct(f.sunshine)} chance to grow`, `${pct(f.rainfall)} chance to rot`, `scores ${R.bonus} instead`])
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

test('the field can show its numbers, exactly as Harvest sees them', async ({ page }) => {
  await page.goto(PAGE);
  const field = page.locator('#field'), btn = page.locator('#showNumbers');
  await expect(page.locator('.field-title')).toHaveText('Today’s field, ⍵');
  await expect(field).toHaveAttribute('data-numbers', 'off');
  await btn.click();
  await expect(field).toHaveAttribute('data-numbers', 'on');
  await expect(btn).toHaveText('Hide numbers');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(field).toHaveAttribute('data-numbers', 'on');
  await page.locator('#showNumbers').click();
  await expect(field).toHaveAttribute('data-numbers', 'off');
});

test('code saved before Giants was renamed BumperCrops still works', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('acres:bests', JSON.stringify({ 'v2:manor-farm': { score: 9999 } }));
    localStorage.setItem('allotment:apl', 'Harvest←{(⍵=4)∨Giants ⍵}');
  });
  await page.goto(PAGE);
  await expect(page.locator('#code')).toHaveValue('Harvest←{(⍵=4)∨BumperCrops ⍵}');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
});

test('How to play opens on a first visit, and the side panel switches and closes', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(PAGE);
  const panel = page.locator('#panel'), title = page.locator('#panelTitle');

  await expect(panel).toBeVisible();
  await expect(title).toHaveText('How to play');
  await expect(page.locator('#rules li')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Only on the first visit.
  await page.reload();
  await expect(panel).toBeHidden();

  await page.click('#openGuide');
  await expect(title).toHaveText('Field guide');
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

  // Esc in the editor leaves it for Tab, and doesn't close the panel.
  await page.click('#openGuide');
  await page.locator('#code').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page.close();
});
