const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compare, parseVariableNames } = require('../bin/env-doctor.js');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-doctor-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('parses assignments, export syntax, comments, and invalid lines', () => {
  const result = parseVariableNames(`\n# comment\nAPI_KEY=secret\nexport PORT = 3000\nnot an assignment\n_APP_MODE="dev"\n`);
  assert.deepEqual([...result.names].sort(), ['API_KEY', 'PORT', '_APP_MODE']);
  assert.deepEqual(result.duplicates, []);
});

test('reports matching files as healthy', () => {
  const dir = fixture({ '.env': 'API_KEY=secret\nPORT=3000\n', '.env.example': 'API_KEY=\nPORT=\n' });
  const result = compare(path.join(dir, '.env'), path.join(dir, '.env.example'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, []);
});

test('reports missing and extra variables', () => {
  const dir = fixture({ '.env': 'API_KEY=secret\nDEBUG=true\n', '.env.example': 'API_KEY=\nPORT=\n' });
  const result = compare(path.join(dir, '.env'), path.join(dir, '.env.example'));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['PORT']);
  assert.deepEqual(result.extra, ['DEBUG']);
});

test('records duplicate assignments without failing parsing', () => {
  const dir = fixture({ '.env': 'API_KEY=one\nAPI_KEY=two\n', '.env.example': 'API_KEY=\n' });
  const result = compare(path.join(dir, '.env'), path.join(dir, '.env.example'));
  assert.deepEqual(result.duplicates.env, ['API_KEY (line 2)']);
});
