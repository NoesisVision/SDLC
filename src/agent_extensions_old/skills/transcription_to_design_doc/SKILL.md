---
name: noesis:transcription-to-design-doc
description: Extract DesignDoc JSON from meeting transcription files. Converts messy, long conversation transcripts into structured DesignDoc schema with proper ChangeSet diffs (added/removed/modified). Use this skill whenever the user provides a meeting transcription, recording transcript, or conversation log and wants to extract design decisions into the DesignDoc JSON format, create or update a design document from meeting notes, or structure design discussions into machine-validatable output.
---

# Transcription to DesignDoc

Convert meeting transcription (markdown) into valid DesignDoc JSON that conforms to the project's JSON schema.

## Inputs

- **Transcription file:** Markdown file path. Get from `$ARGUMENTS` or user message. Use whenever `{file_path}` is mentioned.
- **Existing design (optional):** JSON file path or MCP server providing the current design state. If provided, output is a diff against it. If absent, output is a first-iteration diff (everything in `added`).
- **Output path (optional):** Where to write the result. Default: `{transcription_dir}/{transcription_stem}_design_doc.json`.
- **Skill directory:** Resolve the directory containing this SKILL.md file. Use whenever `{skill_dir}` is mentioned. All scripts are in `{skill_dir}/scripts/`.

## Context Management — Critical

Meeting transcriptions can be 50k-150k tokens (4+ hours). Context overflow destroys output quality. Follow these rules without exception:

1. **NEVER read the entire transcription at once.** Use `Read` with `offset` and `limit` parameters (500-800 lines per chunk).
2. **Write intermediate results to files immediately.** Do not accumulate large structures in your working memory.
3. **Use a working directory** for all intermediate files: `{transcription_dir}/.work_{transcription_stem}/`
4. **Release detail between phases.** After completing a phase, you have the phase output file — you do not need to remember the raw content that produced it.
5. **For Phase 4 (extraction), use subagents** when there are more than 3 topic clusters. Each subagent gets a fresh context window and reads only its relevant transcription sections.

## Workflow

### Phase 0: Setup

1. Resolve `{skill_dir}`, `{file_path}`, output path
2. Count transcription lines: `wc -l {file_path}`
3. Plan chunk boundaries (500-800 lines each, adjust to avoid splitting mid-paragraph if possible)
4. Create working directory: `mkdir -p {work_dir}`
5. If existing design provided, read it and write a brief summary to `{work_dir}/existing_design_summary.md` (list actors, bounded contexts, key building blocks by name)
6. Read the schema guide: [design_doc_schema_guide.md](references/design_doc_schema_guide.md)

### Phase 1: Survey

Read the transcription chunk by chunk. For each chunk, append a structured survey entry to `{work_dir}/survey.md`.

**What to extract from each chunk:**

- **Topics discussed** — with line range, e.g., "Order processing redesign [L120-L250]"
- **Decisions made** — look for: "let's go with", "we decided", "agreed", "the approach will be", "so we'll do", affirmative consensus
- **Decisions reversed** — look for: "actually, let's not", "forget what I said about", "I changed my mind", "that won't work because"
- **Actors/roles** mentioned as users or systems interacting with the design
- **Domain terms** introduced or defined — capture in building block names and descriptions
- **Quality requirements** — performance targets, availability expectations, security constraints
- **Business rules** — constraints, invariants, validation logic discussed

**Tag each decision with confidence:**
- **DECIDED** — explicitly agreed upon by participants
- **TENTATIVE** — discussed favorably but not committed ("maybe", "we could", "worth considering")
- **REJECTED** — explicitly ruled out

**Skip entirely:** off-topic chatter, pleasantries, logistics ("let's take a break"), filler, repetition of already-captured points. Meeting transcriptions are noisy — your job is to be a precise filter.

After surveying ALL chunks, write `{work_dir}/survey_summary.md`: total topics, decisions, actors found.

### Phase 2: Consolidate

Read `{work_dir}/survey.md` in full. Produce `{work_dir}/consolidated.md`:

1. **Group related topics** — the same topic often reappears across the conversation as participants circle back. Merge them.
2. **Resolve contradictions chronologically** — when the same decision point has conflicting statements, the LATEST explicit statement wins. Document what changed: "Initially X was proposed [L80], but later changed to Y [L340] because Z."
3. **Merge domain terms** into a unified glossary with final definitions.
4. **Finalize actor list** with descriptions.
5. **Drop REJECTED items** unless they provide important rationale for DECIDED items.
6. **Keep TENTATIVE items** flagged separately for user review.

Structure of consolidated.md:

```
## Actors
- {name}: {role description}

## Domain Terms
- {name}: {definition as agreed in the discussion}

## Design Decisions (DECIDED)
### {Topic name}
- Decision: {what was decided}
- Rationale: {why, from the discussion}
- Line references: [L{start}-L{end}]
- Bounded context: {if identifiable}
- Building blocks: {if identifiable}
- Rules: {business rules mentioned}
- Scenarios: {examples/test cases discussed}

## Tentative Items
### {Topic name}
- Proposal: {what was discussed}
- Lines: [L{start}-L{end}]
- Why tentative: {what confirmation is missing}
```

### Phase 3: User Review

If there are TENTATIVE items in `{work_dir}/consolidated.md`:

1. Present each tentative item to the user via AskUserQuestion
2. For each: include as decided, exclude, or modify
3. Update `{work_dir}/consolidated.md` with user decisions

If no tentative items, skip to Phase 4.

### Phase 4: Extract Design Elements

Map consolidated decisions to DesignDoc schema elements. This is the most demanding phase — it requires re-reading relevant transcription sections to extract precise details.

**For 3 or fewer topic clusters — process directly:**

For each decided topic:
1. Re-read the specific line ranges from the transcription
2. Extract DesignDoc elements following the schema guide
3. Write elements to `{work_dir}/elements/{topic_slug}.json`

**For more than 3 topic clusters — use subagents:**

For each topic cluster, launch a subagent with:
```
Extract DesignDoc elements from transcription.

Topic: {topic_name}
Decisions: {decisions summary from consolidated.md}
Transcription file: {file_path}
Line ranges to read: {line_ranges}
Schema guide: {skill_dir}/references/design_doc_schema_guide.md
Output file: {work_dir}/elements/{topic_slug}.json
Existing design elements (if any): {relevant existing elements}

Read the schema guide first. Then read ONLY the specified line ranges from the transcription.
Extract all DesignDoc elements (actors, bounded contexts, modules, building blocks, behaviours, rules, scenarios) discussed in this topic.
Write a valid JSON fragment to the output file.
```

Launch up to 5 subagents in parallel. Wait for all to complete.

**Element extraction rules:**
- Use exact terminology from the transcription (ubiquitous language)
- Descriptions should capture the discussed intent, not mechanical paraphrasing
- BDD scenarios (given/when/then) should reflect examples participants actually discussed
- Elements are identified by `name`, not by ID — there are no ID fields in the schema
- All fields marked required in the schema MUST be populated for `added` elements
- BuildingBlock `type` must be one of the enum values — interpret from context (e.g., "the Order aggregate" → type: "aggregate")
- Use cases discussed in the meeting are modeled as **public behaviours** on building blocks: set `is_public: true` and `actor` to the actor name

### Phase 5: Compose DesignDoc JSON

1. Read all element files from `{work_dir}/elements/`
2. Deduplicate and merge into a single DesignDoc structure
3. Ensure all cross-references are consistent (e.g., actor names in behaviours match Actor definitions, BuildingBlock names in input/output/usedBuildingBlocks exist)

**If no existing design (first iteration):**
- Place ALL elements into `added` arrays within their respective ChangeSets
- All required scalar fields must be populated (no nulls on added elements)
- Sub-elements also go into their respective `added` arrays

**If existing design provided:**
- Elements not in existing design → `added`
- Elements with same name but changed fields → `modified` (only include changed fields + the `name`)
- Elements explicitly removed in discussion → `removed` (list of names)
- Unchanged elements → omit entirely (a ChangeSet with empty arrays should be omitted or set to null)

4. Write to `{work_dir}/design_doc_draft.json`

Use camelCase for JSON field names where applicable (matching the JSON schema aliases: `boundedContexts`, `buildingBlocks`, `ruleType`, `usedBuildingBlocks`).

### Phase 6: Validate

Run the validation script:
```
uv run {skill_dir}/scripts/validate_design_doc.py {work_dir}/design_doc_draft.json
```

The script finds the JSON schema automatically (first checks `{skill_dir}/references/design-doc-diff-schema.json`, then falls back to `contracts/design-doc-diff-schema.json` from the git root).

- If `status` is `"valid"`: proceed to Phase 7
- If `status` is `"invalid"`: read the `errors` array, fix each issue in the JSON, re-validate. Repeat up to 3 times. If still failing, present errors to user.

### Phase 7: Deliver

1. Copy validated JSON to the output path
2. Remove working directory: `rm -rf {work_dir}`
3. Present summary to user:
   - Output file path
   - Counts: actors, bounded contexts, modules, building blocks, behaviours (public/private), rules, scenarios
   - Any caveats or ambiguities from the transcription

## Handling Common Transcription Problems

**Topic ping-pong:** Participants discuss Topic A, switch to B, return to A 45 minutes later. The survey phase captures all mentions with line ranges; consolidation merges them. When re-reading in Phase 4, read ALL line ranges for a topic, not just the first one.

**Implicit decisions:** Sometimes a decision is never explicitly stated — the group just moves on with an assumption. If you notice a consistent assumption across multiple discussion points but no explicit "we decided" moment, mark it TENTATIVE and flag for user review.

**Terminology drift:** Participants may use different words for the same concept ("the order", "the purchase", "the transaction"). In consolidation, identify synonyms and settle on one canonical term. Note the aliases in the DomainConcept description.

**Incomplete information:** A transcription may discuss a building block without fully specifying its properties or behaviours. Extract what was discussed. For required fields where no information was given, use a descriptive placeholder that signals incompleteness (e.g., description: "Discussed but details not specified in meeting — needs follow-up").

## Reference Files

- [design_doc_schema_guide.md](references/design_doc_schema_guide.md) — Read at Phase 0. Concise schema reference with element types, field requirements, and ChangeSet pattern.
- [design-doc-diff-schema.json](references/design-doc-diff-schema.json) — The JSON Schema used for validation. Bundled with the skill for portability.
