// Source: GitHub, via one `gh pr list`. The snapshot script did N+1 `gh pr view`
// calls (~40s); the list endpoint carries every field we need in a single ~2s call.

import { behindMaster, isAncestorOfMaster } from './git.mjs';
import { sh } from '../util.mjs';

const FIELDS = [
  'number', 'title', 'url', 'state', 'isDraft', 'baseRefName', 'headRefName',
  'reviewDecision', 'mergeStateStatus', 'mergeable', 'statusCheckRollup', 'reviews',
  'comments', 'additions', 'deletions', 'changedFiles', 'createdAt', 'updatedAt',
  'mergedAt', 'mergeCommit', 'body', 'files',
].join(',');

const BOTS = new Set(['coderabbitai', 'github-actions', 'dependabot']);

export async function readGithub({ repo, trunk = 'master', limit = 40 }) {
  const [raw, ownerRaw] = await Promise.all([
    sh('gh', ['pr', 'list', '--state', 'all', '--limit', String(limit), '--json', FIELDS], repo),
    sh('gh', ['repo', 'view', '--json', 'nameWithOwner'], repo),
  ]);

  let list = [];
  try { list = JSON.parse(raw || '[]'); } catch { list = []; }
  const nameWithOwner = (() => {
    try { return JSON.parse(ownerRaw || '{}').nameWithOwner ?? null; } catch { return null; }
  })();

  const prs = await Promise.all(
    list.map(async (d) => {
      const checks = (d.statusCheckRollup ?? []).map((c) => ({
        name: c.name ?? c.context ?? '?',
        status: c.conclusion || c.state || c.status || 'PENDING',
      }));
      const reviewers = [...new Set((d.reviews ?? []).map((r) => r.author?.login).filter(Boolean))];
      const humanReviews = (d.reviews ?? []).filter((r) => !BOTS.has(r.author?.login));

      // "behind master" only means anything for a branch you might still push to, and
      // most of these refs aren't fetched locally — 40 failing rev-lists cost seconds.
      const [landedOnMaster, behind] = await Promise.all([
        d.mergeCommit?.oid ? isAncestorOfMaster(repo, d.mergeCommit.oid, trunk) : Promise.resolve(false),
        d.state === 'OPEN' ? behindMaster(repo, d.headRefName, trunk) : Promise.resolve(null),
      ]);

      // `Roadmap-Stage: <slug>/<stage-key>` — the authoritative PR→stage link.
      // Repeatable, so one PR can close several stages.
      const roadmapStages = [...(d.body ?? '').matchAll(/^\s*Roadmap-Stage:\s*([\w.-]+)\/([\w.-]+)\s*$/gim)]
        .map((m) => ({ slug: m[1], stage: m[2] }));

      // Which roadmaps this PR touches. Without it, the title fallback ("Stage 06")
      // matches stage 06 of EVERY roadmap in the repo — four bundling stages were
      // reading as Done off brain-chat-parity's PRs.
      const roadmapsTouched = [
        ...new Set(
          (d.files ?? [])
            .map((f) => f.path?.match(/^docs\/roadmaps\/([^/]+)\//)?.[1])
            .filter(Boolean),
        ),
      ];

      return {
        number: d.number,
        title: d.title,
        roadmapStages,
        roadmapsTouched,
        url: d.url,
        state: d.state,
        isDraft: d.isDraft,
        baseRefName: d.baseRefName,
        headRefName: d.headRefName,
        reviewDecision: d.reviewDecision || null,
        mergeStateStatus: d.mergeStateStatus,
        mergeable: d.mergeable,
        checks,
        checksPassed: checks.filter((c) => c.status === 'SUCCESS').length,
        checksTotal: checks.length,
        reviewers,
        humanReviewCount: humanReviews.length,
        botReviewCount: (d.reviews ?? []).length - humanReviews.length,
        commentCount: (d.comments ?? []).length,
        additions: d.additions,
        deletions: d.deletions,
        changedFiles: d.changedFiles,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        mergedAt: d.mergedAt,
        mergeCommit: d.mergeCommit?.oid ?? null,
        landedOnMaster,
        behindMaster: behind,
      };
    }),
  );

  return { prs, nameWithOwner };
}
