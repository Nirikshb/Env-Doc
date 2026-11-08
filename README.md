# Env Doctor

A zero-dependency CLI that checks whether the variable names in `.env` match `.env.example`.

## Requirements

- Node.js 18 or newer

## Install locally

```bash
npm install
npm link
```

Or run it without installing globally:

```bash
node bin/env-doctor.js
```

## Usage

```bash
env-doctor
```

Example output when everything matches:

```text
Env Doctor: .env vs .env.example

✓ Environment is in sync (3 variables checked)
```

When files differ, the command lists both directions:

```text
✗ Environment is out of sync

Missing from .env:
  - DATABASE_URL

Extra in .env:
  - DEBUG
```

Options:

- `--env-file <path>`: inspect a different environment file.
- `--example-file <path>`: use a different example file.
- `--json`: emit structured JSON for CI or other tooling.
- `--help`, `-h`: show help.
- `--version`, `-v`: show the installed version.

The command compares variable names only; it never prints secret values. It understands comments, blank lines, `export KEY=value`, quoted values, and standard shell-style variable names.

## Exit codes

- `0`: files are in sync.
- `1`: one or more variables are missing or extra.
- `2`: invalid arguments or a file could not be read.

This makes it suitable for CI:

```yaml
- name: Check environment template
  run: npx env-doctor --env-file .env.ci --example-file .env.example
```

## Development

```bash
npm test


```

# Env-Doc
A lightweight CLI to compare environment variable names between .env and .env.example files.