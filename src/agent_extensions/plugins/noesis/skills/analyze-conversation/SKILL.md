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

Verify the conversation is registered:

1. Call `get_raw_speaker_turns(conversation_id)` to confirm the conversation exists.
2. If it fails, stop and inform the user.
3. Detect the transcript language from the returned turns. Store as `{language}` and pass to all subagents. All topic titles, summaries, decisions, and cross-reference descriptions must be written in English, regardless of transcript language. Idea unit `text` fields must preserve the original language verbatim (traceability).

### Step 1: Sequential Batch Analysis

Extract idea units from all turns using sequential subagents with rolling context.

**Preparation:**
1. Call `get_topic_nodes()` to get root-level topics.
2. If topics exist: for each root topic with children, call `get_topic_nodes(parent_id)` to get one level of children. Store this two-level topic context as `{topic_context}` (titles + summaries only).
3. If no topics exist (first conversation): set `{topic_context}` to `{"empty": true, "note": "First conversation — no existing topics. Create general preliminary topics suitable as root-level categories."}`.

**Batch loop:**

Set `last_turn_order` = null, `active_state` = `{}`, `max_tokens` = 10000.

Repeat:
1. Launch a **batch_analyzer** subagent with:
   ```
   conversation_id: {conversation_id}
   last_turn_order: {last_turn_order}
   max_tokens: {max_tokens}
   active_state: {active_state}
   topic_context: {topic_context}
   language: {language}
   ```
2. Wait for the subagent to complete. Parse its JSON output.
3. If the subagent fails or returns malformed JSON, retry once with the same parameters. If it fails again, log the error, skip this batch, and continue with `last_turn_order` advanced by estimating the next natural boundary (set `max_tokens` to 3000 for the skip-ahead call to minimize loss).
4. Collect the `idea_units` and `preliminary_topics` arrays.
5. Filter out idea units where all categories are `NotRelevant` — do not carry them forward for storage.
6. Update `active_state` from the subagent's output.
7. Set `last_turn_order` to the last primary turn order processed.
8. If the subagent reports `has_more: false`, stop the loop.

After all batches complete, aggregate all `idea_units` and `preliminary_topics`.

### Step 2: Topic Reconciliation

Match preliminary topics against the global topic tree and store all idea units.

**Deduplicate** preliminary topics across batches (same subject, different wording).

**First-conversation fast path:** If no existing topics were found in Step 1 Preparation, skip the hierarchical traversal. Instead, organize the deduplicated preliminary topics into a logical hierarchy (roots and subtopics) and create them all in a single batch via `create_topics`. This avoids N redundant `get_topic_nodes()` calls against an empty tree.

**Hierarchical matching (when existing topics exist):**

For each unique preliminary topic (or batch of related topics):

1. Start at root level: call `get_topic_nodes()`.
2. Evaluate: does this topic match an existing root, belong under one, or is it a new root?
3. If it belongs under an existing node, call `get_topic_nodes(parent_id)` to see children.
4. Continue narrowing until you reach:
   - **Continuation**: matches existing topic — reuse its `topic_id`.
   - **New subtopic**: refines an existing topic — call `create_topics` as a child.
   - **New sibling**: peer of existing topics — call `create_topics` at that level.
   - **New root**: no match — call `create_topics` without parent.

**Store idea units:**
1. Resolve final `topic_id` for each idea unit based on the reconciled topics.
2. Call `store_idea_units(conversation_id, idea_units)` with final assignments.

**Verify assignments:**
1. Launch a **topic_reviewer** subagent with the list of topic IDs that received idea units.
2. If the reviewer flags mismatches, fix them by reassigning or creating new topics.
3. Note any **structural events**: new subtopics created, or topics with many children (>7).

### Step 3: Decision Extraction

Extract ADR-style decisions from topics that have Decision/Position/Argument idea units.

1. Identify topic IDs that received idea units with categories `Decision`, `Position`, or `Argument`.
2. For each topic (or group of related topics), launch a **decision_writer** subagent with:
   ```
   topic_ids: [list of topic IDs]
   conversation_id: {conversation_id}
   ```
3. Run up to 5 subagents in parallel.
4. Wait for all to complete.

### Step 4: Summaries and Cross-References

1. **Topic summaries**: For each topic that received new idea units:
   - Call `get_topic_idea_units(topic_id)` to get all idea units (across all conversations).
   - Generate a cumulative summary.
   - Determine if the summary has fundamentally shifted from the previous one (if any).
   - Collect summaries as `[{topic_id, summary}]`.

2. **Cross-references**: Review the topics touched by this conversation and their summaries (generated above). For topics where the relationship is not obvious from summaries alone, call `get_topic_idea_units(topic_id)` to understand the content before creating references. Identify relationships:
   - Types: `depends_on`, `contradicts`, `refines`, `supersedes`, `related_to`.
   - Only create cross-references where the conversation explicitly discusses the relationship between two topics (e.g., "module A depends on module B"). Do not infer relationships from co-occurrence alone.
   - Call `create_cross_references(refs)`.

3. **Conversation summary**: Generate an overall summary of the conversation.

4. Call `set_summaries(topic_summaries, conversation_summary)`.

5. Note any topics with `significant_shift_detected: true` as **semantic events**.

### Step 5: Micro-Restructuring (Conditional)

**Skip if no structural or semantic events were flagged in Steps 2 and 4.**

For each flagged node:
1. Call `get_topic_nodes(parent_id)` to load the node's siblings.
2. Evaluate whether the node should be split, reparented, or merged with a sibling.
3. If changes are needed, present the proposal to the user with `AskUserQuestion`.
4. If approved, execute via `merge_topics`, `reparent_topic`, or `reorder_topic`.

### Step 6: Finalize

Call `finalize_conversation(conversation_id)`.

Present a summary to the user:
- Number of idea units extracted
- Topics touched (new and existing)
- Decisions captured
- Any restructuring performed
