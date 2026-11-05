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
function season(src, seed, previewSrc) {
  const fn = AcresCore.compileHarvest(src), st = AcresCore.newSeason(seed);
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
const snapshot = st => JSON.stringify({ day: st.day, score: st.score, wasted: st.wasted, field: st.field, marks: st.marks });

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

console.log(failures ? `${failures} of ${checks} checks failed` : `All ${checks} checks passed`);
process.exit(failures ? 1 : 0);
