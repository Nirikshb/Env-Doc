#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ENV_FILE = '.env';
const DEFAULT_EXAMPLE_FILE = '.env.example';

function usage() {
  return `Env Doctor - compare environment variable names in .env and .env.example

Usage:
  env-doctor [options]

Options:
  --env-file <path>      Environment file to inspect (default: .env)
  --example-file <path>  Example file to compare against (default: .env.example)
  --json                 Print machine-readable JSON output
  --help, -h             Show this help message
  --version, -v          Show the version

Exit codes:
  0  Files match
  1  Missing or extra variables found
  2  Invalid arguments or files could not be read
`;
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    exampleFile: DEFAULT_EXAMPLE_FILE,
    json: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--env-file') {
      if (!argv[i + 1]) throw new Error('--env-file requires a path');
      options.envFile = argv[++i];
    } else if (arg === '--example-file') {
      if (!argv[i + 1]) throw new Error('--example-file requires a path');
      options.exampleFile = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseVariableNames(contents) {
  const names = new Set();
  const duplicates = new Set();

  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!assignment) continue;

    const name = assignment[1];
    if (names.has(name)) duplicates.add(`${name} (line ${index + 1})`);
    names.add(name);
  }

  return { names, duplicates: [...duplicates].sort() };
}

function readVariables(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'file not found' : error.message;
    throw new Error(`${filePath}: ${reason}`);
  }
  return parseVariableNames(contents);
}

function compare(envFile, exampleFile) {
  const env = readVariables(envFile);
  const example = readVariables(exampleFile);
  const missing = [...example.names].filter((name) => !env.names.has(name)).sort();
  const extra = [...env.names].filter((name) => !example.names.has(name)).sort();

  return {
    ok: missing.length === 0 && extra.length === 0,
    envFile,
    exampleFile,
    expected: [...example.names].sort(),
    actual: [...env.names].sort(),
    missing,
    extra,
    duplicates: {
      env: env.duplicates,
      example: example.duplicates,
    },
  };
}

function printList(label, values) {
  if (values.length === 0) return;
  process.stdout.write(`${label}:\n`);
  for (const value of values) process.stdout.write(`  - ${value}\n`);
}

function printHuman(result) {
  process.stdout.write(`Env Doctor: ${result.envFile} vs ${result.exampleFile}\n\n`);
  if (result.ok) {
    process.stdout.write(`✓ Environment is in sync (${result.actual.length} variables checked)\n`);
  } else {
    process.stdout.write('✗ Environment is out of sync\n\n');
    printList('Missing from .env', result.missing);
    printList('Extra in .env', result.extra);
  }

  if (result.duplicates.env.length || result.duplicates.example.length) {
    process.stdout.write('\nDuplicate assignments detected:\n');
    printList('  .env', result.duplicates.env);
    printList('  .env.example', result.duplicates.example);
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n${usage()}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (options.version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  let result;
  try {
    result = compare(options.envFile, options.exampleFile);
  } catch (error) {
    if (options.json) process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
    else process.stderr.write(`Error: ${error.message}\n`);
    return 2;
  }

  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printHuman(result);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { compare, main, parseArgs, parseVariableNames };
