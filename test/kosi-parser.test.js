// Plain-node regression test for the Kegel KOSI (.txt) importer in public/index.html.
// No test framework/build step, matching the rest of this repo. Run with `npm test`.
//
// Extracts parseKosiText (and its CONDITIONERS dependency) straight out of the shipped
// HTML by source markers, so this always tests the real code rather than a copy that
// could drift out of sync.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function loadParseKosiText() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const condStart = html.indexOf('const CONDITIONERS');
  const condEnd = html.indexOf('const BAND_HUES');
  const fnStart = html.indexOf('function parseKosiText');
  const fnEnd = html.indexOf('function bandColors');
  if (condStart === -1 || condEnd === -1 || fnStart === -1 || fnEnd === -1) {
    throw new Error('Could not locate parseKosiText/CONDITIONERS in public/index.html — source markers moved.');
  }
  const src = html.slice(condStart, condEnd) + '\n' + html.slice(fnStart, fnEnd) + '\nmodule.exports = { parseKosiText };';
  const modPath = path.join(__dirname, '.parseKosiText.generated.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  fs.unlinkSync(modPath);
  return mod.parseKosiText;
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function run() {
  const parseKosiText = loadParseKosiText();
  let passed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`ok - ${name}`);
    } catch (err) {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // Real exports (uploaded by the project owner) — locks in known-good parsing so
  // future changes to block classification can't silently break these.
  test('Route 66 V2: distance, name, tank default read from real export', () => {
    const r = parseKosiText(readFixture('route-66-v2.txt'));
    assert.strictEqual(r.name, 'Route 66 V2');
    assert.strictEqual(r.distanceFt, 45);
    assert.strictEqual(r.tank, 'single');
    assert.strictEqual(r.tankDetected, false);
    assert.strictEqual(r.cond1, null);
    assert.ok(r.warnings.some(w => /tank letter/i.test(w)));
  });

  test('Broadway V2: distance, name, tank default read from real export', () => {
    const r = parseKosiText(readFixture('broadway-v2.txt'));
    assert.strictEqual(r.name, 'Broadway V2');
    assert.strictEqual(r.distanceFt, 37);
    assert.strictEqual(r.tank, 'single');
    assert.strictEqual(r.tankDetected, false);
    assert.strictEqual(r.cond1, null);
  });

  test('header/footer telemetry blocks never leak into ratio/wall-board estimate', () => {
    // Both fixtures' header block contains 720 and footer block contains 4552/716 —
    // if those were ever misclassified as board numbers, wallBoardEstimate would
    // blow way past a real lane's ~39-board width.
    const r1 = parseKosiText(readFixture('route-66-v2.txt'));
    const r2 = parseKosiText(readFixture('broadway-v2.txt'));
    assert.ok(r1.wallBoardEstimate <= 39, `wallBoardEstimate ${r1.wallBoardEstimate} out of lane range`);
    assert.ok(r2.wallBoardEstimate <= 39, `wallBoardEstimate ${r2.wallBoardEstimate} out of lane range`);
  });

  test('too-short input is rejected', () => {
    assert.throws(() => parseKosiText('short\ntext'), /too short/i);
  });

  test('input without a precise distance table is rejected', () => {
    const lines = Array.from({ length: 25 }, (_, i) => (i === 1 ? 'Some Pattern' : '1'));
    assert.throws(() => parseKosiText(lines.join('\n')), /distance table/i);
  });

  test('single-letter tank tokens are detected when present', () => {
    // Synthetic file exercising the tank-letter path directly, since neither real
    // sample on hand encodes tank this way. Mirrors the real shape: name line,
    // then blank-line-separated blocks (header block first, skipped).
    const lines = [
      '-1',
      'Synthetic Dual Tank Pattern',
      '',
      '1', '1', '0', '720', '1', // header block (skipped)
      '',
      'A', 'B', // tank letters
      '',
      '1.5', '3.0', '39', // precise distance table
      '',
      '0', '0', '0', '0', '0', // footer block (skipped)
    ];
    const r = parseKosiText(lines.join('\n'));
    assert.strictEqual(r.tankDetected, true);
    assert.strictEqual(r.tank, 'dual');
    assert.ok(!r.warnings.some(w => /tank letter/i.test(w)));
  });

  console.log(`\n${passed} passed`);
}

run();
