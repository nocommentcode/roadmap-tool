// Merging roadmaps read from several refs into one view.
//
// Working a stage rewrites the roadmap, and a stage can SPLIT ITSELF on its own branch —
// 03 becomes 03a + 03b, and the PR for 03a goes up while master and every other branch
// still describe a single stage 03. So there is no single ref that is correct: the truth
// is genuinely spread across master and each live branch.
//
// The merge is well-defined because stages are keyed by stem, not number:
//
//   • a stage only master has          → shown as is
//   • a stage only a branch has        → shown, marked proposed on that branch
//   • a stage both have                → the deepest branch wins, provenance recorded
//   • a stage named in `supersedes:`   → hidden; its replacements say what they replaced
//   • an edge to a superseded stage    → rewritten to its replacements (conservative:
//                                        blocked until all of them land)

/** `03a` sorts after `03` and before `04`. */
export function compareNum(a, b) {
  const [, an, as] = /^(\d+)(\D*)$/.exec(a) ?? [, a, ''];
  const [, bn, bs] = /^(\d+)(\D*)$/.exec(b) ?? [, b, ''];
  return Number(an) - Number(bn) || String(as).localeCompare(String(bs));
}

/**
 * @param base     roadmap read from master
 * @param overlays [{ ref, roadmap, depth }] — deeper (further from master) wins
 */
export function mergeRoadmaps(base, overlays = [], trunk = 'master') {
  const ordered = [...overlays].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

  /** key → { stage, refs: Set, origin } */
  const byKey = new Map();
  const put = (stage, ref, isBase) => {
    const prev = byKey.get(stage.key);
    if (!prev) {
      byKey.set(stage.key, { stage: { ...stage }, refs: new Set([ref]), origin: isBase ? 'master' : ref });
      return;
    }
    prev.refs.add(ref);
    // later overlay wins on content, but a stage first seen on master stays master's
    prev.stage = { ...prev.stage, ...stage };
  };

  for (const s of base?.stages ?? []) put(s, trunk, true);
  for (const o of ordered) for (const s of o.roadmap.stages) put(s, o.ref, false);

  // supersession: key → [replacement keys]
  const replacedBy = new Map();
  for (const { stage } of byKey.values()) {
    for (const old of stage.supersedes ?? []) {
      if (!replacedBy.has(old)) replacedBy.set(old, []);
      replacedBy.get(old).push(stage.key);
    }
  }

  /** follow supersession transitively, so a split of a split still resolves */
  const resolve = (key, seen = new Set()) => {
    if (!replacedBy.has(key) || seen.has(key)) return [key];
    seen.add(key);
    return replacedBy.get(key).flatMap((k) => resolve(k, seen));
  };

  const stages = [];
  for (const [key, entry] of byKey) {
    if (replacedBy.has(key)) continue; // superseded — its replacements stand in
    const s = entry.stage;
    stages.push({
      ...s,
      // an edge to a stage that has since split means "all of its halves"
      dependsOn: [...new Set((s.dependsOn ?? []).flatMap((d) => resolve(d)))].filter((d) => d !== key),
      supersedes: (s.supersedes ?? []).filter((k) => byKey.has(k) || true),
      /** which refs describe this stage */
      onRefs: [...entry.refs],
      /** null when master has it; otherwise the branch that proposes it */
      proposedOn: entry.refs.has(trunk) ? null : entry.origin,
    });
  }

  stages.sort((a, b) => compareNum(a.num, b.num));

  // display numbers, computed after supersession so they point at surviving stages
  const numOf = new Map(stages.map((s) => [s.key, s.num]));
  for (const s of stages) {
    s.dependsOnNums = s.dependsOn.map((k) => numOf.get(k) ?? k);
    s.supersedesNums = (s.supersedes ?? []).map((k) => byKey.get(k)?.stage?.num ?? k);
  }

  // decisions and prose come from the deepest ref that has them
  const deepest = ordered.length ? ordered[ordered.length - 1].roadmap : base;
  return {
    ...(deepest ?? base),
    stages,
    refs: [trunk, ...ordered.map((o) => o.ref)],
  };
}
