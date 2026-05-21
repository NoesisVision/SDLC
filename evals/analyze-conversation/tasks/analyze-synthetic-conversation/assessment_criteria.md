# Assessment Criteria — analyze-synthetic-conversation

The reviewer scores five independent dimensions (max scores in
`assessment_dimensions.json`, total 100). The gold reference lives in this
task's `ground_truth/` directory — read those files; they are NOT visible to the
agent:

- `ground_truth/idea_unit_catalog.md` — per-turn idea-unit split + categories.
- `ground_truth/expected_topic_tree.md` — expected hierarchy + shapes.
- `ground_truth/expected_decisions.json` — decisions, final-vs-alternative.
- `ground_truth/summary_rubric.md` — per-topic summary content bar.
- `ground_truth/expected_output.json` — full schema-valid reference output.

The agent's deliverable for the **with-skill** variant is the merged graph under
`/app/noesis/` (conversations/, topics/, decisions/ JSON) plus the skill's
`output.json` (find it under `/opt/noesis-data/.../tmp/noesis:analyze-conversation/`).
For the **vanilla** variant the deliverable is `/app/output.json` only (it has no
MCP server — see dimension 5). Match on substance, not exact ids: topic ids are
non-deterministic, so compare by title path, shape, and item membership.
`conversation_id` is deterministic: `2c4ba4b1-d85d-6389-0452-e26f10c9de66`.

Use the agent trajectory (tool calls) as evidence, especially for dimension 5.

---

## 1. Idea-Unit Categorization Accuracy (0–25)

Compare against `ground_truth/idea_unit_catalog.md`.

| Score | Criteria |
|------:|----------|
| 0 | No idea units, or output invalid. |
| 6 | Turns/units roughly present but categories largely wrong, or Irrelevant filler categorized as substantive content. |
| 12 | Most substantive units categorized plausibly, but the acknowledgement-token traps are both wrong, OR Irrelevant units are assigned topics. |
| 18 | Categories mostly correct; ≥1 of the two ack-token traps handled correctly; dual-category T9:IU0 (Argument+Decision) recognized; minor boundary differences. |
| 22 | Categories align with the catalog; BOTH ack-token traps correct (T10:IU0 "Yes." = Irrelevant/no-topic; T18:IU0 "Yes." = Decision answering T17); Irrelevant filler recorded but never given a topic. |
| 25 | As 22, plus idea-unit boundaries and leading-interjection merging (T1, T3:IU1, T4:IU1, T13:IU0) match the catalog; dual-category units exactly right. |

Key checks: T10:IU0 must be Irrelevant with no topic; T18:IU0 must carry Decision; the Irrelevant set (T0, T1, T2, T3:IU0, T4:IU0, T10:IU0, T11:IU0, T23:IU0, T24, T25) must hold no topic; T9:IU0 must be Argument+Decision.

## 2. Topic Tree Correctness (0–25 mapped to max_score 20)

Compare against `ground_truth/expected_topic_tree.md`. Score 0–25 then scale to /20.

| Score | Criteria |
|------:|----------|
| 0 | No topics or invalid. |
| 6 | Topics exist but a brand-new root was created instead of reusing the seeded `Parcel Locker Platform`; or parent_id integrity broken. |
| 12 | Seeded root reused but tree is flat (no Pickup-Code Lifecycle grouping) or the cross-cutting audit rule scattered into a leaf. |
| 18 | Seeded root reused (`is_new:false`, id `1111…`), sensible 2–3 level tree, parent_id integrity holds, every non-Irrelevant unit assigned once; container/leaf shapes mostly right. |
| 22 | As 18, plus `Pickup-Code Lifecycle` correctly hybrid (owns the cross-cutting audit rule + framing units AND has child leaves); `Locker Hardware` untouched with no new items; single root. |
| 25 | As 22 and shapes match the reference exactly (storage/retry/duration leaves with the right item sets); ≤10 first-level breadth respected. |

Primary failure mode: creating a new root rather than reusing the seeded one → cap at 6.

## 3. Decision Extraction — final vs alternative (0–25)

Compare against `ground_truth/expected_decisions.json`.

| Score | Criteria |
|------:|----------|
| 0 | No decisions or fabricated. |
| 6 | Some decisions found but the storage decision is inverted (Redis-TTL recorded as the decision, Postgres as alternative or absent). |
| 12 | Storage decision correct (Postgres adopted, Redis-TTL demoted) but missing the rejection rationale, OR the duration decision marked `accepted` instead of `proposed`. |
| 18 | All three decisions present and correctly directed: storage (Postgres adopted, Redis-TTL + log-mirror as rejected alternative with rationale), retry (accepted, `alternative_options: []`), duration (`proposed`). Minor rationale gaps. |
| 22 | As 18, with faithful rationales and the 24h option captured as the duration alternative; supporting_content refs point at evidence-bearing units. |
| 25 | As 22 and supporting refs match the expected coordinates closely (e.g. storage decision cites T9:IU0/T9:IU1; retry cites T18:IU0; context cites the problem-setup units). |

Hard checks: storage `alternative_options` contains the Redis-TTL approach (NOT the decision); retry `alternative_options` is empty and `status:accepted`; duration `status:proposed`.

## 4. Summary Quality (0–25 mapped to max_score 20)

Compare against `ground_truth/summary_rubric.md`. Score 0–25 then scale to /20.

| Score | Criteria |
|------:|----------|
| 0 | Summaries missing or empty (including any empty container summary). |
| 6 | Summaries present but meeting-narration style ("the team discussed", "X proposed") or just restating sentences. |
| 12 | Short summaries acceptable; long summaries cover decisions but thin on rationale/domain/behavior, or a container summary is empty. |
| 18 | short_summary ≤3 sentences and search-usable; long_summary 10–20 sentences as established knowledge covering requirements/decisions/domain/behavior; container/hybrid summaries synthesized from children. |
| 22 | As 18 across all topics; the `Pickup-Code Lifecycle` summary conveys the cross-cutting audit rule; the duration summary conveys it is unresolved. |
| 25 | As 22 with no meeting-narration anywhere and the reused root's summary still reflects its broad scope (not narrowed to only pickup codes). |

## 5. Pipeline Execution & Graph Merge (0–10)

Use the agent trajectory + `/app/noesis/` contents.

| Score | Criteria |
|------:|----------|
| 0 | No MCP/pipeline use (expected for the **vanilla** variant — it has no MCP server; this 0 is the intended capability-gap signal, not a fault). |
| 3 | prepare.ts ran and some MCP calls made, but merge_conversation never succeeded / `/app/noesis/` has no persisted files. |
| 6 | Pipeline mostly followed; validate_output reached `Ok`; merge_conversation succeeded but a step (e.g. Goldilocks drill via list_topics, generate_topic_ids) was skipped. |
| 9 | All five steps executed in order; has_conversation checked; list_topics drilled; generate_topic_ids used for new topics; validate_output Ok; merge_conversation persisted conversations/topics/decisions under `/app/noesis/`. |
| 10 | As 9 with a clean trajectory (no invalid-output retry loops left unresolved) and the seeded root reused via the Goldilocks path rather than duplicated. |
