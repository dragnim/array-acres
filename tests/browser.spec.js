// Browser test for the editor: preview, stale state, diagnostics, stepping and a full season.
// Run with `npm run test:browser`. Waits on the page's own state, never on fixed delays.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

test('preview and diagnostics follow the code and the field', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);

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

test('farms keep separate personal bests that survive a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE);

  const code = page.locator('#code'), status = page.locator('#status');
  const best = page.locator('#sBest'), msg = page.locator('#msg');
  const playSeason = async src => {
    await code.fill(src);
    await expect(status).toHaveAttribute('data-state', 'ready');
    await page.click('#restart');
    await page.click('#run');
    await expect(msg).toHaveText(/^Season over\./, { timeout: 30000 });
  };

  await page.selectOption('#farm', 'nuthanger-farm');
  await expect(page.locator('#weather')).toHaveText('Sunshine 50%Rainfall 25%');
  await expect(page.locator('#newField')).toBeDisabled();
  await expect(best).toHaveText('–');
  await page.selectOption('#speed', '30');

  // First result: recorded, with no previous best to compare against.
  await playSeason('Harvest←{⍵≥3}');
  await expect(page.locator('#cmpThis')).toHaveText('1093');
  await expect(page.locator('#cmpStatus')).toHaveText('Your first result on this farm.');
  await expect(best).toHaveText('1093');
  await expect(page.locator('#cmpTier')).toHaveText('You reached Bronze. Silver is 1150.');
  await expect(page.locator('.tier[data-tier="bronze"]')).toHaveAttribute('data-earned', 'true');
  await expect(page.locator('.tier[data-tier="silver"]')).toHaveAttribute('data-earned', 'false');

  // A worse run doesn't replace it.
  await playSeason('Harvest←{⍵=3}');
  await expect(page.locator('#cmpPrev')).toHaveText('1093');
  await expect(page.locator('#cmpStatus')).toHaveText('Your personal best stays at 1093.');
  await expect(best).toHaveText('1093');

  // Bests and the chosen farm survive a reload.
  await page.reload();
  await expect(page.locator('#farm')).toHaveValue('nuthanger-farm');
  await expect(best).toHaveText('1093');

  // Other farms have their own bests, and Practice Farm has none to keep.
  await page.selectOption('#farm', 'manor-farm');
  await expect(best).toHaveText('–');
  await expect(page.locator('.tier[data-earned="true"]')).toHaveCount(0);

  // Reaching Gold celebrates without claiming the puzzle is solved.
  await playSeason(fs.readFileSync(path.join(__dirname, '..', 'reference', 'hybrid.apl'), 'utf8'));
  await expect(page.locator('#cmpTier')).toHaveText('Gold reached! You’ve found a powerful strategy. Can you do even better?');
  await expect(page.locator('.tier[data-earned="true"]')).toHaveCount(3);
  await page.selectOption('#farm', 'practice');
  await expect(page.locator('#newField')).toBeEnabled();
  await expect(page.locator('#bestLabel')).toHaveText('Best on this field');
  await expect(page.locator('#targets')).toBeHidden();

  expect(errors).toEqual([]);
});

test('giant crops appear exactly where ripe 2×2 squares are', async ({ page }) => {
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

  // The rules follow the chosen farm's weather.
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
