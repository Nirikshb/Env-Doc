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
  env-doctor compare --source <path> --target <path> [--source-env <name>] [--target-env <name>] [--json]

Options:
  --env-file <path>      Environment file to inspect (default: .env)
  --example-file <path>  Example file to compare against (default: .env.example)
  --source <path>        Source environment file (compare command)
  --target <path>        Target environment file (compare command)
  --source-env <name>    Source environment label (compare command)
  --target-env <name>    Target environment label (compare command)
  --json                 Print machine-readable JSON output
  --help, -h             Show this help message
  --version, -v          Show the version

Exit codes:
  0  Files match / no confirmed issues
  1  Missing or extra variables found (legacy) / confirmed issues (compare)
  2  Invalid arguments or files could not be read
`;
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    exampleFile: DEFAULT_EXAMPLE_FILE,
    source: null,
    target: null,
    sourceEnv: null,
    targetEnv: null,
    json: false,
    help: false,
    version: false,
    command: null,
  };

  // detect subcommand
  let args = argv.slice();
  if (args[0] === 'compare') {
    options.command = 'compare';
    args = args.slice(1);
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--env-file') {
      if (!args[i + 1]) throw new Error('--env-file requires a path');
      options.envFile = args[++i];
    } else if (arg === '--example-file') {
      if (!args[i + 1]) throw new Error('--example-file requires a path');
      options.exampleFile = args[++i];
    } else if (arg === '--source') {
      if (!args[i + 1]) throw new Error('--source requires a path');
      options.source = args[++i];
    } else if (arg === '--target') {
      if (!args[i + 1]) throw new Error('--target requires a path');
      options.target = args[++i];
    } else if (arg === '--source-env') {
      if (!args[i + 1]) throw new Error('--source-env requires a name');
      options.sourceEnv = args[++i];
    } else if (arg === '--target-env') {
      if (!args[i + 1]) throw new Error('--target-env requires a name');
      options.targetEnv = args[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function isNameChar(ch) { return /[A-Za-z0-9_]/.test(ch); }
function startsWithName(str, pos) {
  const ch = str[pos];
  return typeof ch === 'string' && /[A-Za-z_]/.test(ch);
}

function parseEnvFile(contents) {
  const text = String(contents == null ? '' : contents);
  const len = text.length;
  const declarations = [];
  const duplicates = new Set();
  let pos = 0;
  let lineNum = 1;

  function skipWs() { while (pos < len && (text[pos] === ' ' || text[pos] === '\t')) pos++; }

  while (pos < len) {
    if (text[pos] === '\n') { pos++; lineNum++; continue; }
    if (text[pos] === '\r') { pos++; continue; }

    const lineStartNum = lineNum;
    skipWs();

    if (pos >= len || text[pos] === '\n' || text[pos] === '\r') continue;

    if (text[pos] === '#') {
      while (pos < len && text[pos] !== '\n') pos++;
      continue;
    }

    let isExport = false;
    if (text.slice(pos, pos + 6) === 'export') {
      const next = text[pos + 6];
      if (next === ' ' || next === '\t' || next === '=') {
        isExport = true;
        pos += 6;
        skipWs();
      }
    }

    if (!startsWithName(text, pos)) {
      while (pos < len && text[pos] !== '\n') pos++;
      declarations.push({ name: null, value: '', line: lineStartNum, quoted: false, quote: null, empty: true, export: isExport, invalid: true, duplicate: false });
      continue;
    }

    let nameEnd = pos;
    while (nameEnd < len && isNameChar(text[nameEnd])) nameEnd++;
    const name = text.slice(pos, nameEnd);
    pos = nameEnd;
    skipWs();

    if (pos >= len || text[pos] !== '=') {
      while (pos < len && text[pos] !== '\n') pos++;
      declarations.push({ name, value: '', line: lineStartNum, quoted: false, quote: null, empty: true, export: isExport, invalid: true, duplicate: false });
      continue;
    }
    pos++;
    skipWs();

    let quoted = false;
    let quote = null;
    let value = '';
    let empty = false;
    let invalid = false;

    if (pos < len && (text[pos] === '"' || text[pos] === "'")) {
      quoted = true;
      quote = text[pos] === '"' ? 'double' : 'single';
      const q = text[pos];
      pos++;
      if (q === "'") {
        let buf = '';
        let closed = false;
        while (pos < len) {
          if (text[pos] === "'") { closed = true; pos++; break; }
          if (text[pos] === '\n') lineNum++;
          buf += text[pos];
          pos++;
        }
        if (!closed) invalid = true;
        value = buf;
      } else {
        let buf = '';
        let closed = false;
        while (pos < len) {
          const c = text[pos];
          if (c === '"') { closed = true; pos++; break; }
          if (c === '\\') {
            const nx = pos + 1 < len ? text[pos + 1] : '';
            switch (nx) {
              case '\\': buf += '\\'; pos += 2; break;
              case '"': buf += '"'; pos += 2; break;
              case 'n': buf += '\n'; pos += 2; break;
              case 'r': buf += '\r'; pos += 2; break;
              case 't': buf += '\t'; pos += 2; break;
              case 'b': buf += '\b'; pos += 2; break;
              case 'f': buf += '\f'; pos += 2; break;
              case 'v': buf += '\v'; pos += 2; break;
              default:
                buf += '\\';
                if (nx) { buf += nx; pos += 2; } else { pos++; }
                break;
            }
            continue;
          }
          if (c === '\n') lineNum++;
          buf += c;
          pos++;
        }
        if (!closed) invalid = true;
        value = buf;
      }
      skipWs();
      if (pos < len && text[pos] === '#') {
        while (pos < len && text[pos] !== '\n') pos++;
      }
      if (pos < len && text[pos] !== '\n' && text[pos] !== '\r') {
        while (pos < len && text[pos] !== '\n') pos++;
        invalid = true;
      }
      empty = (value === '');
    } else {
      let buf = '';
      while (pos < len && text[pos] !== '\n' && text[pos] !== '\r') {
        if (text[pos] === ' ' || text[pos] === '\t') {
          let k = pos;
          while (k < len && (text[k] === ' ' || text[k] === '\t')) k++;
          if (k < len && text[k] === '#') break;
          buf += text[pos];
          pos++;
        } else {
          buf += text[pos];
          pos++;
        }
      }
      value = buf.trim();
      empty = (value === '');
    }

    const isDup = declarations.some((d) => d.name === name);
    if (isDup) duplicates.add(`${name} (line ${lineStartNum})`);

    declarations.push({
      name,
      value,
      line: lineStartNum,
      quoted,
      quote,
      empty,
      export: isExport,
      invalid,
      duplicate: isDup
    });
  }

  const names = new Set();
  for (const d of declarations) if (d.name && !d.invalid) names.add(d.name);

  return { declarations, names, duplicates: [...duplicates].sort() };
}

function parseVariableNames(contents) {
  const parsed = parseEnvFile(contents);
  return { names: parsed.names, duplicates: parsed.duplicates };
}

function readEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'file not found' : error.message;
    throw new Error(`${filePath}: ${reason}`);
  }
  return { contents, parsed: parseEnvFile(contents) };
}

function inferEnvLabel(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const m = base.match(/\.env(?:\.(.+))?$/);
  if (!m) return 'unknown';
  const suffix = (m[1] || '').replace(/^\.+/, '');
  if (!suffix) return 'default';
  // common labels
  const labels = ['local', 'development', 'dev', 'staging', 'stage', 'production', 'prod', 'test', 'ci'];
  for (const l of labels) {
    if (suffix.includes(l)) return l;
  }
  return suffix || 'unknown';
}

function compare(envFile, exampleFile) {
  const env = parseVariableNames(fs.readFileSync(envFile, 'utf8'));
  const example = parseVariableNames(fs.readFileSync(exampleFile, 'utf8'));
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
    duplicates: { env: env.duplicates, example: example.duplicates },
  };
}

function compareEnvironments(sourceFile, targetFile, sourceEnvOpt, targetEnvOpt) {
  const src = readEnvFile(sourceFile);
  const tgt = readEnvFile(targetFile);
  const sourceEnv = sourceEnvOpt || inferEnvLabel(sourceFile);
  const targetEnv = targetEnvOpt || inferEnvLabel(targetFile);

  const srcMap = new Map();
  for (const d of src.parsed.declarations) if (d.name && !d.invalid) if (!srcMap.has(d.name)) srcMap.set(d.name, d);
  const tgtMap = new Map();
  for (const d of tgt.parsed.declarations) if (d.name && !d.invalid) if (!tgtMap.has(d.name)) tgtMap.set(d.name, d);

  const shared = [];
  const differing = [];
  for (const name of srcMap.keys()) {
    if (tgtMap.has(name)) {
      shared.push(name);
      if (srcMap.get(name).value !== tgtMap.get(name).value) differing.push(name);
    }
  }
  const sourceOnly = [...srcMap.keys()].filter((n) => !tgtMap.has(n)).sort();
  const targetOnly = [...tgtMap.keys()].filter((n) => !srcMap.has(n)).sort();

  const srcInvalid = src.parsed.declarations.filter((d) => d.invalid).map((d) => ({ line: d.line, name: d.name }));
  const tgtInvalid = tgt.parsed.declarations.filter((d) => d.invalid).map((d) => ({ line: d.line, name: d.name }));

  const confirmedIssues = [];
  for (const d of src.parsed.declarations) if (d.duplicate) confirmedIssues.push({ category: 'confirmed', rule: 'DUPLICATE_DECLARATION', file: 'source', variable: d.name, line: d.line, message: 'Duplicate declaration in source file.' });
  for (const d of tgt.parsed.declarations) if (d.duplicate) confirmedIssues.push({ category: 'confirmed', rule: 'DUPLICATE_DECLARATION', file: 'target', variable: d.name, line: d.line, message: 'Duplicate declaration in target file.' });
  for (const inv of srcInvalid) confirmedIssues.push({ category: 'confirmed', rule: 'INVALID_DECLARATION', file: 'source', variable: inv.name, line: inv.line, message: 'Malformed declaration in source file.' });
  for (const inv of tgtInvalid) confirmedIssues.push({ category: 'confirmed', rule: 'INVALID_DECLARATION', file: 'target', variable: inv.name, line: inv.line, message: 'Malformed declaration in target file.' });

  const environmentDifferences = [];
  for (const name of sourceOnly) environmentDifferences.push({ category: 'difference', rule: 'SOURCE_ONLY_VARIABLE', variable: name, message: 'Variable exists in source but not target.' });
  for (const name of targetOnly) environmentDifferences.push({ category: 'difference', rule: 'TARGET_ONLY_VARIABLE', variable: name, message: 'Variable exists in target but not source.' });
  for (const name of differing) environmentDifferences.push({ category: 'difference', rule: 'VALUE_DIFFERS', variable: name, message: 'Variable value differs between environments.' });

  return {
    ok: confirmedIssues.length === 0,
    source: { file: sourceFile, environment: sourceEnv },
    target: { file: targetFile, environment: targetEnv },
    summary: {
      shared: shared.length,
      differing: differing.length,
      sourceOnly: sourceOnly.length,
      targetOnly: targetOnly.length,
      duplicates: src.parsed.duplicates.length + tgt.parsed.duplicates.length,
      invalid: srcInvalid.length + tgtInvalid.length,
    },
    findings: [...confirmedIssues, ...environmentDifferences],
    confirmedIssues,
    environmentDifferences,
    potentialIssues: [],
    missing: [],
    extra: [],
  };
}

function printList(label, values) {
  if (values.length === 0) return;
  process.stdout.write(`${label}:\n`);
  for (const value of values) process.stdout.write(`  - ${value}\n`);
}

function printHuman(result) {
  if (result.source && result.target && result.findings) {
    process.stdout.write(`Env Doctor: ${result.source.file} (${result.source.environment}) vs ${result.target.file} (${result.target.environment})\n\n`);
    process.stdout.write(`Shared variables: ${result.summary.shared}\n`);
    process.stdout.write(`Differing values: ${result.summary.differing}\n`);
    process.stdout.write(`Source-only: ${result.summary.sourceOnly}\n`);
    process.stdout.write(`Target-only: ${result.summary.targetOnly}\n\n`);
    if (result.confirmedIssues.length) {
      process.stdout.write('Confirmed issues:\n');
      for (const f of result.confirmedIssues) process.stdout.write(`  - [${f.rule}] ${f.variable || '(unknown)'} (${f.file}, line ${f.line}) ${f.message}\n`);
      process.stdout.write('\n');
    }
    if (result.environmentDifferences.length) {
      process.stdout.write('Environment differences:\n');
      for (const f of result.environmentDifferences) process.stdout.write(`  - [${f.rule}] ${f.variable} ${f.message}\n`);
      process.stdout.write('\n');
    }
    if (result.potentialIssues.length) {
      process.stdout.write('Potential issues:\n');
      for (const f of result.potentialIssues) process.stdout.write(`  - ${f.message}\n`);
      process.stdout.write('\n');
    }
    return;
  }
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

  if (options.command === 'compare') {
    if (!options.source || !options.target) {
      process.stderr.write(`Error: compare requires --source and --target\n\n${usage()}`);
      return 2;
    }
    let result;
    try {
      result = compareEnvironments(options.source, options.target, options.sourceEnv, options.targetEnv);
    } catch (error) {
      if (options.json) process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
      else process.stderr.write(`Error: ${error.message}\n`);
      return 2;
    }
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printHuman(result);
    return result.confirmedIssues.length ? 1 : 0;
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
module.exports = { compare, main, parseArgs, parseVariableNames, parseEnvFile, compareEnvironments, inferEnvLabel };
