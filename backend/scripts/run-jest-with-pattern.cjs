#!/usr/bin/env node
/**
 * Runs Jest with the appropriate path-filter flag depending on the installed version.
 * Jest v30 renamed the CLI option from --testPathPattern to --testPathPatterns,
 * while v29 still only supports the singular form. This helper keeps both
 * environments working by inspecting the local Jest version at runtime.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [pattern, ...extraArgs] = process.argv.slice(2);

if (!pattern) {
  console.error('Usage: node scripts/run-jest-with-pattern.cjs <pattern> [jest args]');
  process.exit(1);
}

function resolveJestVersion() {
  try {
    const pkgPath = require.resolve('jest/package.json', { paths: [process.cwd()] });
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkgJson.version ?? '0.0.0';
  } catch (error) {
    console.error('Unable to determine Jest version:', error);
    process.exit(1);
  }
}

const jestVersion = resolveJestVersion();
const majorVersion = parseInt(jestVersion.split('.')[0] ?? '0', 10);
const flagName = majorVersion >= 30 ? '--testPathPatterns' : '--testPathPattern';
const patternFlag = `${flagName}=${pattern}`;

const isWindows = process.platform === 'win32';
const jestBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  isWindows ? 'jest.cmd' : 'jest'
);

const result = spawnSync(jestBin, [patternFlag, ...extraArgs], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('Failed to run Jest:', result.error);
  process.exit(result.status ?? 1);
}

process.exit(result.status ?? 0);
