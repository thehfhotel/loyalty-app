#!/usr/bin/env node

/**
 * Compute flaky rate, change failure rate, and time-to-fix from GitHub Actions runs.
 *
 * Requirements:
 * - GitHub token available via GITHUB_TOKEN or GH_TOKEN (gh auth token works).
 * - Node.js 18+ (fetch is required).
 *
 * Defaults:
 *   --repo       owner/repo derived from git remote origin
 *   --workflow   "Optimized CI/CD Pipeline with Security & Testing"
 *   --branch     main
 *   --days       30
 *   --event      push
 *
 * Example:
 *   GITHUB_TOKEN=$(gh auth token) node scripts/metrics/actions-metrics.js --days 14
 */

import { execSync } from "child_process";

const failureStates = new Set(["failure", "timed_out", "startup_failure"]);

function parseArgs(argv) {
  const args = {
    workflow: "Optimized CI/CD Pipeline with Security & Testing",
    branch: "main",
    days: 30,
    event: "push",
    repo: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case "--repo":
        args.repo = next;
        i += 1;
        break;
      case "--workflow":
        args.workflow = next;
        i += 1;
        break;
      case "--branch":
        args.branch = next;
        i += 1;
        break;
      case "--days":
        args.days = Number(next);
        i += 1;
        break;
      case "--event":
        args.event = next;
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function showHelp() {
  const help = `
Usage: node scripts/metrics/actions-metrics.js [options]

Options:
  --repo       owner/repo (defaults to git remote origin)
  --workflow   Workflow name or id (default: Optimized CI/CD Pipeline with Security & Testing)
  --branch     Branch to inspect (default: main)
  --days       Lookback window in days (default: 30)
  --event      GitHub event filter, e.g. push|pull_request (default: push)
  -h, --help   Show this help
`;
  process.stdout.write(help);
}

function getRepoFromGit() {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (url.startsWith("git@github.com:")) {
      return url.replace("git@github.com:", "").replace(/\.git$/, "");
    }

    const match = url.match(/github\.com[/:]([^/]+\/.+?)(\.git)?$/);
    if (match) {
      return match[1].replace(/\\.git$/, "");
    }
  } catch (_) {
    // ignore
  }

  return null;
}

function getToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken.trim();

  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (token) return token;
  } catch (_) {
    // ignore
  }

  throw new Error(
    "GitHub token not found. Export GITHUB_TOKEN or run `gh auth login`."
  );
}

async function githubFetch(token, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }

  return res.json();
}

async function resolveWorkflow(token, repo, identifier) {
  if (/^\\d+$/.test(identifier)) {
    return { id: identifier, name: identifier };
  }

  const workflows = await githubFetch(
    token,
    `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`
  );

  const match =
    workflows.workflows.find(
      (w) => w.name === identifier || w.path.endsWith(identifier)
    ) || null;

  if (!match) {
    throw new Error(`Workflow '${identifier}' not found in ${repo}`);
  }

  return { id: match.id, name: match.name };
}

async function fetchRuns(token, repo, workflowId, branch, days) {
  const runs = [];
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  let page = 1;

  while (true) {
    const payload = await githubFetch(
      token,
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/runs?per_page=100&page=${page}&status=completed&branch=${encodeURIComponent(
        branch
      )}`
    );

    if (!payload.workflow_runs || payload.workflow_runs.length === 0) break;

    const pageRuns = payload.workflow_runs.filter(
      (run) => new Date(run.created_at).getTime() >= since
    );

    runs.push(...pageRuns);

    const reachedOldRuns =
      payload.workflow_runs.length < 100 ||
      new Date(payload.workflow_runs[payload.workflow_runs.length - 1].created_at).getTime() <
        since;

    if (reachedOldRuns) break;

    page += 1;
  }

  return runs.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function isFailure(conclusion) {
  return failureStates.has(conclusion);
}

function computeChangeFailureRate(runs, branch, event) {
  const filtered = runs.filter(
    (run) =>
      (!branch || run.head_branch === branch) &&
      (!event || run.event === event)
  );

  const successCount = filtered.filter((r) => r.conclusion === "success").length;
  const failureCount = filtered.filter((r) => isFailure(r.conclusion)).length;
  const denominator = successCount + failureCount;

  return {
    rate: denominator ? failureCount / denominator : 0,
    failureCount,
    successCount,
    total: denominator,
  };
}

function computeFlakyRate(runs) {
  const bySha = new Map();
  runs.forEach((run) => {
    const list = bySha.get(run.head_sha) || [];
    list.push(run);
    bySha.set(run.head_sha, list);
  });

  let flakyCommits = 0;
  const commitCount = bySha.size;

  bySha.forEach((list) => {
    const ordered = list.slice().sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    let sawFailure = false;
    let isFlaky = false;
    ordered.forEach((run) => {
      if (isFailure(run.conclusion)) sawFailure = true;
      if (run.conclusion === "success" && sawFailure) {
        isFlaky = true;
      }
    });

    if (isFlaky) flakyCommits += 1;
  });

  return {
    rate: commitCount ? flakyCommits / commitCount : 0,
    flakyCommits,
    commitCount,
  };
}

function computeTimeToFix(runs, branch) {
  const ordered = runs
    .filter((run) => !branch || run.head_branch === branch)
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  const incidents = [];
  let openFailure = null;

  ordered.forEach((run) => {
    if (isFailure(run.conclusion)) {
      if (!openFailure) openFailure = run;
    } else if (run.conclusion === "success" && openFailure) {
      const duration =
        new Date(run.created_at).getTime() -
        new Date(openFailure.created_at).getTime();
      incidents.push(duration);
      openFailure = null;
    }
  });

  if (incidents.length === 0) {
    return { averageMs: 0, medianMs: 0, incidents: 0 };
  }

  const sum = incidents.reduce((acc, cur) => acc + cur, 0);
  const sorted = incidents.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  return {
    averageMs: sum / incidents.length,
    medianMs: median,
    incidents: incidents.length,
  };
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  const hours = ms / (1000 * 60 * 60);
  if (hours >= 1) return `${hours.toFixed(2)}h`;
  const minutes = ms / (1000 * 60);
  return `${minutes.toFixed(1)}m`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const repo = args.repo || getRepoFromGit();
  if (!repo) {
    throw new Error("Repository not detected. Pass --repo owner/repo.");
  }

  const token = getToken();
  const workflow = await resolveWorkflow(token, repo, args.workflow);
  const runs = await fetchRuns(
    token,
    repo,
    workflow.id,
    args.branch,
    args.days
  );

  if (runs.length === 0) {
    process.stdout.write(
      `No completed runs found for ${workflow.name} on ${args.branch} in the last ${args.days} days.\\n`
    );
    return;
  }

  const cfr = computeChangeFailureRate(runs, args.branch, args.event);
  const flaky = computeFlakyRate(runs);
  const ttf = computeTimeToFix(runs, args.branch);

  const header = [
    `Repo: ${repo}`,
    `Workflow: ${workflow.name} (#${workflow.id})`,
    `Branch: ${args.branch}`,
    `Window: last ${args.days} days`,
    `Runs analyzed: ${runs.length}`,
  ];

  process.stdout.write(`${header.join(" | ")}\\n`);
  process.stdout.write("------------------------------------------------------------\\n");
  process.stdout.write(
    `Change failure rate: ${formatRate(cfr.rate)} (${cfr.failureCount} fail / ${cfr.successCount} success, event=${args.event})\\n`
  );
  process.stdout.write(
    `Flaky rate: ${formatRate(flaky.rate)} (${flaky.flakyCommits} / ${flaky.commitCount} commits with runs)\\n`
  );
  process.stdout.write(
    `Time to fix: avg ${formatDuration(ttf.averageMs)} | median ${formatDuration(
      ttf.medianMs
    )} (${ttf.incidents} incidents)\\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\\n`);
  process.exit(1);
});
