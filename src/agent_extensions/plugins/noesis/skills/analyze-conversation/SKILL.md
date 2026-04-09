---
name: noesis:analyze-conversation
description: Analyze a conversation transcript to build a knowledge graph. Extracts idea units, assigns topics, captures decisions, and generates summaries. Use after registering a conversation with register_conversation.
---

# Analyze Conversation

Build a knowledge graph from a registered conversation transcript. Extracts atomic idea units, assigns them to a global topic tree, captures ADR-style decisions, and generates summaries.

## Setup

- **conversation_id:** Get from `$ARGUMENTS`. Use whenever `{conversation_id}` is mentioned.

## Workflow

### Step 0: Preconditions

Verify the conversation is registered and detect language:

1. Call `get_next_turn_batch(conversation_id, max_tokens=500)` to confirm the conversation exists and get a small sample of turns.
2. If it fails, stop and inform the user.
3. Detect the transcript language from the returned sample turns. Store as `{language}` and pass to all subagents. All topic titles, summaries, decisions, and cross-reference descriptions must be written in English, regardless of transcript language. Idea unit `text` fields must preserve the original language verbatim (traceability).
4. Discard the sample batch — Step 1 starts from the beginning (`last_turn_order` = null).

### Step 1: Sequential Batch Analysis

Extract idea units from all turns using sequential subagents with rolling context.

**Preparation:**
1. Call `get_topic_nodes()` to get root-level topics.
2. If topics exist: for each root topic with children, call `get_topic_nodes(parent_id)` to get one level of children. Store this two-level topic context as `{topic_context}` (topic_ids and titles only — omit summaries to conserve token budget).
3. If no topics exist (first conversation): set `{topic_context}` to `{"empty": true, "note": "First conversation — no existing topics. Create general preliminary topics suitable as root-level categories."}`.

**Batch loop:**

Set `batch_number` = 1, `last_turn_order` = null, `active_state` = `{}`, `max_tokens` = 10000.

Repeat:
1. Launch a **batch_analyzer** subagent with:
   ```
   conversation_id: {conversation_id}
   batch_number: {batch_number}
   last_turn_order: {last_turn_order}
   max_tokens: {max_tokens}
   active_state: {active_state}
   topic_context: {topic_context}
   language: {language}
   ```
2. Wait for the subagent to complete. Parse its summary output (idea_unit_count, preliminary_topic_count, preliminary_topic_titles). The full data (including active_state) is stored server-side by the subagent via `store_batch_results`.
3. If the subagent fails or returns malformed output, retry once with the same parameters. If it fails again, log the error, skip this batch, and continue with `last_turn_order` advanced by estimating the next natural boundary (set `max_tokens` to 3000 for the skip-ahead call to minimize loss).
4. Call `get_latest_batch_state(conversation_id)` to retrieve `active_state`, `last_primary_turn_order`, and `has_more` from server-side storage. Update `active_state` and `last_turn_order` from the response.
5. **Update `topic_context`:** Append the batch's `preliminary_topic_titles` to `{topic_context}`. This lets subsequent batches reuse topic labels instead of inventing duplicates.
6. Increment `batch_number`.
7. If `has_more` is false, stop the loop.

### Step 2: Topic Reconciliation

Match preliminary topics against the global topic tree and store all idea units.

1. Call `get_batch_results(conversation_id)` to get the aggregated preliminary topics across all batches.

2. **Deduplicate** preliminary topics:
   - First, check the `similarity_groups` field. Each group lists topic titles that share >60% of their source turns — these likely refer to the same subject. For each group, pick the most descriptive title and merge the others into it.
   - Then, manually deduplicate remaining topics with the same subject but different wording (e.g., "Planned costs" vs "Planned vs actual costs").

3. **First-conversation fast path:** If no existing topics were found in Step 1 Preparation, skip the hierarchical traversal. Instead, organize the deduplicated preliminary topics into a logical hierarchy (roots and subtopics) and create them all in a single batch via `create_topics`. This avoids N redundant `get_topic_nodes()` calls against an empty tree.

4. **Hierarchical matching (when existing topics exist):**

   For each unique preliminary topic (or batch of related topics):

   1. Start at root level: call `get_topic_nodes()`.
   2. Evaluate: does this topic match an existing root, belong under one, or is it a new root?
   3. If it belongs under an existing node, call `get_topic_nodes(parent_id)` to see children.
   4. Continue narrowing until you reach:
      - **Continuation**: matches existing topic — reuse its `topic_id`.
      - **New subtopic**: refines an existing topic — call `create_topics` as a child.
      - **New sibling**: peer of existing topics — call `create_topics` at that level.
      - **New root**: no match — call `create_topics` without parent.

5. **Build topic mapping and store idea units:**
   - For each preliminary topic that maps to a **new** topic (created in this step), add an entry: `{preliminary_topic: title, topic_id: new_id}`.
   - For existing topics already matched by `parent_topic_hint: "existing:<topic_id>"` in the batch results, no mapping entry is needed — resolution is automatic.
   - Call `resolve_and_store_idea_units(conversation_id, topic_mapping)` to resolve and store all idea units server-side. No data passes through LLM context.

6. Check the response for `unresolved_topics`. If any, create topics for them and call `resolve_and_store_idea_units` again with the additional mappings.

7. **Verify assignments:**
   1. Launch a **topic_reviewer** subagent (**FOREGROUND — wait for completion before proceeding**) with `conversation_id` and the list of topic IDs that received idea units. Do NOT run the reviewer in the background — `finalize_conversation` will reject if the reviewer hasn't completed. Parse only the final JSON block from the reviewer's output; ignore verbose analysis.
   2. If the reviewer flags mismatches, fix them by reassigning or creating new topics.
   3. Note any **structural events**: new subtopics created, or topics with many children (>7). (Structural warnings are also auto-detected by `finalize_conversation`.)

### Step 3: Decision Extraction

Extract ADR-style decisions from topics that have Decision/Position/Argument idea units.

1. Call `get_topics_with_categories(conversation_id, categories=["Decision", "Position", "Argument"])` to get the exact topic IDs that need decision extraction. Do NOT call `get_topic_idea_units` from the main context to identify decision-bearing topics — that pulls full idea unit text into the main context unnecessarily.
2. **Pre-filter (re-analysis only):** For each topic_id, call `get_decisions(topic_id)`. If existing decisions already cover the topic and no new contradictory positions were introduced in this conversation, skip that topic. Only launch decision_writers for topics where: (a) no decisions exist yet, or (b) the conversation introduced new Decision/Position/Argument idea units that may supersede existing decisions.
3. For each remaining topic (or group of related topics), launch a **decision_writer** subagent with:
   ```
   topic_ids: [list of topic IDs]
   conversation_id: {conversation_id}
   ```
4. Run up to 5 subagents in parallel.
5. Wait for all to complete.

### Step 4: Summaries and Cross-References

1. **Topic summaries** (delegated to subagents):
   - Collect the topic IDs that received new idea units in this conversation.
   - Split them into batches of up to 10 topic IDs each.
   - For each batch, launch a **summary_writer** subagent with:
     ```
     topic_ids: [list of topic IDs]
     conversation_id: {conversation_id}
     ```
   - Run up to 5 subagents in parallel.
   - Wait for all to complete. Summary writers call `set_summaries` directly — do NOT expect summaries in their output. Only collect `semantic_shifts` from the output JSON.

2. **Cross-references** (main agent): Review the topics touched by this conversation. For each pair of topics where the conversation explicitly discusses a relationship (e.g., "module A depends on module B"), identify the type:
   - Types: `depends_on`, `contradicts`, `refines`, `supersedes`, `related_to`.
   - Do not infer relationships from co-occurrence alone.
   - Call `create_cross_references(refs)`.

3. **Conversation summary** (main agent): Generate an overall summary of the conversation. Call `set_summaries([], conversation_summary)` to store only the conversation-level summary (topic summaries are already stored by the subagents).

4. Note any topics with semantic shifts as **semantic events**.

### Step 5: Micro-Restructuring (Conditional)

**Skip if no structural or semantic events were flagged in Steps 2 and 4.**

For each flagged node:
1. Call `get_topic_nodes(parent_id)` to load the node's siblings.
2. Evaluate whether the node should be split, reparented, or merged with a sibling.
3. If changes are needed, present the proposal to the user with `AskUserQuestion`.
4. If approved, execute via `merge_topics`, `reparent_topic`, or `reorder_topic`.

### Step 6: Finalize

Call `finalize_conversation(conversation_id)`. Check the response:
- If `status` is `"error"`, the reviewer gate failed — go back to Step 2.7 and run the topic reviewer.
- If `structural_warnings` is non-empty, go to Step 5 for those topics (even if no other events were flagged earlier).

Present a summary to the user:
- Number of idea units extracted
- Topics touched (new and existing)
- Decisions captured
- Any restructuring performed
- Any structural warnings from finalization
