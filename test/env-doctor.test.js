const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compare, parseVariableNames, parseEnvFile, compareEnvironments } = require('../bin/env-doctor.js');

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

test('compareEnvironments reports differing and missing variables', () => {
  const dir = fixture({
    '.env.local': 'API_URL=http://localhost:3000\nAPP_ENV=local\nDATABASE_URL=postgres://localhost/db\n',
    '.env.staging': 'API_URL=http://staging.example.com\nAPP_ENV=staging\nDATABASE_URL=postgres://staging-db/db\nEXTRA=1\n',
  });
  const res = compareEnvironments(path.join(dir, '.env.local'), path.join(dir, '.env.staging'), 'local', 'staging');
  assert.equal(res.source.environment, 'local');
  assert.equal(res.target.environment, 'staging');
  assert.equal(res.summary.shared, 3);
  assert.equal(res.summary.differing, 3);
  assert.deepEqual(res.summary.sourceOnly, 0);
  assert.equal(res.summary.targetOnly, 1);
  // no values leaked
  const json = JSON.stringify(res);
  assert.ok(!json.includes('localhost:3000'));
  assert.ok(!json.includes('staging.example.com'));
});

test('compareEnvironments detects duplicates and invalid declarations', () => {
  const dir = fixture({
    'a.env': 'KEY=1\nKEY=2\nBAD LINE\n',
    'b.env': 'KEY=1\n',
  });
  const res = compareEnvironments(path.join(dir, 'a.env'), path.join(dir, 'b.env'), 'src', 'tgt');
  assert.equal(res.confirmedIssues.length, 2); // duplicate + invalid
  assert.ok(res.confirmedIssues.some((f) => f.rule === 'DUPLICATE_DECLARATION'));
  assert.ok(res.confirmedIssues.some((f) => f.rule === 'INVALID_DECLARATION'));
});
