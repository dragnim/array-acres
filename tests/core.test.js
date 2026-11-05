// Array Acres core regression tests. No dependencies: run with `node tests/core.test.js`.
// Loads the interpreter and game core straight from the page, so the tests always exercise the real code.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const [pagePath = path.join(root, 'index.html'), refPath = path.join(root, 'reference', 'hybrid.apl')] = process.argv.slice(2);
const page = fs.readFileSync(pagePath, 'utf8');

// Find a script by id, so adding or reordering other scripts can't break the tests.
function scriptById(id) {
  const m = page.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  if (!m) { console.error(`Missing <script id="${id}"> in ${pagePath}`); process.exit(2); }
  return m[1];
}
const aplSrc = scriptById('apl-interpreter'), coreSrc = scriptById('acres-core');
const { APL, AcresCore } = new Function(aplSrc + '\n' + coreSrc + '\nreturn { APL, AcresCore };')();
const { RULES } = AcresCore;
const HYBRID = fs.readFileSync(refPath, 'utf8');
const GREEDY = 'Harvest←{⍵≥3}';

let checks = 0, failures = 0;
const check = (label, got, want) => {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.log(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
};

// 1. Interpreter: expressions with known Dyalog results
const ev = s => { try { return APL.format(APL.run(s).last); } catch (e) { return 'ERR ' + e.message; } };
const exprs = [
  ['1+2×3', '7'], ['-2×3', '¯6'], ['⍳5', '1 2 3 4 5'], ['+/⍳10', '55'], ['2 3⍴⍳6', '1 2 3\n4 5 6'],
  ['+/2 3⍴⍳6', '6 15'], ['+⌿2 3⍴⍳6', '5 7 9'], ['+\\⍳4', '1 3 6 10'], ['1 0 1/1 2 3', '1 3'], ['m←2 3⍴⍳6⋄m[2;3]', '6'],
  ['m←2 3⍴⍳6⋄m[;2]', '2 5'], ['⌽⍳4', '4 3 2 1'], ['1⌽⍳4', '2 3 4 1'], ['⍉2 3⍴⍳6', '1 4\n2 5\n3 6'], ['2↑⍳5', '1 2'], ['¯2↑⍳5', '4 5'], ['2↓⍳5', '3 4 5'],
  ['1 1↓3 3⍴⍳9', '5 6\n8 9'], ['¯1⊖3 3⍴⍳9', '7 8 9\n1 2 3\n4 5 6'], ['(⍳3)∘.×⍳3', '1 2 3\n2 4 6\n3 6 9'], ['(2 2⍴1 2 3 4)+.×2 2⍴5 6 7 8', '19 22\n43 50'],
  ['f←{⍵=3}⋄f 1 3 3', '0 1 1'], ['f←{⍺+⍵}⋄2 f 3', '5'], ['f←{⍺←10⋄⍺+⍵}⋄f 3', '13'], ['f←{⍵≤1:⍵⋄(∇⍵-1)+∇⍵-2}⋄f 10', '55'],
  ['(+/÷≢)1 2 3 4', '2.5'], ['3 4 5⍳4', '2'], ['⍵/⍨1', 'ERR VALUE ERROR: undefined name ⍵'], ['x←1 2 3⋄x/⍨1 0 1', '1 3'], ['{⍵×2}¨⍳3', '2 4 6'],
  ['1 2+1 2 3', 'ERR LENGTH ERROR: can\'t pair a vector of length 2 with a vector of length 3'], ['⌺', 'ERR NONCE ERROR: ⌺ isn\'t available yet'],
  ['(2 2⍴⍳4),9', '1 2 9\n3 4 9'], ['(2 2⍴⍳4)⍪9', '1 2\n3 4\n9 9'], ['⍸1 0 1', '1 3'], ['⍋3 1 2', '2 3 1'], ['1∘+ 5', '6'], ['-∘⌽ 1 2', '¯2 ¯1'], ['×/⍳0', '1'],
  ['3|¯1', '2'], ['~1 0', '0 1'], ['1 2 3~2', '1 3'], ['2 3∊1 2', '1 0'], ['0 1⌽2 2⍴⍳4', '1 2\n4 3'], ['⌈/3 9 2', '9'], ['{⍵}', '(function)'], ['5÷0', 'ERR DOMAIN ERROR: divide by zero'],
  ['2 2⍴¯1.5', '¯1.5 ¯1.5\n¯1.5 ¯1.5'], ['1 ¯1 2/4 5 6', '4 0 6 6'], ['≢2 3⍴0', '2'], ['+/,2 2⍴1', '4'],
];
for (const [src, want] of exprs) check(src, ev(src), want);

// 2. Seasons: same rules and seeds as the original simulations
const SEEDS = [...Array(200)].map((_, k) => (k + 1) * 7919);
function season(src, seed, previewSrc, weather) {
  const fn = AcresCore.compileHarvest(src), st = AcresCore.newSeason(seed, weather);
  while (st.day < RULES.days) {
    if (previewSrc) AcresCore.evaluate(previewSrc, st.field);
    AcresCore.advance(st, AcresCore.runHarvest(fn, st.field));
  }
  return st.score;
}
const total = (src, previewSrc) => SEEDS.reduce((s, x) => s + season(src, x, previewSrc), 0);
check('greedy {⍵≥3} total over 200 seasons', total(GREEDY), 243267);
check('hybrid reference total over 200 seasons', total(HYBRID), 307061);

// 3. Preview
const grid = rows => rows.map(r => [...r].map(Number));
const snapshot = st => JSON.stringify({ day: st.day, score: st.score, wasted: st.wasted, field: st.field, marks: st.marks, history: st.history });

const sample = grid(['33000003', '33000000', '00000000', '00000004', '00000000', '22000000', '32000033', '00000033']);
check('preview: valid Harvest returns the expected mask', AcresCore.evaluate(GREEDY, sample),
  { ok: true, mask: grid(['11000001', '11000000', '00000000', '00000001', '00000000', '00000000', '10000011', '00000011']) });

{
  const r = AcresCore.evaluate('Harvest←{⍵=}', sample);
  check('preview: invalid code is reported as a code error', [r.ok, r.kind], [false, 'code']);
}
// evaluate() must be read-only on every path, including Harvest functions that try to be clever.
for (const [label, src] of [
  ['successful evaluation', HYBRID],
  ['invalid APL', 'Harvest←{⍵=}'],
  ['invalid result', 'Harvest←{+/⍵}'],
  ['a Harvest that reassigns its argument', 'Harvest←{x←⍵ ⋄ ⍵≥3}'],
]) {
  const field = AcresCore.newSeason(SEEDS[3]).field, before = JSON.stringify(field);
  AcresCore.evaluate(src, field);
  check(`preview: input field unchanged after ${label}`, JSON.stringify(field), before);
}
{
  const r1 = AcresCore.evaluate('Harvest←{+/⍵}', sample), r2 = AcresCore.evaluate('Harvest←{⍵}', sample);
  check('preview: wrong shape is reported as a result error', [r1.ok, r1.kind, r1.message],
    [false, 'result', 'Harvest returned a vector of length 8, but it must return an 8×8 matrix']);
  check('preview: non-boolean mask is reported as a result error', [r2.ok, r2.kind, r2.message],
    [false, 'result', 'Harvest must return only 0s and 1s']);
}
{
  const st = AcresCore.newSeason(SEEDS[1]);
  for (let d = 0; d < 10; d++) AcresCore.advance(st, AcresCore.runHarvest(AcresCore.compileHarvest(GREEDY), st.field));
  const before = snapshot(st);
  for (const src of [GREEDY, HYBRID, 'Harvest←{⍵=}', 'Harvest←{+/⍵}']) AcresCore.evaluate(src, st.field);
  check('preview: does not change day, score, wasted, field or marks', snapshot(st), before);
}
{
  const a = AcresCore.newSeason(SEEDS[2]), b = AcresCore.newSeason(SEEDS[2]);
  for (let i = 0; i < 5; i++) AcresCore.evaluate(HYBRID, a.field);
  check('preview: does not consume simulation randomness', [a.rng(), a.rng()], [b.rng(), b.rng()]);
}
check('preview: running the hybrid preview every day leaves greedy totals unchanged', total(GREEDY, HYBRID), 243267);

// 4. Fixed fields for the hybrid reference, covering corners, edges, overlapping and potential blocks
const fixed = [
  ['ripe blocks in two corners, a lone corner plot, a waiting corner plot, rot on an edge',
    ['33000003', '33000000', '00000000', '00000004', '00000000', '22000000', '32000033', '00000033'],
    ['11000001', '11000000', '00000000', '00000001', '00000000', '00000000', '00000011', '00000011']],
  ['overlapping blocks, a lone plot beside sprouts, a plot waiting on growing neighbours',
    ['00000000', '03330000', '03330000', '00000000', '31000000', '11000322', '00000220', '00000000'],
    ['00000000', '01110000', '01110000', '00000000', '10000000', '00000000', '00000000', '00000000']],
  ['a block one sprout short, and four corners that only form a block if the field wrapped',
    ['30000003', '00000000', '00033000', '00031000', '00000000', '00000000', '00000000', '30000003'],
    ['10000001', '00000000', '00011000', '00010000', '00000000', '00000000', '00000000', '10000001']],
];
for (const [label, field, want] of fixed) check(`hybrid mask: ${label}`, AcresCore.evaluate(HYBRID, grid(field)), { ok: true, mask: grid(want) });

// 5. Daily statistics: observations of the rules, checked against totals and an independent count of rot.
{
  check('stats: a new season starts with no history', AcresCore.newSeason(SEEDS[0]).history, []);
  const sum = (h, k) => h.reduce((s, d) => s + d[k], 0);
  let ok = true, detail = '';
  for (const [name, src] of [['greedy', GREEDY], ['hybrid', HYBRID]]) {
    const fn = AcresCore.compileHarvest(src);
    for (const seed of SEEDS.slice(0, 20)) {
      const st = AcresCore.newSeason(seed);
      while (st.day < RULES.days) {
        const mask = AcresCore.runHarvest(fn, st.field), before = st.field.map(r => r.slice());
        AcresCore.advance(st, mask);
        // Rot counted from the fields themselves: ripe, not harvested, and rotten afterwards.
        let rotted = 0;
        for (let r = 0; r < RULES.size; r++) for (let c = 0; c < RULES.size; c++)
          if (before[r][c] === RULES.ripe && !mask[r][c] && st.field[r][c] === RULES.rot) rotted++;
        const d = st.history[st.history.length - 1];
        if (d.day !== st.day || d.rotted !== rotted || d.cumulative !== st.score
          || d.points !== d.ripeHarvested + (RULES.bonus - 1) * d.bonusPlots || d.bonusPlots > d.ripeHarvested) {
          ok = false; detail = `${name} seed ${seed} day ${st.day}: ${JSON.stringify(d)}, rot counted ${rotted}`;
        }
      }
      if (st.history.length !== RULES.days || sum(st.history, 'points') !== st.score || sum(st.history, 'wasted') !== st.wasted) {
        ok = false; detail = `${name} seed ${seed}: history doesn't add up to the season totals`;
      }
    }
  }
  check('stats: daily records match the season over 40 seasons' + (detail ? ` (${detail})` : ''), ok, true);
}

// 6. Rulesets, farms and personal bests
{
  const FARMS = AcresCore.FARMS, PRACTICE = AcresCore.PRACTICE;
  check('rules: the ruleset is v2 and cannot be changed', [RULES.id, Object.isFrozen(RULES)], ['v2', true]);
  const ids = FARMS.map(f => f.id);
  check('farms: three farms with unique ids, all on rules v2 and fixed',
    [ids.length, new Set(ids).size, FARMS.every(f => f.rules === RULES.id && Object.isFrozen(f))], [3, 3, true]);
  check('farms: each has its own weather', new Set(FARMS.map(f => `${f.sunshine}/${f.rainfall}`)).size, 3);
  check('farms: Practice Farm has Manor Farm’s weather', [PRACTICE.sunshine, PRACTICE.rainfall], [FARMS[0].sunshine, FARMS[0].rainfall]);
  const onFarm = (src, f) => season(src, f.seed, null, f);
  // Pinned results: if these move, the farms have changed and old personal bests no longer compare.
  const pinned = { 'manor-farm': [1213, 1533], 'bramley-farm': [1465, 2132], 'nuthanger-farm': [1093, 1238] };
  for (const f of FARMS)
    check(`farm ${f.id}: greedy and hybrid scores`, [onFarm(GREEDY, f), onFarm(HYBRID, f)], pinned[f.id]);

  // Targets: a ladder of strategies must land in the intended tiers on every farm.
  const BLOCKS = `Blocks←{
    tl←⍵∧((⍴⍵)↑0 1↓⍵)∧((⍴⍵)↑1 0↓⍵)∧(⍴⍵)↑1 1↓⍵
    tl∨((-⍴⍵)↑0 ¯1↓tl)∨((-⍴⍵)↑¯1 0↓tl)∨(-⍴⍵)↑¯1 ¯1↓tl
  }`;
  const BLOCKS_ONLY = `Harvest←{\n  ${BLOCKS}\n  (⍵=4)∨Blocks ⍵=3\n}`;
  const WRAPPED = `Harvest←{
  Blocks←{
    tl←⍵∧(1⌽⍵)∧(1⊖⍵)∧1⊖1⌽⍵
    tl∨(¯1⌽tl)∨(¯1⊖tl)∨¯1⊖¯1⌽tl
  }
  ripe←⍵=3
  (⍵=4)∨(Blocks ripe)∨ripe∧~Blocks ⍵∊2 3
}`;
  // Waiting only for bumper crops pays off in Bramley Farm's sunshine, but not on the other farms.
  const blocksOnly = { 'manor-farm': null, 'bramley-farm': 'silver', 'nuthanger-farm': null };
  for (const f of FARMS) {
    const t = f.targets, tier = src => AcresCore.tierFor(f, onFarm(src, f));
    check(`targets ${f.id}: fixed and rising`, [Object.isFrozen(t), t.bronze < t.silver && t.silver < t.gold], [true, true]);
    check(`targets ${f.id}: ripe-only, blocks-only, wrap-around and hybrid land in their tiers`,
      [tier('Harvest←{⍵=3}'), tier(BLOCKS_ONLY), tier(WRAPPED), tier(HYBRID)], ['bronze', blocksOnly[f.id], 'silver', 'gold']);
  }
  const mf = FARMS[0];
  check('targets: a score exactly on a target reaches it',
    [AcresCore.tierFor(mf, mf.targets.bronze - 1), AcresCore.tierFor(mf, mf.targets.bronze), AcresCore.tierFor(mf, mf.targets.gold)], [null, 'bronze', 'gold']);

  const e = (farm, score, ruleset = 'v2') => ({ ruleset, farm, seed: 1, score });
  let r = AcresCore.recordBest({}, e('manor-farm', 1200));
  check('bests: a first result is recorded', [r.improved, r.previous, r.bests['v2:manor-farm'].score], [true, null, 1200]);
  const after = AcresCore.recordBest(r.bests, e('manor-farm', 1300));
  check('bests: a higher score replaces the best', [after.improved, after.previous.score, after.bests['v2:manor-farm'].score], [true, 1200, 1300]);
  const lower = AcresCore.recordBest(after.bests, e('manor-farm', 1250)), equal = AcresCore.recordBest(after.bests, e('manor-farm', 1300));
  check('bests: a lower or equal score leaves the best alone', [lower.improved, lower.bests === after.bests, equal.improved, equal.bests === after.bests], [false, true, false, true]);
  const other = AcresCore.recordBest(after.bests, e('bramley-farm', 900)), v3 = AcresCore.recordBest(after.bests, e('manor-farm', 100, 'v3'));
  check('bests: kept separately per farm and per ruleset',
    [other.improved, other.bests['v2:manor-farm'].score, v3.improved, v3.bests['v2:manor-farm'].score], [true, 1300, true, 1300]);
}

// 7. Bumper crops: ripe 2×2 squares for drawing, overlapping squares included
check('bumper crops: overlapping squares are all found',
  AcresCore.ripeSquares(grid(['00000000', '03330000', '03330000', '00000000', '31000000', '11000322', '00000220', '00000000'])), [[1, 1], [1, 2]]);
check('bumper crops: squares in corners are found, and corners never join across edges',
  AcresCore.ripeSquares(grid(['33000003', '33000000', '00000000', '00000000', '00000000', '00000000', '30000033', '00000033'])), [[0, 0], [6, 6]]);
check('bumper crops: a square with a rotten or growing plant is not a bumper crop',
  AcresCore.ripeSquares(grid(['34000000', '33000000', '00000000', '00032000', '00033000', '00000000', '00000000', '00000000'])), []);

// 8. The rules as written on the page: every claim checked against the simulation
{
  const N = RULES.size, ripe = RULES.ripe, rot = RULES.rot;
  let starts = true, steps = true, waste = true, rates = true;
  for (const f of AcresCore.FARMS) {
  let grew = 0, couldGrow = 0, rotted = 0, couldRot = 0;
  for (const src of [GREEDY, HYBRID, 'Harvest←{0}']) {
    const fn = AcresCore.compileHarvest(src);
    for (const seed of SEEDS.slice(0, 15)) {
      const st = AcresCore.newSeason(seed, f);
      if (!st.field.flat().every(v => v >= 0 && v <= 3)) starts = false;
      while (st.day < RULES.days) {
        const mask = AcresCore.runHarvest(fn, st.field), before = st.field.map(r => r.slice());
        AcresCore.advance(st, mask);
        let wasted = 0;
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const b = before[r][c], a = st.field[r][c];
          if (mask[r][c]) {
            if (b === 1 || b === 2) wasted++;
            if (a !== 0 && a !== 1) steps = false;    // replanted as a seed, which may grow that night
            couldGrow++; if (a === 1) grew++;
          } else if (b < ripe) {
            if (a !== b && a !== b + 1) steps = false;
            couldGrow++; if (a === b + 1) grew++;
          } else if (b === ripe) {
            if (a !== ripe && a !== rot) steps = false;
            couldRot++; if (a === rot) rotted++;
          } else if (a !== rot) steps = false;       // rotten stays until harvested
        }
        if (st.history[st.history.length - 1].wasted !== wasted) waste = false;
      }
    }
  }
  // Each farm's stated sunshine and rainfall should be what actually happens, to within sampling error.
  if (Math.abs(grew / couldGrow - f.sunshine) > 0.01 || Math.abs(rotted / couldRot - f.rainfall) > 0.015) rates = false;
  }
  check('rules: a season starts with every plot at stage 0 to 3', starts, true);
  check('rules: no plot changes by more than one stage a night, and rot only comes from unharvested ripe plants', steps, true);
  check('rules: only harvested sprouts and growing plants count as wasted', waste, true);
  check('rules: each farm’s growth and rot match its sunshine and rainfall', rates, true);
}

// 9. Progression: medals unlock symbols, helpers and farms
{
  const F = Object.fromEntries(AcresCore.FARMS.map(f => [f.id, f]));
  const play = (src, f, access) => {
    const fn = AcresCore.compileHarvest(src, access), st = AcresCore.newSeason(f.seed, f);
    while (st.day < RULES.days) AcresCore.advance(st, AcresCore.runHarvest(fn, st.field));
    return st.score;
  };
  const msg = (src, access) => {
    try { AcresCore.runHarvest(AcresCore.compileHarvest(src, access), AcresCore.newSeason(1).field); return 'ok'; }
    catch (e) { return e.message; }
  };
  const p0 = AcresCore.progress({});
  check('progress: a new player has Manor Farm and the comparisons only',
    [p0.earned, [...p0.glyphs].join(''), [...p0.helpers], [...p0.farms], p0.source], [['start'], '=≠<>≤≥', [], ['manor-farm'], false]);
  check('locks: a locked symbol says what unlocks it', msg('Harvest←{(⍵=3)∨⍵=4}', p0), 'LOCKED: ∨ unlocks with Bronze on Manor Farm');
  check('locks: a locked helper says what unlocks it', msg('Harvest←{BumperCrops ⍵}', p0), 'LOCKED: BumperCrops unlocks with Bronze on Manor Farm');
  check('locks: symbols in comments don’t count', msg('⍝ try ∨ later\nHarvest←{⍵=3}', p0), 'ok');
  check('locks: players can still define their own names', msg('BumperCrops←{⍵=3}\nHarvest←{BumperCrops ⍵}', p0), 'ok');

  // The intended journey, step by step.
  const s1 = play('Harvest←{⍵=3}', F['manor-farm'], p0);
  check('journey: harvesting ripe plants on Manor Farm reaches Bronze', [s1, AcresCore.tierFor(F['manor-farm'], s1)], [1213, 'bronze']);
  const p1 = AcresCore.progress({ 'v2:manor-farm': { score: s1 } });
  check('journey: Bronze on Manor Farm unlocks ∧ ∨ ~, BumperCrops and Bramley Farm',
    [p1.earned, [...p1.glyphs].includes('∨'), [...p1.helpers], [...p1.farms]], [['start', 'manor-bronze'], true, ['BumperCrops'], ['manor-farm', 'bramley-farm']]);
  const s2 = play('Harvest←{(⍵=4)∨BumperCrops ⍵}', F['bramley-farm'], p1);
  check('journey: harvesting only bumper crops on Bramley Farm reaches Silver', [s2, AcresCore.tierFor(F['bramley-farm'], s2)], [1995, 'silver']);
  const p2 = AcresCore.progress({ 'v2:manor-farm': { score: s1 }, 'v2:bramley-farm': { score: s2 } });
  check('journey: Silver on Bramley Farm unlocks Promising and Nuthanger Farm',
    [p2.earned.includes('bramley-silver'), [...p2.helpers], p2.farms.has('nuthanger-farm')], [true, ['BumperCrops', 'Promising'], true]);
  const smart = 'Harvest←{(⍵=4)∨(BumperCrops ⍵)∨(⍵=3)∧~Promising ⍵}';
  check('journey: the helpers reproduce the reference strategy and reach Gold on every farm',
    AcresCore.FARMS.map(f => { const sc = play(smart, f, p2); return [sc, AcresCore.tierFor(f, sc)]; }), [[1533, 'gold'], [2132, 'gold'], [1238, 'gold']]);
  const p3 = AcresCore.progress({ 'v2:nuthanger-farm': { score: 1200 } });
  check('journey: Gold on any farm unlocks every symbol and the helpers’ source',
    [p3.earned.includes('any-gold'), p3.glyphs.has('↑'), p3.helpers.has('Squares'), p3.source], [true, true, true, true]);

  check('helpers: BumperCrops marks exactly the plants in ripe 2×2 squares',
    AcresCore.evaluate('Harvest←BumperCrops', grid(['33000003', '33000000', '00000000', '00000000', '00000000', '00000000', '30000033', '00000033'])).mask,
    grid(['11000000', '11000000', '00000000', '00000000', '00000000', '00000000', '00000011', '00000011']));
  check('helpers: Promising marks every 2×2 square of growing or ripe plants',
    AcresCore.evaluate('Harvest←Promising', grid(['23000000', '32000000', '00000000', '00012000', '00031000', '00000000', '00000000', '00000000'])).mask,
    grid(['11000000', '11000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000']));
}

// 10. Allocation limit: 1,000,000 elements is allowed, anything bigger is WS FULL, checked before allocating.
const WS = 'ERR WS FULL: array exceeds 1,000,000 elements';
const limits = [
  ['≢⍳1000000', '1000000'], ['⍳1000001', WS], ['⍳1e300', WS],
  ['≢,1000 1000⍴0', '1000000'], ['1000 1001⍴0', WS], ['1e20 1e20⍴0', WS],
  ['≢,1e20 0⍴0', '0'], ['≢,0 1e300⍴7', '0'],
  ['≢1000000/1', '1000000'], ['1000001/1', WS], ['≢2/⍳500000', '1000000'], ['2/⍳500001', WS],
  ['≢(⍳500000),⍳500000', '1000000'], ['(⍳500000),⍳500001', WS],
  ['≢1000000↑0', '1000000'], ['1000001↑0', WS],
  ['≢⍸,1000000', '1000000'], ['⍸,1000001', WS],
  ['≢,(⍳1000)∘.+⍳1000', '1000000'], ['(⍳1000)∘.+⍳1001', WS],
  ['m←1000 1000⍴0 ⋄ v←⍳1000 ⋄ ≢,m[v;v]', '1000000'], ['m←1000 1000⍴0 ⋄ v←⍳1000 ⋄ m[v;v,1]', WS],
  ['(1000 1⍴1)+.×1 1001⍴1', WS],
  // Oversized intermediates fail even when the final result is small.
  ['+/,1000 1001⍴1', WS], ['≢{⍵,⍵}⍳600000', WS], ['f←{+/,⍵∘.×⍵} ⋄ f ⍳1001', WS],
];
for (const [src, want] of limits) check(`limit: ${src}`, ev(src), want);

// 11. Work limit: primitives whose cost grows faster than their result stop quickly with
// INTERRUPT, instead of freezing the page, while ordinary sizes still work.
{
  const INT = 'ERR INTERRUPT: your function ran for too long';
  for (const src of ['+\\⍳1000000', '(1000 1000⍴1)+.×1000 1000⍴1', '(⍳1000000)∊⍳1000000', '(⍳1000000)⍳⍳1000000',
                     'f←{⍺=0:⍵ ⋄ (⍺-1) ∇ ⍵+1} ⋄ ≢100000 f ⍳1000000']) {
    const t = Date.now(), got = ev(src);
    check(`work: ${src} is interrupted`, got, INT);
    check(`work: ${src} stops within 3 seconds`, Date.now() - t < 3000, true);
  }
  check('work: a scan of 3000 items still runs', ev('⊃⌽+\\⍳3000'), '4501500');
  check('work: a 100×100 matrix product still runs', ev('⊃,(100 100⍴1)+.×100 100⍴1'), '100');
  check('work: the limit resets for each run', ev('≢,(⍳1000)∘.+⍳1000'), '1000000');
}

console.log(failures ? `${failures} of ${checks} checks failed` : `All ${checks} checks passed`);
process.exit(failures ? 1 : 0);
