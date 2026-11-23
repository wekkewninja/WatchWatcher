import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = [
  'services/watchwatcher-web/src',
  'services/watchwatcher-api/src',
  'services/shared',
];
const reportPaths = [
  'services/watchwatcher-web/coverage/watchwatcher-web/coverage-summary.json',
  'services/watchwatcher-api/coverage/coverage-summary.json',
];
const criticalSourcePaths = [
  'services/watchwatcher-web/src/api/client.ts',
  'services/watchwatcher-web/src/app/core/auth-state.service.ts',
  'services/watchwatcher-web/src/app/core/auth.guard.ts',
  'services/watchwatcher-web/src/app/core/storage-repository.service.ts',
  'services/watchwatcher-web/src/app/core/student-memory.service.ts',
  'services/shared/evaluation/offline-evaluator.ts',
  'services/shared/schemas/validation.ts',
  'services/watchwatcher-api/src/services/authService.ts',
  'services/watchwatcher-api/src/services/evaluationService.ts',
  'services/watchwatcher-api/src/services/googleIdentityVerifier.ts',
  'services/watchwatcher-api/src/services/postgresDatabase.ts',
].map((filename) => path.join(root, filename));

export function calculateCoverage(reports, requiredFiles, {
  criticalFiles,
  overallThreshold = 85,
  otherThreshold = 85,
  criticalThreshold = 90,
} = {}) {
  if (!Array.isArray(reports) || reports.length !== 2 || !requiredFiles.length || !criticalFiles?.length) {
    throw new Error('Both coverage reports and the source file list are required.');
  }
  for (const threshold of [overallThreshold, otherThreshold, criticalThreshold]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      throw new Error('Coverage thresholds must be between 0 and 100.');
    }
  }
  const entries = new Map();
  for (const report of reports) {
    if (!report || typeof report !== 'object' || Array.isArray(report) || !report.total) {
      throw new Error('Coverage report is missing or malformed.');
    }
    let reportTotal = 0;
    let reportCovered = 0;
    for (const [filename, result] of Object.entries(report)) {
      if (filename === 'total') continue;
      const normalized = path.resolve(filename);
      if (entries.has(normalized)) throw new Error(`Duplicate coverage entry: ${normalized}`);
      const lines = result?.lines;
      if (!Number.isInteger(lines?.total) || !Number.isInteger(lines?.covered)
        || lines.total < 0 || lines.covered < 0 || lines.covered > lines.total) {
        throw new Error(`Invalid line coverage for ${normalized}`);
      }
      entries.set(normalized, lines);
      reportTotal += lines.total;
      reportCovered += lines.covered;
    }
    if (report.total.lines?.total !== reportTotal || report.total.lines?.covered !== reportCovered) {
      throw new Error('Coverage report totals are missing or inconsistent.');
    }
  }
  const summarize = (files, label) => {
    let total = 0;
    let covered = 0;
    for (const filename of files) {
      const normalized = path.resolve(filename);
      const lines = entries.get(normalized);
      if (!lines) throw new Error(`${label} source file missing from coverage reports: ${normalized}`);
      total += lines.total;
      covered += lines.covered;
    }
    if (!total) throw new Error(`${label} coverage contains no instrumentable source lines.`);
    return { covered, total, percentage: covered / total * 100 };
  };
  const required = requiredFiles.map((filename) => path.resolve(filename));
  const critical = criticalFiles.map((filename) => path.resolve(filename));
  if (new Set(required).size !== required.length || new Set(critical).size !== critical.length
    || critical.some((filename) => !required.includes(filename))) {
    throw new Error('Critical source files must be unique members of the required source list.');
  }
  const otherFiles = required.filter((filename) => !critical.includes(filename));
  const overall = summarize(required, 'Overall');
  const criticalCoverage = summarize(critical, 'Critical');
  const otherCoverage = summarize(otherFiles, 'Other');
  return {
    ...overall,
    critical: criticalCoverage,
    other: otherCoverage,
    passed: overall.percentage >= overallThreshold
      && otherCoverage.percentage >= otherThreshold
      && criticalCoverage.percentage >= criticalThreshold,
  };
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.(?:d|spec|test)\.ts$/.test(entry.name)) return [filename];
    return [];
  }));
  return files.flat();
}

async function main() {
  const reports = await Promise.all(reportPaths.map(async (reportPath) => JSON.parse(await readFile(path.join(root, reportPath), 'utf8'))));
  const requiredFiles = (await Promise.all(sourceRoots.map((sourceRoot) => sourceFiles(path.join(root, sourceRoot))))).flat();
  const result = calculateCoverage(reports, requiredFiles, { criticalFiles: criticalSourcePaths });
  console.log(`Combined line coverage: ${result.covered}/${result.total} (${result.percentage.toFixed(2)}%); required: 85%.`);
  console.log(`Critical line coverage: ${result.critical.covered}/${result.critical.total} (${result.critical.percentage.toFixed(2)}%); required: 90%.`);
  console.log(`Other source line coverage: ${result.other.covered}/${result.other.total} (${result.other.percentage.toFixed(2)}%); required: 85%.`);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Coverage gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}