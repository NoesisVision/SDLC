# Execution review — `noesis:implement-design-doc`

**Run:** Footprint Calculation Engine (`f9cb90cc-0ec6-4c1a-bb9f-c600ba3b490a`) — 2026-05-09 → 2026-05-10
**Outcome:** comparator `Ok` after 3 fix-loop iterations; doc sealed.
**Verdict:** the skill *worked* but the wall-clock cost was dominated by avoidable workarounds, not by writing code.

---

## Time accounting (rough)

| Phase                                      | Time | Notes                                                                |
| ------------------------------------------ | ---- | -------------------------------------------------------------------- |
| Setup, doc read, batches.md                | ~3m  | clean                                                                |
| Batch 1–5 actual code (5 subagents)        | ~13m | the only "real work"                                                 |
| **Race-condition cleanup (Batch 1)**       | ~3m  | parallel subagents stomped on each other's `FootprintCalculation.Tests` scaffold |
| **Annotation lib v0.1.2 incompatibility**  | ~5m  | `[DddApplicationService]` could not go on a class in v0.1.2          |
| **Pre-impl scan retake**                   | ~5m  | baseline taken too late; comparator demanded a fresh empty scan       |
| **BC marker double-counted**               | ~2m  | `[DddBoundedContext]` class scanned as both a BC and a BB            |
| **Test project as Module**                 | ~3m  | required `noesis-config.json` not mentioned anywhere in the skill    |
| **Helper methods auto-promoted to Behaviors** | ~5m | every public method on a DDD-annotated type became a "Behavior"      |
| **EmissionFactorPort not detected**        | ~3m  | scanner does not recognise `[ExternalSystemIntegration]`             |
| **Total fix-loop wall-time**               | ~26m | ~65% of the run                                                      |

Two-thirds of the run was spent fighting the scanner/comparator/annotation contract. None of those mismatches are mentioned in `SKILL.md` or in the references the subagents are told to read.

---

## What I actually had to know that the skill never told me

These are the facts a coordinator must know to converge on `Ok` without N round-trips through the comparator. None of them are in `SKILL.md` or its references today:

1. **The scanner only recognises 9 DDD attributes** (`scanner/ddd-annotations.ts`):
   `DddAggregate`, `DddApplicationService`, `DddBoundedContext`, `DddDomainEvent`, `DddDomainService`, `DddEntity`, `DddFactory`, `DddRepository`, `DddValueObject`.
   `[ExternalSystemIntegration]` is a NoesisVision attribute but **not** a scanner marker.

2. **The reference `external-integrations.md` is wrong / underspecified.**
   It instructs to use `[ExternalSystemIntegration("…")]` + `[EntitiesLayer]` on the interface. The scanner cannot see that — the BB never appears in the scan and the comparator reports it "not introduced".
   The actual fix is to add `[DddRepository]` (the closest scanner-recognised marker for a read-only port) — this works because the comparator matches BBs by *name* for `added` diffs.

3. **The pre-impl scan must be taken before *any* `FootprintCalculation` namespace exists**, not just before Step 4.
   Step 2 writes a `[DddBoundedContext]`-marked class so a `dotnet build` can succeed. By the time Step 7 says "take the baseline", the BC is already detected from the very namespace declaration in that marker class — and the comparator then complains "added BoundedContext not introduced" because the baseline already has it. SKILL.md says the scan is taken "before Step 4 starts" but the pragmatic timing is *before Step 2 starts*.

4. **The `[DddBoundedContext]` marker class is double-counted.**
   The scanner regex matches `[DddBoundedContext] … class FootprintCalculationContext` and emits both a Bounded Context **and** a BuildingBlock with the BC's name. The comparator then complains about an "unexpected BB". The marker class must be deleted; the BC is detected from any namespace usage in the project.

5. **The scanner picks up Behaviors as "every public method on an annotated DDD type"** — *not* "every method with `[DomainBehavior]`". `[DomainBehavior]` is decorative; it does not gate detection.
   That means every helper / factory / formatter on a value object or domain service surfaces as an unexpected Behavior. The way to suppress is `internal` (or, on interfaces in C# 8+, an explicit `internal` modifier on the member).

6. **The Tests project is auto-detected as a sub-Module of the BC** because its namespace is `<BC>.Tests`.
   The fix is a `noesis-config.json` in the solution root with `namespacesToExclude: ["<BC>.Tests"]`. This file is never mentioned in `SKILL.md` or any reference; I had to find it by reading `scanner-config.ts`.

7. **Annotation lib v0.1.2 vs v0.1.3 is a breaking change.**
   In v0.1.2 (the version `dotnet add package` defaults to today), `DddApplicationServiceAttribute` extends `EntryPointAttribute` and targets `Method | Interface | Delegate` only — putting it on a class is a `CS0592`. In v0.1.3 it extends `DomainObjectAttribute` and works on classes (matching `application-services.md`).
   Subagents that follow the reference verbatim hit a build error on v0.1.2 and either work around it (placing the attribute on each method, which then fails the actor-annotation check) or escalate. The skill never pins a version.

8. **Parallel subagents in the same batch fight over scaffold.**
   Batch 1 had two groups (`value_object` × 4 and `domain_service` × 1). Both were told "if the test project does not exist yet, create it" and both raced to `dotnet new xunit`. The faster one finished, the slower one ran into a half-built tree, deleted what it didn't recognise, and erased the other subagent's tests. This is a structural flaw in the dispatch contract — not a subagent bug.

---

## Did the agent follow the skill's instructions?

Mostly yes:

- ✅ Loaded `modules.md` once, kept it in context for Step 2.
- ✅ Did not load type-specific references in the coordinator.
- ✅ Did not create a coordinator-side reshape of the doc; re-read the rendered Markdown when needed.
- ✅ Wrote `batches.md` to `<working_dir>` in the documented format.
- ✅ Subagents loaded their per-type reference + `business-scenarios.md` + `quality-attributes.md`.
- ✅ All `[Actor("Customer")]` annotations attached.
- ✅ Comparator drove the fix-loop until `Ok`; only then sealed the doc.

Deviations were forced by the contract gaps above:

- ⚠ Pre-impl scan was first taken *after* Step 2 (per the literal instruction "before Step 4"). I had to re-take it after deleting all source.
- ⚠ Several methods were left `public` in the first pass because no instruction tells subagents that public methods on DDD types become Behaviors.
- ⚠ One subagent placed `[DddApplicationService]` on each method; I "corrected" it to the class-level form, which then failed to build on v0.1.2 of the annotation lib until I upgraded.

---

## Were instructions unambiguous?

These instructions are ambiguous or under-specified:

1. *"The pre-implementation scan must be taken before any code is written or deleted in Step 4."* — Step 2 *does* write code (BC marker class). The comparator behaves as if the baseline must precede Step 2.
2. *"Annotate the interface with `[ExternalSystemIntegration("...")]` and `[EntitiesLayer]`"* (in `external-integrations.md`) — this is invisible to the scanner.
3. *"For every public Behaviour on an `application_service` host with `actor` set in the doc, instruct the subagent to apply `[Actor("<name>")]` to the C# method signature."* — only mentions Actor; never mentions that *every other public method* on the host gets auto-detected as a Behavior, which is the actually load-bearing scanning rule.
4. *"create a new C# project under the solution root and register it in the solution"* — does not mention pinning `NoesisVision.Annotations` to `0.1.3` (the version `application-services.md` and `modules.md` are written against).
5. *"the `compare_implementation_to_design` step in Step 7 verifies this annotation deterministically"* — does not say which BB types or modules the scanner accepts, nor that `noesis-config.json` is the only mechanism to exclude the Tests project.

---

## Custom scripts

No custom scripts were created during the run. `bun run scripts/resolve-working-dir.ts` was used as documented.

---

## Errors

| Error                                                                         | Cause                                                                    | Recoverable? | Cost |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------ | ---- |
| `EmissionCalculatorTests.cs` deleted by Batch-1-Group-1 subagent              | Race condition on test-project scaffold; one subagent classified the other's file as stale. | Yes — coordinator recreated the file inline. | ~3 min |
| `CS0592: 'DddApplicationService' is not valid on this declaration type`       | v0.1.2 of `NoesisVision.Annotations` had method-only AttributeUsage.     | Yes — added local NuGet source, upgraded to v0.1.3. | ~5 min |
| Comparator: `Missing change: added BoundedContext 'FootprintCalculation' not introduced.` | Baseline taken after Step 2, BC already present.                       | Yes — moved all `*.cs` aside, rescanned, restored. | ~3 min |
| Comparator: `Missing change: added BuildingBlock 'FootprintCalculation/EmissionFactorPort' not introduced.` | Scanner doesn't recognise `[ExternalSystemIntegration]`.    | Yes — added `[DddRepository]` to the port. | ~3 min |
| Comparator: 7× `Unexpected change: added Behavior 'X/Y'`                       | Public methods on annotated types auto-detected as Behaviors.            | Yes — bulk-internal'd helpers. | ~5 min |
| Comparator: `Unexpected change: added Module 'FootprintCalculation.Tests'`     | Tests project namespace was nested under BC.                             | Yes — `noesis-config.json`. | ~2 min |
| Comparator: `Unexpected change: added BuildingBlock 'FootprintCalculation/FootprintCalculation'` | `[DddBoundedContext]` marker class double-counted as a BB.       | Yes — deleted the marker class. | ~2 min |
| Comparator: `Unexpected change: added Behavior 'EmissionFactorPort/VersionAt'` | Interface methods are scanned as Behaviors unless `internal`.            | Yes — `internal` modifier on the interface member (C# 8+). | ~2 min |

---

## Delays — root causes ranked

1. **Hidden contract between scanner and references.**
   `references/*.md` document a *language-level* convention (`[ExternalSystemIntegration]`, `[DddBoundedContext]` on a marker class, `[DomainBehavior]` on methods) that does not match what the scanner (`scanner/scanner.service.ts`, `scanner/ddd-annotations.ts`) actually keys off. Every comparator mismatch in this run traces back to this divergence.

2. **No version pin on the annotation library.**
   The references show class-level `[DddApplicationService]`. Only v0.1.3 supports that. `dotnet add package` resolves the latest cached compatible version, which today happens to be v0.1.2. Subagents have no way to know.

3. **Step 2 vs Step 7's pre-impl-scan timing.**
   The skill schedules the baseline after Step 2, but the comparator's "added BC" check sees Step 2 as part of the codebase, not part of the implementation diff.

4. **Parallel subagents over shared scaffold.**
   The dispatch contract assumes subagent groups don't share files. Test-project bootstrap is a shared file.

5. **No coordinator-side preview of comparator expectations.**
   The first comparator call surfaced 11 problems at once. The coordinator had to triage them sequentially because each fix could uncover or create new mismatches. There is no dry-run / preview / "what would the comparator see right now" hook.

---

## Improvement plan

### A. Reference / SKILL fixes (cheap, immediate)

#### A1. Pin `NoesisVision.Annotations` to a known-good version

- In `modules.md`, `application-services.md`, `domain-services.md`, `value-objects.md`, `repositories.md`, `external-integrations.md`, `aggregates.md`, `entities.md`, `domain-events.md`, `domain-commands.md`, `domain-queries.md`, `factories.md`: add a one-liner near the top: *"Project must reference `NoesisVision.Annotations` v0.1.3 or later (`[DddApplicationService]` is a class-level attribute starting in v0.1.3)."*
- In `SKILL.md` Step 2: when creating a new BC project, pin `NoesisVision.Annotations` `>=0.1.3`. Concrete instruction:
  ```
  dotnet add <bc>.csproj package NoesisVision.Annotations --version 0.1.3
  ```

#### A2. Document the scanner contract in `SKILL.md` (or in a new `scanner-contract.md` referenced from Step 7)

The coordinator must know, before dispatching subagents:

- The scanner only recognises these 9 DDD attributes: `DddAggregate`, `DddApplicationService`, `DddBoundedContext`, `DddDomainEvent`, `DddDomainService`, `DddEntity`, `DddFactory`, `DddRepository`, `DddValueObject`.
- A class with `[DddBoundedContext]` is detected as **both** the BC and a BB. **Do not create a `[DddBoundedContext]`-marked class.** The BC is detected from namespace usage by any other class in that project.
- Public methods on annotated DDD types are detected as Behaviors regardless of `[DomainBehavior]`. To keep a public method out of the detected Behaviors, mark it `internal`. For interface members that must be hidden, use the C# 8+ explicit `internal` modifier on the member.
- The Tests project must be excluded via `noesis-config.json` at the solution root:
  ```json
  { "namespacesToExclude": ["<BC>.Tests"], "namespacePartsToSkip": [] }
  ```

#### A3. Fix `external-integrations.md`

Replace the current content (which only mentions `[ExternalSystemIntegration]`) with:

```
- Annotate the interface with [DddRepository] AND [ExternalSystemIntegration("<other-module-name>")] AND [EntitiesLayer].
- [DddRepository] makes the scanner pick the port up as a Building Block (the scanner does not currently recognise [ExternalSystemIntegration]).
- [ExternalSystemIntegration] preserves the documentation/intent that this port goes out to another module.
```

Same fix in `repository-adapters.md` and `external-integration-adapters.md` for symmetry.

#### A4. Move the pre-impl scan to before Step 2

Update `SKILL.md` Step 7 (the pre-impl-scan instruction) to:

> **Pre-implementation scan.** *Before Step 2 starts*, take a baseline snapshot. Call `scan_to_tmp` and copy the result to `<working_dir>/before-scan.json`. The baseline must precede the BC project skeleton — once Step 2 writes a `*.cs` file under the BC namespace, the scanner sees the BC and the comparator's "added BoundedContext" check breaks.

Move the corresponding paragraph in the Workflow section so the pre-impl scan is its own numbered step before Step 2 (e.g. promote it to "Step 2a: Take the pre-implementation baseline").

#### A5. Drop `[DddBoundedContext]` from `modules.md`

The example in `modules.md` (line 5–12) creates a `SalesContext` class with `[DddBoundedContext]`. That class is the source of the double-count problem. Replace with:

```
- Do NOT add a [DddBoundedContext]-annotated marker class — the scanner already
  recognises the BC from any class in that project's namespace, and a marker
  class is double-counted as a Building Block.
```

Drop the example block lines 7–12.

#### A6. Add a "what NOT to write" cheatsheet to subagent prompts

In SKILL.md Step 4, add to the MUST-include list:

> - **Public-method discipline:** every helper, factory, or formatter that is not declared as a Behaviour in the design doc must be `internal`. The scanner detects every public method on a DDD-annotated type as a Behaviour and the Step-7 comparator will report it as unexpected.
> - **Tests-project namespace:** name test classes under `<BC>Tests` (no dot) or rely on the solution-root `noesis-config.json` excluding `<BC>.Tests`. Do not put test types in a sub-namespace of the BC namespace without that exclusion.

#### A7. Resolve the parallel-scaffold race

In SKILL.md Step 4, add:

> Before dispatching the first batch's subagents, the coordinator creates the test project (`<BC>.Tests`) itself: `dotnet new xunit`, register in solution, project-reference the BC project, drop the default `UnitTest1.cs`, add `<InternalsVisibleTo>`, add `[assembly: NotDomainModel]`. Subagents must NOT bootstrap the tests project; their prompts say "the tests project already exists, add your test files there."

This single change removes the race entirely — the only place where parallel subagents share writes was the test-project scaffold.

### B. Tooling fixes (larger, real engineering)

#### B1. Teach the scanner about `[ExternalSystemIntegration]`

`scanner/ddd-annotations.ts` currently lists 9 attributes and maps them via `annotationToBlockType` (`Ddd*` → `*`). Extend it:

```ts
export const DDD_ANNOTATIONS = [
  "DddAggregate",
  "DddApplicationService",
  "DddBoundedContext",
  "DddDomainEvent",
  "DddDomainService",
  "DddEntity",
  "DddFactory",
  "DddRepository",
  "DddValueObject",
  "ExternalSystemIntegration",   // NEW
] as const;

export function annotationToBlockType(annotation: DddAnnotation): string {
  if (annotation === "ExternalSystemIntegration") return "ExternalIntegration";
  return annotation.replace(/^Ddd/, "");
}
```

…and have `scanner.service.ts`'s regex include the new attribute. The comparator already only matches BB additions by name, so this change is backward-compatible.

After B1 lands, A3's `[DddRepository] + [ExternalSystemIntegration]` workaround can revert to the doc's intent: just `[ExternalSystemIntegration]` + `[EntitiesLayer]`.

#### B2. Make Behaviour detection opt-in via `[DomainBehavior]`

Currently the scanner detects every public method on an annotated DDD type as a Behaviour. Switch to: a method is a Behaviour iff it carries `[DomainBehavior]` (or one of its specialisations like `[EntryPoint]`).

This is a one-line change in `scanner.service.ts` `parseMethodStatement`:

```ts
// before:
//   const attrMatch = DOMAIN_BEHAVIOR_ATTRIBUTE_PATTERN.exec(stmt);
//   const nameOverride = attrMatch?.[1] ?? null;
//   ...

// after:
const attrMatch = DOMAIN_BEHAVIOR_ATTRIBUTE_PATTERN.exec(stmt);
if (!attrMatch) return null;          // ← only annotated methods are Behaviors
const nameOverride = attrMatch[1] ?? null;
```

This eliminates a whole class of false positives and makes "what becomes a Behaviour" align with the references already telling subagents to put `[DomainBehavior]` on each Behaviour method.

The downside: existing code that relies on auto-detection breaks. Worth a major-version bump on the scanner — but this run shows the auto-detect rule is the single biggest source of comparator noise.

#### B3. Make `[DddBoundedContext]` BC-only (no BB shadow)

Adjust the scanner so a class annotated with `[DddBoundedContext]` registers a BC and is **not** also added to that BC's `buildingBlocks`. Currently `scanner.service.ts` indiscriminately turns every annotated type into a BB; the BC-marker case is the only one where the BB shadow is actively wrong.

Two choices, equivalent in effect:
- (a) when assembling `BuildingBlockBranch`, skip entries whose `annotation === "DddBoundedContext"`;
- (b) when assembling `BoundedContextBranch`, deduplicate the BC name out of `buildingBlocks`.

(a) is cleaner.

#### B4. Provide a coordinator-side dry-run

Add an MCP tool `compare_design_to_after`:

- Input: `design_doc_id`, `after_scan_path`.
- Output: same shape as `compare_implementation_to_design`, but treats `before` as empty.

The coordinator could call this *before* Step 7's first real comparator call, immediately after the build is green, to surface mismatches without needing a (frozen, possibly wrong) baseline. It also makes the "iteration counter" cleaner — fixes don't depend on a baseline that itself must be re-taken.

#### B5. Auto-`<InternalsVisibleTo>` and auto-`[assembly: NotDomainModel]` in the test scaffold

Currently the coordinator (or subagent) must remember to add `<InternalsVisibleTo Include="<BC>.Tests" />` and `[assembly: NotDomainModel]`. A small `dotnet new` template (or a `bun` helper script in `plugins/noesis/scripts/`) that produces a ready-to-use test project would make Step 4 straightforward.

### C. SKILL.md restructure (separate from content fixes)

The current `SKILL.md` interleaves three different audiences:
- Setup / pre-flight (read by the coordinator at start-of-run).
- Subagent prompt skeleton (executed by subagents).
- Verification / sealing (read by the coordinator at end-of-run).

Split into:

- `SKILL.md` — workflow + dispatch contract (coordinator's view).
- `references/scanner-contract.md` (NEW) — the 9 attributes, public-method-becomes-Behaviour rule, BC-marker rule, Tests namespace exclusion. Listed in the pre-flight reads in `SKILL.md`. The coordinator carries this in active context the way it carries `modules.md` today.
- `references/subagent-prompt.md` (NEW) — the boilerplate every subagent prompt must include (target paths, references-to-read list, build/test commands, report-back format). The coordinator builds each subagent prompt by composing this skeleton with the slice-specific data. Reduces the chance that two subagents in the same batch get drift in their instructions.

---

## Implementation plan — ordered

Cheapest wins first, structural fixes after.

### Phase 1 — same-day documentation fixes (no code changes)

1. `references/external-integrations.md` — replace with the `[DddRepository] + [ExternalSystemIntegration]` pairing (A3).
2. `references/modules.md` — drop the `[DddBoundedContext]` example block, replace with the "do NOT create a BC marker class" guidance (A5).
3. `SKILL.md` Step 2 — pin `NoesisVision.Annotations 0.1.3` (A1).
4. `SKILL.md` Step 7 (pre-impl-scan) — move to a new "Step 2a" before Step 2 (A4).
5. `SKILL.md` Step 4 — add the public-method / tests-namespace cheatsheet (A6); add the coordinator-bootstraps-tests-project rule (A7).
6. New `references/scanner-contract.md` documenting the 9 attributes, public-method rule, BC-marker rule, and `noesis-config.json` exclusion (A2). Add to pre-flight reads in `SKILL.md`.

Estimated effort: 1 hour. Removes ~80 % of the lost time on future runs.

### Phase 2 — scanner fixes (1–2 day)

1. **B3** (drop BC-marker BB shadow) — small, isolated, no consumer break.
2. **B1** (recognise `[ExternalSystemIntegration]`) — small. After this lands, revert A3 in `external-integrations.md` to the original single-attribute form.
3. **B5** (test-project scaffold script) — small.

After Phase 2, A1 / A4 / A6 / A7 still apply — they describe what coordinators must do. A2's scanner-contract reference can shrink because B1+B3 close two of its bullet points.

### Phase 3 — opt-in Behaviour detection (multi-day, breaks existing scans)

1. **B2** (`[DomainBehavior]`-only Behaviours).
2. Re-scan all reference projects to confirm the change is safe.
3. **B4** (dry-run comparator tool) — convenience layer; not strictly required after B2 because Behaviour false positives go away.

### Phase 4 — `SKILL.md` restructure (after Phase 1–3)

1. **C** split into `SKILL.md` + `scanner-contract.md` + `subagent-prompt.md`.

This is bookkeeping; do it once the scanner contract is stable so the docs don't churn.

---

## What I would change about *this run* if I had to redo it

1. Take the pre-impl scan **immediately after `bun resolve-working-dir`**, before `dotnet new classlib`. Saves the moves-then-restore dance.
2. Bootstrap the test project in the coordinator (Step 2 or Step 3a), not in subagents.
3. Pin `NoesisVision.Annotations 0.1.3` from the start.
4. In every subagent prompt, default to `internal` for any helper / factory that the doc doesn't explicitly declare as a Behaviour.
5. Drop the `[DddBoundedContext]` marker class.
6. Mark the port `[DddRepository]` from the start (until B1 lands).
7. Add `noesis-config.json` to the solution root in Step 2.
8. Add `[assembly: NotDomainModel]` to the test project as part of its scaffold.

With those eight changes, this run would have hit `Ok` on the first comparator call.
