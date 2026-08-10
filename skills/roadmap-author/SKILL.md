---
name: roadmap-author
description: Design a multi-stage roadmap — decompose work into stages, and shape the dependency graph so as much as possible can be worked in parallel without breaking cohesive units. Use when planning a large piece of work, writing a new roadmap, restructuring an existing one, or when a roadmap has turned out to be a queue rather than a plan.
---

# Authoring a roadmap

A roadmap turns one large piece of work into stages that can be picked up
independently. Producing the file format is [roadmap-format](../roadmap-format/SKILL.md);
this is about the decomposition itself.

**The decomposition is the whole value.** A roadmap whose stages happen to form a
straight line is a to-do list with extra ceremony — it delivers at exactly the rate one
pair of hands can review, no matter how many are available.

## Parallelism is a first-class design goal

Every `depends_on:` edge is a **serialisation**. It says: nobody may start this until
that has landed. Each edge on the critical path costs a full write–review–merge cycle of
wall-clock time, whether or not anyone is idle.

So when designing stages, optimise two numbers:

- **Width** — how many stages are startable at once. This is your ceiling on how many
  people or agents can contribute without tripping over each other.
- **Depth** — the longest dependency chain. This is your floor on elapsed time. A
  14-stage roadmap of depth 3 finishes far sooner than one of depth 9, regardless of
  total effort.

Shortening depth almost always beats adding stages. Two stages that can run at once are
worth more than one stage half the size.

### …without sacrificing cohesive stages

The counter-force matters just as much. A stage must be a **coherent unit** — one
reviewable PR, one thing you can describe in a sentence, something that leaves the
codebase working when it lands.

Parallelism bought by shredding a cohesive change into fragments is a false economy:

- fragments can't be reviewed on their own merits, so review gets *slower*
- half-landed abstractions leave the trunk in a state nobody wants to build on
- the fragments end up mutually dependent anyway, so the parallelism was imaginary

**When the two pull against each other, cohesion wins.** Prefer fewer, wider stages over
many narrow ones. Split only when both halves are independently meaningful — each with
its own goal, its own review, its own reason to exist.

## How to get width

**Find the spine, and keep it thin.** Most work has one foundation everything else needs
— the trait, the schema, the store. Make that its own stage, make it as small as it can
be while still being complete, and get it landed first. Every hour the spine is unlanded
is an hour nothing else can start.

**Cut along seams, not layers.** A stage that owns one vertical slice end to end depends
on far less than a stage that owns a horizontal layer across everything. "Logging a brew"
depends on the store. "All the write paths" depends on every feature that writes.

**Interrogate every edge.** For each one ask: *does this literally not work without that,
or does it merely feel like it comes second?* Ordering intuitions are the main source of
false edges, and a false edge costs a review cycle for nothing. Common false edges:

- *"It needs the tests from that stage"* — write the tests here.
- *"It'd be tidier after the refactor"* — tidiness is not a dependency.
- *"They both touch that file"* — a merge conflict is not a dependency. Conflicts are
  cheap; serialised review is not.
- *"That one's more important"* — priority is not dependency. Order the *list* by
  priority; don't encode it as an edge.

**Let two stages land in either order** when you can. A pair with no edge between them is
strictly better than a pair with one, even if you expect to do them in a particular order.

**Push the wide work early.** A stage that unblocks four others is worth doing before one
that unblocks none, even if the second is more interesting.

**Stub across a seam** to break a real edge. If B needs one function from A, and that
function's shape is decided, B can build against the signature while A implements it —
one decision recorded, two stages in parallel. Only do this where the interface is
genuinely settled, or you have traded a dependency for a rewrite.

## Decisions couple stages too

Two stages with no `depends_on:` between them are still coupled if they hinge on the same
**unsettled decision**. When it moves, both rework. That is nominal parallelism, not real.

So: **settle the shared decisions before fanning out.** Record each in the roadmap's
Decision index with the stages it binds. Then the fan-out is over stages whose
foundations are fixed, and the roadmap tells you which briefs to revisit when one moves
anyway.

If a decision genuinely can't be settled up front, prefer to concentrate the stages that
depend on it rather than spread them — one stage reworking is cheaper than four.

## The process

1. **Write the stage list first, ignoring order.** What are the pieces? Name each by what
   exists once it's done.
2. **Draw the dependency graph.** For each stage, what does it truly not work without?
3. **Attack the edges.** Walk each one with the questions above. Delete the false ones.
   For each survivor, ask whether a stub or a settled interface would remove it.
4. **Read off width and depth.** How many can start on day one? What's the longest chain?
   If width is 1, the decomposition is wrong — go back to step 1 and look for a seam.
5. **Check cohesion in the other direction.** Is any stage too small to review on its own
   merits, or does it leave things broken when it lands? Merge it back.
6. **Settle the shared decisions**, and record them in the Decision index.
7. **Write it up** per [roadmap-format](../roadmap-format/SKILL.md) — `ROADMAP.md` plus a
   brief per stage, with `depends_on:` holding exactly the surviving edges.

## Write the reasoning down

`depends_on:` records *that* an edge exists. The prose should record *why*, and just as
importantly **why the obvious edges don't**:

> **02 is the spine** — everything needs the store. **06 is deliberately independent of
> the 03→04→05 chain**, so it can run in parallel from the moment 02 lands. **07 needs
> only 03, not 04**, so the UI can be built against the raw log while stats are still
> being written.

That paragraph is what stops somebody "tidying up" a deliberate absence into an edge six
weeks later.

## Smells

- **Depth equals the number of stages.** It's a queue. Find a seam.
- **Every stage depends on its predecessor.** Almost certainly false edges; interrogate
  each one.
- **One stage everything depends on, and it's large.** The spine is doing too much —
  split it and land the minimum.
- **A stage you can't state the goal of in a sentence.** Too big, or not one thing.
- **Two stages you can't sensibly review apart.** Too small — merge them.
- **Many stages bound by one unsettled decision.** Settle it, or concentrate them.

## Related

- [roadmap-format](../roadmap-format/SKILL.md) — the file format this produces, and why
  `depends_on:` is the field the whole tool rests on
- [splitting.md](../roadmap-format/references/splitting.md) — splitting a stage once work
  has started and it turns out to be two
- [roadmap-next-stage](../roadmap-next-stage/SKILL.md) — picking up a stage, and stacking
  when a dependency is in review but not merged
