# `noesis:implement-design-doc` — Execution Review (2026-04-30)

Subject run: design doc `019ddea6-262b-7000-a160-f38c6b4cb4b7` ("footprint-calculation-engine") implemented into the empty solution at `/home/marcin/Noesis/Repositories/AJ`.

Final state: `dotnet build` clean (0 / 0), `dotnet test` 17 / 17, `compare_implementation_to_design` returned `Ok` after **one fix iteration**. So the skill *worked*, but the path to convergence revealed five structural mismatches between the skill's references, the annotation package, and the scanner. Without a human re-reading the scanner source mid-run the comparator would not have converged.

This review identifies what those mismatches are, where they live, and proposes concrete edits per file.

---

## 1. Run summary

| Step | Outcome | Notes |
|---|---|---|
| 1. Read design doc | OK | `read_design_doc` MCP returned a 34 KB markdown rendering. |
| 2. BC + Module skeleton | OK | One BC, three modules; empty build green. |
| 3. Plan batches | OK | 4 batches, 7 subagent groups written to `<working_dir>/batches.md`. |
| 4. Implement BBs | OK *but with deviations* | 5 subagent dispatches, 6 forced deviations (see §3). 333 s for the FootprintFacade subagent. |
| 5. Adapters | OK | 2 parallel subagents. |
| 6. Build / test | OK | 19 / 19 after step 5. |
| 7. **Compare implementation to design** | **Mismatch (18 problems)** → fix loop → `Ok` | Required ~10 source/test edits + new `noesis-config.json`. |

Working-dir artefacts produced: `batches.md`, `before-scan.json` (27 B — empty), `after-scan.json` (7.0 KB — final). All present. No custom scripts created.

No errors during build/test. No subagent reported an unimplementable item. Time budget was dominated by the FootprintFacade subagent (333 s, 78 K tokens, 66 tool uses) — the only outlier; everything else stayed under 150 s.

---

## 2. What worked well

- **Coordinator/subagent split.** The coordinator never loaded type-specific references; each subagent read its narrow slice. Token usage stayed bounded.
- **Batched dependency planning.** The batches.md plan converged on the right topological order; no batch needed re-running.
- **Pre-flight `before-scan`.** The empty 27-byte snapshot was correctly captured before any code was written, surviving across subagent dispatches (it lived in `<working_dir>`).
- **Comparator's role was load-bearing.** The structural mismatch the comparator found (5 expected BBs missing, 6 unexpected BBs present, 5 unexpected Modules) was *not* visible from `dotnet build` or `dotnet test`. Without Step 7 the run would have shipped a structurally wrong implementation.
- **Re-scan after fixes was cheap.** One iteration of the fix loop converged.

---

## 3. Problems found

Severity legend: 🔴 = blocks correct convergence; 🟠 = forces deviation from skill instructions; 🟡 = friction or cost; 🟢 = nit.

### 🔴 P1 — Scanner ignores `[ExternalSystemIntegration]`

`scanner/ddd-annotations.ts` enumerates only the nine `Ddd*` attributes; the regex in `scanner/scanner.service.ts:39` only matches those. `[ExternalSystemIntegration("…")]` is **invisible to the scanner** even though it is the canonical attribute for `external_integration` BBs (used by `references/external-integrations.md` and the `IBillingGateway.cs` example in `references/modules.md`).

**Effect.** Every `external_integration` BB declared in a design doc is reported by the comparator as "missing" until the agent re-tags it with a `[Ddd*]` attribute. The agent in this run used `[DddRepository]` as a workaround — semantically wrong (a port to another module is not a repository), but the comparator only checks names, not types, for added BBs.

**Root cause.** Misalignment between three layers:
1. The design-doc schema (`shared-contracts/design-doc.ts` — supports `external_integration` as a `BuildingBlockType`).
2. The annotation package `NoesisVision.Annotations 0.1.2` (provides `[ExternalSystemIntegration]`).
3. The scanner (only reads `Ddd*`).

### 🔴 P2 — `[DddApplicationService]` cannot be applied to a class

`DddApplicationServiceAttribute` extends `EntryPointAttribute` extends `DomainBehaviorAttribute` whose `[AttributeUsage]` is `Method | Delegate | Interface`. AttributeUsage is inherited, so applying `[DddApplicationService]` to a `class` is a compile error.

But `references/application-services.md` instructs:

```csharp
[DddApplicationService]
[UseCasesLayer]
public class OrderApplicationService { … }
```

…which **does not compile** with the package version installed in `~/.nuget`. The Batch 4 subagent flagged this in its deviation report ("`[DddApplicationService]` is not valid on classes") and worked around it by moving the attribute to each behaviour method. The scanner then could not anchor an application-service BB to the class, and `FootprintFacade` plus its two behaviours showed up as missing in the comparator.

The fix-loop converted `FootprintFacade` to an interface (annotation lives there) plus `FootprintFacadeService` impl class. This works structurally but contradicts the example in the reference.

### 🔴 P3 — Scanner picks up *any* public method as a Behaviour

`extractBehaviors` in `scanner.service.ts` uses `parsePublicMethods` which only filters on access modifier and a few technical names — it does **not** require `[DomainBehavior]` (the regex `DOMAIN_BEHAVIOR_ATTRIBUTE_PATTERN` exists but is only consulted to extract a name override; absence does not exclude the method).

**Effect.** An auxiliary public method on a `[Ddd*]`-annotated type registers as a Behaviour. In this run, `SimpleComponent.VersionAt(DateTimeOffset)` — a small helper added to test Rule R6 at the BB level per `references/business-scenarios.md` — was reported as an unexpected `Behavior 'SimpleComponent/VersionAt'`. We had to remove the method from `SimpleComponent` and inline the resolution logic in the test fake.

Knock-on: this also forbids implementing Rules as public BB-level helpers, contradicting the BB-level test guidance in `business-scenarios.md`.

### 🔴 P4 — `[DddBoundedContext]` marker class is double-registered as a BB

The scanner regex matches every `[Ddd*]` annotation including `[DddBoundedContext]`. The marker class `FootprintCalculationContext` carrying `[DddBoundedContext("FootprintCalculation")]` becomes a BB named "FootprintCalculation" inside the BC "FootprintCalculation" (because `nameOverride = "FootprintCalculation"`). The comparator reports it as an unexpected `BuildingBlock 'FootprintCalculation/FootprintCalculation'`.

**Workaround applied.** Created `noesis-config.json` with `namespacesToExclude: ["FootprintCalculation", "FootprintCalculation.Tests.*"]` — the bare-root namespace pattern excludes the marker file without losing the BC (sub-module files reconstitute the BC via `buildModuleHierarchy`).

The skill never mentions `noesis-config.json`. The agent had to read the scanner source to discover it.

### 🔴 P5 — Test project is scanned by default

The `tests/FootprintCalculation.Tests/**` files were picked up as Modules `FootprintCalculation.Tests`, `FootprintCalculation.Tests.ComponentTree`, … Five "unexpected Module" entries in the comparator output. Same fix as P4: `noesis-config.json` exclusion. Same root issue: the skill is silent on it.

### 🟠 P6 — Modules.md guidance produces duplicate BBs for ports

`references/modules.md` shows:
```
IOrderRepository.cs   # [DddRepository, EntitiesLayer]      <- port
OrderRepository.cs    # [DddRepository, AdaptersLayer]      <- adapter
```

Both have `[DddRepository]`. The scanner registers **two** BBs (`IOrderRepository` + `OrderRepository`) — the comparator reports the adapter as "unexpected".

The fix-loop dropped `[DddRepository]` from the adapter, leaving only `[AdaptersLayer]`. This contradicts modules.md.

### 🟠 P7 — Doc BB names vs. C# `I`-prefix convention

The design doc declares the port BB name `ComponentRepository` (no `I`). The scanner uses the type name verbatim. The reference example uses `IComponentRepository`. The fix-loop dropped the `I` from the interface name to match the doc.

This is a project-wide naming-convention call that the skill never confronts. Three reasonable resolutions exist (rename the interface, rename the doc, scanner-side `I`-prefix dedup); the skill must pick one and document it.

### 🟠 P8 — Subagent for FootprintFacade was too large

333 seconds, 66 tool uses, 78 K tokens, 6 scenarios in one prompt. The slice mixed orchestration code, tree-construction in test fakes, scenario arithmetic, and scenario assertions. The skill's grouping rule (one subagent per BB type per batch) doesn't account for behaviour/scenario count. Splitting one-scenario-per-subagent (or batch-of-2) would have parallelised this and shortened wall-clock time.

### 🟠 P9 — Parallel `dotnet build` from sibling subagents

The skill says "process subagent groups in parallel". Each subagent reference instructs the subagent to run `dotnet build` and `dotnet test`. With three parallel subagents in Batch 3 they all wrote to the same `bin/`, `obj/` and re-targeted the same DLL. We got lucky; this is a race waiting to happen. (No errors observed in this run.)

### 🟡 P10 — Comparator returns mismatches, not actionable hints

The 18 "missing" / "unexpected" lines did not say "you have `IComponentRepository`; the doc expects `ComponentRepository` — try renaming". The agent had to read the comparator source to understand identity is by exact name. Pure UX, but it's the difference between "obvious one-line fix" and "spelunk through scanner.ts".

### 🟡 P11 — `scan_to_tmp` requires a manual `cp` to `<working_dir>`

The MCP tool writes to its own tmp area; the skill says "copy the file into `<working_dir>` so it survives the tool-output GC". This is a reliable foot-gun: forget the cp, lose the baseline, can't compare. The MCP could take an output path or the working dir.

### 🟡 P12 — `bun` is a hard dependency

`scripts/resolve-working-dir.ts` is a Bun script. If a user lacks `bun`, the skill aborts at setup. The script is small enough that it could be a TS-via-tsx, plain Node, or even a pure stdlib snippet.

### 🟢 P13 — `application-services.md` example imports `Domain.DDD` but uses `[UseCasesLayer]` from a different namespace

Minor: the example wires up two different annotation namespaces but doesn't show both `using` directives.

### 🟢 P14 — Design doc Property scanning

The skill says "Rules, Scenarios and Properties are out of scope" of Step 7. The agent has no guarantee that property *types* match the doc; e.g. a typo like `materialWeightKg: int` instead of `decimal` would build, pass tests if scenarios don't exercise it, and never be caught. Not a regression in this run, but a known scanner gap worth noting in the skill.

---

## 4. Root-cause analysis

| Layer | Root cause | Affected problems |
|---|---|---|
| **Scanner** (`scanner/scanner.service.ts`, `scanner/ddd-annotations.ts`) | Annotation list missing `ExternalSystemIntegration`; behavior detection promiscuous; BC marker treated as BB; no `I`-prefix dedup | P1, P3, P4 |
| **Annotation package** `NoesisVision.Annotations 0.1.2` | `[DddApplicationService]` AttributeUsage too narrow | P2 |
| **Skill references** | `application-services.md` example doesn't compile; `modules.md` adapter pattern duplicates BB; `external-integrations.md` uses an invisible attribute | P2, P6, P1 |
| **Skill SKILL.md** | Silent on `noesis-config.json`; silent on test-project exclusion; per-type subagent grouping ignores scenario count; parallel subagent build race not flagged | P4, P5, P8, P9 |
| **MCP tools** | `compare_implementation_to_design` has no name-similarity hints; `scan_to_tmp` doesn't write to working_dir | P10, P11 |
| **Tooling** | `scripts/resolve-working-dir.ts` requires bun | P12 |

The deepest issues (P1 + P2 + P3) sit on the *intersection* of three components nobody owns end-to-end. The scanner enumerates one set of attributes, the package ships a slightly different set with awkward AttributeUsage, and the references use yet a third set in their examples. **Picking a canonical attribute table and propagating it everywhere is the single highest-leverage fix.**

---

## 5. Implementation plan

Ordered roughly by leverage (highest first). Each item names the file(s) to edit and the concrete change.

### Phase A — Make the scanner / package / references consistent (fixes P1, P2, P3, P4)

**A1. Scanner: recognise `ExternalSystemIntegration`.**
- File: `mcp/noesis-graph/scanner/ddd-annotations.ts`
  - Add `"ExternalSystemIntegration"` to the recognised annotation list (rename from `DDD_ANNOTATIONS` to `BB_ANNOTATIONS` or similar — it's no longer DDD-only).
  - Update `annotationToBlockType` to map `"ExternalSystemIntegration"` → `"ExternalIntegration"` (matches `BuildingBlockType` in `shared-contracts/design-doc.ts`).
  - Update the `Ddd` strip regex to handle the non-Ddd case.
- File: `mcp/noesis-graph/scanner/scanner.service.ts`
  - The regex `ANNOTATION_WITH_TYPE_PATTERN` is generated from the list; verify it captures the `("…")` argument syntax used by `[ExternalSystemIntegration("ModuleName")]`.
  - Add an integration test asserting an interface annotated with `[ExternalSystemIntegration("X")]` produces a BB of type `external_integration`.

**A2. Scanner: require `[DomainBehavior]` for behaviour extraction.**
- File: `mcp/noesis-graph/scanner/scanner.service.ts`, function `parseMethodStatement` (around line 607).
  - Make `attrMatch` *required* — if the method has no `[DomainBehavior]` attribute, return `null`.
  - Add a unit test: a public method on a `[DddValueObject]`-annotated record without `[DomainBehavior]` does **not** become a behaviour.
  - Migration risk: existing scans that relied on implicit behaviour detection will lose those behaviours. Audit existing knowledge graphs before shipping.

**A3. Scanner: skip `[DddBoundedContext]` and `[DddDomainModule]`-annotated types from BB extraction.**
- File: `mcp/noesis-graph/scanner/scanner.service.ts`, around line 208 (the `for (const match of file.matches)` loop).
  - Add `if (match.annotation === "DddBoundedContext") continue;` (the BC is already inserted via `insertBoundedContext` separately at line 173).
  - Same for `DomainModule` if it gets added later.
- File: `mcp/noesis-graph/scanner/ddd-annotations.ts`
  - Document explicitly which annotations are "structural" (BC, Module) vs. "block" (everything else).

**A4. Annotation package: relax `[DddApplicationService]` AttributeUsage.**
- File (external repo): `P3-model-dotnet-annotations/Sources/Annotations/Domain/DDD/DddApplicationServiceAttribute.cs`
  - Add explicit `[AttributeUsage(AttributeTargets.Class | AttributeTargets.Interface | AttributeTargets.Method | AttributeTargets.Delegate)]` so the class target is permitted.
  - Bump package to 0.1.3, ship to nuget cache.
  - Same audit for any other `Ddd*` attribute that should be class-applicable but inherits a narrower target from `DomainBehaviorAttribute`.
- Alternative if upgrading the package isn't viable: change the reference to mark application services as **interfaces** + impl class, which is what we ended up doing. But codify this in the reference; don't leave it as a footnote.

**A5. References: align with the scanner/package.**
- File: `references/application-services.md`
  - Either: keep the class example *and* depend on A4 shipping (preferred — class-level annotation is more idiomatic).
  - Or: rewrite the example to interface + impl, naming convention `<Name>` for interface and `<Name>Service` for impl, and explain *why* (AttributeUsage constraint).
- File: `references/external-integrations.md` and `references/external-integration-adapters.md`
  - Rewrite to use a scanner-recognised annotation. After A1 ships, no change needed beyond verifying the example compiles.
  - Add an explicit note: the port carries the `[ExternalSystemIntegration("OtherModule")]` annotation; the adapter does **not** repeat it (carries `[AdaptersLayer]` only). This avoids duplicate BBs.
- File: `references/modules.md`
  - Update the example to drop `[DddRepository]` from the adapter entry; same for `[ExternalSystemIntegration]`. Adapters carry only `[AdaptersLayer]`. Add a one-line rationale ("only the port is a Building Block; the adapter is infrastructure").
- File: `references/repository-adapters.md`
  - Drop the `[DddRepository]` annotation from the example class (keep only `[AdaptersLayer]`). Note that the port retains it.

### Phase B — Surface the project-config and naming choices to the agent (fixes P4, P5, P7)

**B1. Skill: document `noesis-config.json`.**
- File: `SKILL.md`, Setup section.
  - Add a step "Setup 0a: Project config." For an empty solution, write a `noesis-config.json` at the solution root with at minimum:
    ```json
    {
      "namespacesToExclude": [
        "<BCName>",                  // BC marker file's namespace
        "<BCName>.Tests.*"           // test project namespaces
      ]
    }
    ```
  - For a non-empty solution, audit the existing `noesis-config.json` and confirm it covers tests + BC marker. Skill should `Read` it before proceeding.
  - This makes P4 and P5 disappear without requiring scanner changes.

**B2. Skill: codify the port-naming convention.**
- File: `SKILL.md`, new "Naming conventions" section.
  - Pick one rule and stick to it. Recommended: **the C# interface name equals the design-doc BB name** (no `I`-prefix). Rationale: the comparator matches by name; the doc is authoritative.
  - Document that the impl class for an application_service is `<BBName>Service` (when the BB is modelled as an interface) — see A4/A5.
  - Document that the adapter for a repository or external_integration uses an `InMemory<BBName>` / `<TargetSystem><BBName>` prefix and carries no DDD annotation.

**B3. Skill: write a "scanner contract" cheat-sheet.**
- New file: `references/scanner-contract.md`.
  - Reads-only by the coordinator, **once**, at Step 2 (alongside `modules.md`).
  - One page: which annotations the scanner sees, which are BB-anchoring vs. structural, the exact name match rule (verbatim type name; `I` prefix not stripped), which methods become behaviours (only `[DomainBehavior]` after A2; before A2: every public method).
  - Treat this as the *ground truth* the references must agree with.

### Phase C — Implementation plan robustness (fixes P8, P9)

**C1. Skill: scenario-aware grouping in Step 3.**
- File: `SKILL.md`, Step 3.
  - Refine the grouping rule: an `application_service` BB carrying ≥ 4 scenarios should be split — scenarios go to a separate subagent group dispatched after the orchestration code is in place.
  - Or: a "fan-out scenarios" sub-step. The first subagent writes the application service + private helpers + at most one happy-path scenario. A second subagent group writes the remaining scenarios, dispatched in parallel.

**C2. Skill: avoid parallel `dotnet build` collisions.**
- File: `SKILL.md`, Step 4.
  - Subagents inside a batch must NOT each run `dotnet build`. The coordinator runs a single `dotnet build` after the batch's subagents finish. Subagents merely report "files written; my work is done".
  - Or: parallel subagents work in MSBuild "no-shared-output" mode (`dotnet build --output <subagent-tmp>`), which is fragile. Coordinator-level build is simpler.
  - Same for `dotnet test` — coordinator-level after Step 5.

### Phase D — Tooling polish (fixes P10, P11, P12)

**D1. Comparator: add name-similarity hints.**
- File: `mcp/noesis-graph/implementation-check/comparison.ts`
  - When emitting "missing X" + "unexpected Y" pairs at the same level/op/parent, run a Levenshtein/affix-aware comparison and append a hint: `"unexpected 'IFoo' resembles missing 'Foo' (drop 'I' prefix?)"`.
  - Two-line UX win, no behavioural change.

**D2. `scan_to_tmp`: optional output path.**
- File: `mcp/noesis-graph/scanner/scanner.mcp.ts`
  - Add an optional `output_path` parameter. When provided, the scan result is written to that path; the agent does not need to `cp`.
  - Skill (Step 7) calls it with `output_path = <working_dir>/before-scan.json` / `<working_dir>/after-scan.json` directly.

**D3. `resolve-working-dir.ts` portability.**
- File: `scripts/resolve-working-dir.ts`
  - Either rewrite as a portable Node script (`tsx`/Node 22 with `--experimental-strip-types`), or document the bun dependency in the skill's preflight section so the failure mode is obvious.

### Phase E — Defensive guardrails (fixes P14 plus general)

**E1. Property-type guard.**
- File: `mcp/noesis-graph/implementation-check/comparison.ts`
  - Optional follow-up: scan property types as well, compare to the doc, emit a soft warning (`"property X.materialWeightKg expected decimal, found int"`). Keep status `Ok` (the skill says properties are out of scope) but make the warning visible.

**E2. Skill: pre-flight schema-language alignment check.**
- File: `SKILL.md`, between Step 1 and Step 2.
  - After reading the doc, the coordinator validates that every BB type appearing in the doc is recognised by the scanner. If the doc contains `external_integration` and the scanner does not recognise `[ExternalSystemIntegration]` (introspectable via a new MCP tool, e.g. `list_recognised_annotations`), warn the agent immediately: "the scanner cannot detect `external_integration`; either ship the scanner update or accept that these BBs will be tagged with a fallback Ddd attribute." This converts a 6-fix-iterations diagnostic event into a known-issue at Step 1.

---

## 6. Quick-wins (do these first)

If only one phase ships:

1. **A3** — skip `DddBoundedContext` in BB extraction. Three lines of TS, fixes P4 outright.
2. **A2** — require `[DomainBehavior]` for behaviour extraction. Tightens the scanner's contract; fixes P3.
3. **B1** — document `noesis-config.json` in the skill. Fixes P5.
4. **A5** (modules.md / repository-adapters.md / external-integration-adapters.md) — drop the duplicated `[Ddd*]` / `[ExternalSystemIntegration]` annotation from adapter examples. Fixes P6.

These four changes together would have made this run converge **without a fix loop** — Step 7's first compare would have returned `Ok`.

---

## 7. Open questions

- **Adapters carrying `[DddRepository]`**: is the intent that adapters are first-class Building Blocks (because they hold logic worth surfacing in the model), or pure infrastructure (invisible to the model)? The reference says yes; the comparator says no. Resolve, document.
- **`I`-prefix on interface ports**: is the C# convention more important than the design-doc name match? If yes, the scanner needs `I`-prefix dedup; if no, the references need to drop the `I`.
- **`external_integration` semantics**: in a modular monolith, is this distinguishable from a `repository` at the structural level the comparator cares about? If not, consider collapsing them in the doc schema.
- **Scenario tests at the BB level vs. Behaviour level**: when a Rule attaches to a BB (not a Behaviour), should the test exercise a public BB method? If yes, P3's fix breaks BB-level tests. If no, the reference needs to say so.

---

*Generated 2026-04-30 by `marcin:analyze-skill-execution` after the implement-design-doc run on `019ddea6-262b-7000-a160-f38c6b4cb4b7`.*
