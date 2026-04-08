# Conversation Analysis: Knowledge Graph Builder

## 1. Goal

Build a knowledge graph that grows incrementally across many conversations. Each new conversation extends, refines, or restructures a single global topic tree. Decisions, arguments, and cross-references accumulate over time. The system must handle: new topics, continuations of existing topics, new subtopics under existing topics, and structural changes to the topic tree.

## 2. Data Model

### 2.1 Graph Schema

The data model is native to graph database (FalkorDB). Entities are nodes, relationships are edges. No join tables or foreign keys — relationships are first-class citizens.

**Raw layer** (already implemented):

```
(RawConversation) -[HAS_RAW_TURN {order}]-> (RawSpeakerTurn)
```

**Analysis layer** (built on top of raw layer):

```
(RawSpeakerTurn) -[CONTAINS {sequence}]-> (IdeaUnit) -[BELONGS_TO]-> (Topic)

(Topic) -[SUBTOPIC_OF {sort_order}]-> (Topic)
(Topic) -[CROSS_REF {type, description, source_conversation_id}]-> (Topic)

(Decision) -[ABOUT]-> (Topic)
(Decision) -[MADE_IN]-> (RawConversation)
(Decision) -[SUPERSEDES]-> (Decision)
(Decision) -[SUPPORTED_BY]-> (IdeaUnit)
(Decision) -[OPPOSED_BY]-> (IdeaUnit)
```

### 2.2 Node Definitions

#### IdeaUnit

Atomic semantic unit extracted from a speaker turn. One turn may produce multiple idea units, each potentially about a different topic. An idea unit references concrete sentences within the turn's `sentences` array by index, providing stable anchoring without fragile character offsets.

```
idea_unit_id        TEXT (UUID)
sequence_in_turn    INTEGER
text                TEXT
sentence_indices    INTEGER[]  -- indices into the turn's sentences array (0-based)
categories          TEXT[]     -- one or more of: Information | Position | Argument | Decision | NotRelevant
token_count         INTEGER
```

An idea unit carries one or more categories. The common case is a single category, but a statement that simultaneously takes a position and provides supporting argument (e.g. "We should use Postgres because it handles JSONB natively") is classified as `["Position", "Argument"]` rather than forcing a lossy choice.

`NotRelevant` category replaces a separate relevance screening step. Small talk, filler, and off-topic remarks are classified here during idea unit segmentation — no need for an extra LLM pass over the full transcript.

#### Topic

A subject that exists across conversations. Identified by stable UUID, never by position in the tree.

```
topic_id            TEXT (UUID)
title               TEXT
summary             TEXT (nullable)
sort_order          INTEGER  -- ordering among siblings
```

Depth, children count, and token aggregates are computed by graph traversal on demand.

#### Decision

Follows an ADR-like (Architecture Decision Record) structure to capture not just what was decided, but why, and what was rejected.

```
decision_id         TEXT (UUID)
title               TEXT
context             TEXT     -- situation or problem that prompted this decision
decision            TEXT     -- what was decided
rationale           TEXT     -- why this option was chosen
consequences        TEXT     -- expected impact, trade-offs, risks
alternatives        TEXT     -- JSON array of {option: TEXT, rationale_against: TEXT}
status              TEXT     -- taken | proposed
```

### 2.3 Traceability

Full traceability chain from any high-level entity back to raw transcript:

```
Topic  <-[BELONGS_TO]-  IdeaUnit  (text, sentence_indices)
                            |
                       -[CONTAINS]-  (in)
                            |
                       RawSpeakerTurn  (speaker, time, sentences)
                            |
                       -[HAS_RAW_TURN]-  (in)
                            |
                       RawConversation  (title, date)
```

Decisions trace through `SUPPORTED_BY` / `OPPOSED_BY` edges to IdeaUnits, then follow the same chain to raw turns.

Cross-references between topics carry `source_conversation_id` to track which conversation revealed the relationship.

## 3. Workflow

### 3.1 Preconditions

- Raw transcript has been registered (`register_conversation` completed successfully with all metadata).

### 3.2 Pipeline Overview

```
Step 1: Sequential Batch Analysis ............... Subagents (LLM, sequential)
  |        - Segment turns into idea units
  |        - Classify each idea unit (incl. relevance)
  |        - Assign preliminary topic per idea unit
  |        - Carry rolling Active_State across batches
  v
Step 2: Topic Reconciliation .................... Main agent (LLM, tool-calling)
  |        - Navigate global tree top-down via get_topic_nodes()
  |        - Match / create / nest topics progressively
  |        - Store idea units with final topic assignments
  |        - Flag structural events for Step 5
  v
Step 3: Decision Extraction ..................... Subagent (LLM, tool-calling)
  |        - Extract ADR-like decisions
  |        - Link to existing decision chains
  v
Step 4: Summaries & Cross-References ............ Main agent (LLM)
  |        - Generate / update topic summaries
  |        - Detect semantic shift in updated summaries
  |        - Detect cross-references between topics
  |        - Generate conversation summary
  v
Step 5: Micro-Restructuring ..................... Main agent (LLM, conditional)
  |        - Runs only if structural/semantic events flagged
  |        - Evaluate flagged node neighborhoods only
  |        - Propose localized changes (requires user approval)
  v
Step 6: Finalize ................................ MCP (deterministic)
```

### Step 1: Sequential Batch Analysis

**Actor**: Main agent orchestrating subagents (LLM, sequential)

**Purpose**: Perform all per-turn analysis with narrative continuity across batches, avoiding the "split-brain" problem of isolated parallel processing.

**Processing flow**:
1. Process batches sequentially: Batch 1 → Batch 2 → ... → Batch N.
2. Each batch produces a rolling `Active_State` that carries forward to the next batch, maintaining narrative context.
3. Individual batches are delegated to subagents. The main agent passes the prior batch's `Active_State` and a `max_tokens` limit to each subsequent subagent.

**Input per batch** (provided as prompt context by main agent):

- `conversation_id` and `last_turn_order` (null for first batch) — the subagent calls `get_next_turn_batch(conversation_id, last_turn_order, max_tokens, lookahead_turns)` to retrieve its batch text from the MCP server. The main agent never sees raw transcript text.
- `max_tokens` — the main agent decides the token budget for each batch. This can vary across batches: the main agent may increase the limit if a subagent's output quality suggests turns are being cut too aggressively, or decrease it for sparse sections.
- `Active_State` from the previous batch (empty for the first batch)
- Two levels of topic nodes from `get_topic_nodes()` — root topics and their direct children, with summaries. This provides enough context for preliminary topic matching without loading the full tree.

**Output per batch** (structured JSON):

```json
{
  "idea_units": [
    {
      "turn_order": 5,
      "sequence_in_turn": 1,
      "text": "exact text from the turn",
      "sentence_indices": [0, 1],
      "categories": ["Position"],
      "preliminary_topic": "API versioning strategy",
      "parent_topic_hint": "existing:topic-uuid-123"
    }
  ],
  "preliminary_topics": [
    {
      "title": "API versioning strategy",
      "parent": "existing:topic-uuid-123",
      "summary_hint": "Discussion about backward compatibility approach"
    }
  ],
  "active_state": {
    "open_threads": ["API versioning strategy"],
    "pending_positions": [],
    "narrative_context": "Team is evaluating backward compatibility approaches for the public API."
  }
}
```

**Prompt instruction for lookahead**: "Extract IdeaUnits only for primary turns (turns 1–30). Use lookahead turns (turns 31–40) only as context to understand the immediate resolution of current thoughts. Do not extract IdeaUnits from lookahead turns."

**Why sequential batching**:

- Main agent receives only structured JSON results (~2-5 KB per batch), never raw transcript text.
- Rolling `Active_State` preserves narrative arcs across batch boundaries — no "split-brain" from isolated parallel chunks.
- Lookahead window prevents premature extraction of positions that are immediately overturned.
- Semantic grouping by speaker turns avoids splitting cohesive arguments at arbitrary token boundaries.

**Design decisions**:
- **No separate relevance step**: The `NotRelevant` category handles relevance during idea unit classification. This eliminates a full extra LLM pass over the transcript that would need to load all turns just to filter them.
- **Topics within turns**: A single speaker turn where the speaker discusses two subjects produces separate idea units assigned to different preliminary topics. Topic boundaries align with idea unit boundaries, not turn boundaries.
- **No overlap deduplication needed**: Sequential processing with lookahead eliminates the need for overlapping turns between batches. Each turn is extracted exactly once from its primary batch.

### Step 2: Topic Reconciliation

**Actor**: Main agent (LLM reasoning via tool-calling)

**Purpose**: Merge preliminary topics from all batches into a coherent set, match against the global topic tree using progressive hierarchical traversal, and store everything in the graph.

**Input**:
- Aggregated batch results (preliminary topics + idea units from all batches)

**Actions**:

1. **Deduplicate** preliminary topics across batches (same subject found independently in different batches).
2. **Match** against existing global topics using **Progressive Hierarchical Traversal**:

   Instead of loading the entire topic tree, the main agent navigates the graph top-down using `get_topic_nodes(parent_id?)`, like navigating a nested folder structure:

   a. Fetch root-level nodes via `get_topic_nodes()` (returns only titles and summaries of root topics).
   b. For each preliminary topic (or batched group of related preliminary topics):
      - Evaluate: *"Does this topic belong under one of these nodes, or is it a new root?"*
      - If it belongs under an existing node (e.g. "Backend"), call `get_topic_nodes('backend-uuid')` to fetch its direct children.
      - Repeat this narrowing process until reaching a leaf match, creating a new sibling at the current depth, or creating a new child under the current node.
   c. Possible outcomes at each level:
      - **Continuation**: Preliminary topic matches an existing node → reuse `topic_id`.
      - **New subtopic**: Preliminary topic refines an existing node → create as child via `create_topics()`.
      - **New sibling**: Preliminary topic is a peer of existing nodes → create via `create_topics()`.
      - **New root**: No match at root level → create as new root topic.

3. **Resolve** final topic assignments for all idea units.
4. **Store** idea units with final topic IDs via `store_idea_units()`.
5. **Flag structural events**: When creating a new subtopic under an existing node, or when a node's children count exceeds a configurable threshold, flag a structural event for Step 5 (micro-restructuring).
6. **Verify** assignments via a dedicated **reviewer subagent**: the subagent spot-checks that idea units are correctly mapped (e.g. a topic about "Authentication" doesn't contain idea units about "Database backups"). The reviewer retrieves topic idea units via `get_topic_idea_units()` and flags mismatches. The main agent fixes flagged mismatches by reassigning or creating new topics.

**Why hierarchical traversal**:
- **Scales indefinitely**: Context window usage remains flat — only O(branching_factor) nodes are loaded at any step, regardless of total tree size.
- **High precision**: The LLM's attention is focused on a small set of choices at each step, reducing hallucination and duplicate topic creation.
- **No vector DB required**: Stays within the graph/LLM paradigm without embedding models or similarity indices.

**Trade-off**: Reconciling a topic deep in the tree requires multiple sequential tool calls (O(log N) for a balanced tree). Tree balance is important for efficiency — a flat list under a single root degrades to linear traversal.

**Edge case**: If the topic tree is empty (first conversation), all topics are new. Step reduces to deduplication and hierarchy creation.

### Step 3: Decision Extraction

**Actor**: Dedicated "decision writer" subagent (LLM, tool-calling)

The main agent delegates decision extraction to a specialized subagent per topic (or group of related topics). The subagent retrieves its own input data via MCP tools — the main agent passes only the list of topic IDs that received relevant idea units, not the data itself. This keeps the main agent's context clean and allows decision extraction to run in parallel across independent topics.

**Subagent input** (from main agent via prompt):
- List of `topic_id`s to process
- `conversation_id`

**Subagent retrieves via MCP**:
- Idea units with categories `Decision`, `Position`, `Argument` via `get_topic_idea_units(topic_id, categories)`
- Existing decisions for touched topics via `get_decisions(topic_id)`

**Actions**:
1. For each topic with relevant idea units in this conversation:
   a. Fetch existing decisions for context.
   b. Trace the discussion arc within this conversation: identify proposals, counter-proposals, and final outcomes.
   c. Create `Decision` nodes only for **final decisions** — the position that the conversation concluded with. Proposals that were raised and then reverted or rejected within the same conversation are not separate Decision nodes; they become entries in the `alternatives` array with rationale for rejection.
   d. Each Decision node uses ADR structure:
      - **Context**: What situation or problem prompted this decision
      - **Decision**: What was decided (the final outcome)
      - **Rationale**: Why this option was chosen
      - **Consequences**: Expected impact, trade-offs, risks
      - **Alternatives**: Other options considered (including those proposed and reverted during the conversation), each with rationale for rejection
   e. Link to supporting/opposing idea units via `SUPPORTED_BY` / `OPPOSED_BY` edges.
   f. If the final decision in this conversation supersedes a decision from a **prior** conversation, create a `SUPERSEDES` edge to the prior Decision node. Cross-conversation supersession produces new immutable Decision records in the chain. Intra-conversation reversals do not.

### Step 4: Summaries & Cross-References

**Actor**: Main agent (LLM reasoning)

**Actions**:
1. **Topic summaries**: For each topic that received new idea units, regenerate summary from all linked idea units across all conversations. Summaries reflect cumulative state, not just the latest conversation. The LLM compares the new summary against the old summary and flags whether the core meaning has fundamentally shifted:
   ```json
   {"topic_id": "...", "summary": "...", "significant_shift_detected": true}
   ```
   The `significant_shift_detected` flag relies on the LLM's semantic reasoning — not brittle embedding distances — to detect when a topic's meaning has morphed beyond its original scope. Flagged topics trigger localized restructuring in Step 5.
2. **Cross-references**: Detect relationships between topics touched by this conversation. Relationship types: `depends_on`, `contradicts`, `refines`, `supersedes`, `related_to`. Create `CROSS_REF` edges.
3. **Conversation summary**: Generate overall summary for the conversation.

### Step 5: Micro-Restructuring

**Actor**: Main agent (LLM reasoning)

**Purpose**: Correct structural and semantic drift immediately while the conversation context is fresh. Instead of evaluating the entire global tree after every conversation, restructuring is strictly localized to the "neighborhood" of nodes that experienced significant events during the current processing run.

**Triggers** (from Steps 2 and 4):
- **Structural event** (Step 2): A new subtopic was created under an existing node, or a node's children count exceeds a configurable threshold.
- **Semantic shift event** (Step 4): The LLM flagged `significant_shift_detected: true` when regenerating a topic summary.

**Execution**:
1. **Skip if no flags**: If no structural or semantic events were flagged, this step is skipped entirely.
2. **Load neighborhood only**: For each flagged node, load only the flagged node, its immediate parent, and its direct siblings via `get_topic_nodes()`. The main agent never sees the global tree.
3. **Evaluate**: Determine if the flagged node needs to be:
   - **Split**: A subtopic has grown large enough to be promoted to a sibling of its parent.
   - **Reparented**: The node's meaning has shifted and it belongs under a different parent.
   - **Merged**: Two siblings are now clearly about the same subject.
4. **Propose**: Generate a targeted restructuring proposal covering only the affected neighborhood. **Requires user approval** before execution.
5. **Execute** (if approved) via `merge_topics()`, `reparent_topic()`, `reorder_topic()`. All operations are atomic.

**Why localized restructuring**:
- **Real-time accuracy**: Drift is corrected while the conversation context that caused it is still fresh.
- **No tree jitter**: Evaluation is confined to flagged sub-trees — the LLM cannot needlessly shuffle unrelated parts of the hierarchy.
- **Small blast radius**: Each restructuring affects only a few nodes, making user review fast and intuitive.
- **Efficient**: Skipped entirely when no events are flagged (the common case). When triggered, loads only O(branching_factor) nodes.

### Step 6: Finalize

**Actor**: MCP server (deterministic)

**Actions**:
1. Recompute token counts for all affected topics.
2. Update conversation status to `complete`.

## 4. MCP Server Tools

Only tools required by the workflow above. Organized by phase.

### 4.1 Conversation Management (existing)

```
register_conversation(file_path, title?, date?) -> {conversation_id, status, missing}
set_conversation_metadata(conversation_id, title?, date?) -> {status}
get_raw_speaker_turns(conversation_id, speakers?, from_time?, to_time?) -> {turns}
```

### 4.2 Turn Batching

```
get_next_turn_batch(conversation_id, last_turn_order?, max_tokens, lookahead_turns?) -> {primary_turns: [{order, speaker, time, text}], lookahead_turns: [{order, speaker, time, text}], has_more}
```

Returns the next batch of consecutive turns starting after `last_turn_order` (or from the beginning if null). The server groups turns into a batch that fits within `max_tokens`, preferring natural conversational boundaries (speaker exchanges, pauses) for batch splits. Each batch includes primary turns (for idea unit extraction) and lookahead turns (read-only context to resolve the "Punchline Problem", typically 5–10 turns). The `has_more` flag indicates whether additional turns remain. Batch grouping is deterministic server logic.

The calling agent (subagent) invokes this tool directly — the main agent never sees raw transcript text. The main agent controls batch size indirectly by setting the `max_tokens` budget passed to the subagent.

### 4.3 Analysis Storage

```
store_idea_units(conversation_id, idea_units: [{turn_order, sequence_in_turn, text, sentence_indices, categories, topic_id, token_count}]) -> {count}

create_topics(topics: [{title, parent_topic_id?, sort_order}]) -> [{topic_id, title}]

store_decisions(decisions: [{title, context, decision, rationale, consequences, alternatives, status, topic_id, conversation_id, supporting_idea_unit_ids, opposing_idea_unit_ids, supersedes_decision_id?}]) -> [{decision_id}]

create_cross_references(refs: [{from_topic_id, to_topic_id, type, description, source_conversation_id}]) -> {count}

set_summaries(topic_summaries: [{topic_id, summary, significant_shift_detected}], conversation_summary?: {conversation_id, summary})
```

### 4.4 Context Retrieval (for analysis steps)

```
get_topic_nodes(parent_id?) -> [{topic_id, title, summary, children_count, sort_order}]
```

Scoped topic tree navigation tool for Progressive Hierarchical Traversal. If `parent_id` is null/omitted, returns only root-level topics. Otherwise, returns direct children of the specified topic. Each result includes `children_count` so the agent knows whether to drill deeper. Context window usage remains O(branching_factor) regardless of total tree size.

```
get_topic_idea_units(topic_id, categories?) -> [{idea_unit_id, text, category, speaker, time, turn_order}]
```

Returns idea units for a topic, optionally filtered by category. Includes turn context (speaker, time) resolved through graph edges.

```
get_decisions(topic_id?) -> [{decision_id, title, context, decision, rationale, status, topic_title, conversation_title}]
```

Returns decisions, optionally filtered by topic.

### 4.5 Topic Restructuring

```
merge_topics(source_topic_id, target_topic_id) -> {moved_idea_units, moved_decisions, moved_cross_refs}
reparent_topic(topic_id, new_parent_topic_id, sort_order?)
reorder_topic(topic_id, new_sort_order)
```

All restructuring operations are atomic. `merge_topics` reassigns all edges from source to target, reparents children, and deletes the source node.

### 4.6 Retrieval (for consuming agents)

```
get_topic_tree(max_depth?) -> tree with summaries and computed structure codes
get_topic_detail(topic_id) -> {topic, idea_unit_counts_by_category, decisions, cross_references, conversations}
get_topic_history(topic_id) -> [{conversation_id, title, date, idea_unit_count}]
get_decision_chain(decision_id) -> ordered supersession chain
search(query) -> [{idea_unit_id, text, category, topic_title, speaker, time, conversation_title}]
get_conversation_summary(conversation_id) -> {metadata, summary, topics_touched}
```

### 4.7 Finalization

```
finalize_conversation(conversation_id)
```

Recomputes token counts for topics touched by this conversation. Sets conversation status to `complete`.

## 5. Requirements

### 5.1 Functional

**R1**: Each new conversation must be matched against the existing global topic tree. Matching must identify continuations, new topics, and new subtopics.

**R2**: The topic tree uses stable UUIDs. Structure codes are computed dynamically from `SUBTOPIC_OF` edges and `sort_order`, never stored.

**R3**: Topic restructuring (reparent, merge, reorder) must be supported with full referential integrity. Merge and reparent must be atomic.

**R4**: Decisions follow ADR format: context, decision with rationale, consequences, and alternatives with rationale for rejection. Decisions are immutable records — status changes produce new nodes linked via `SUPERSEDES` edges.

**R5**: Decisions must be trackable across conversations. A decision in conversation A can be superseded by a decision in conversation B.

**R6**: All deterministic logic (chunking, token counting, tree traversal, finalization) is implemented in the MCP server. The skill performs only LLM reasoning and orchestration.

**R7**: Retrieval tools must support querying across all conversations or scoped to a single conversation/topic.

**R8**: Topic summaries reflect cumulative state across all conversations, not just the latest one.

**R9**: Restructuring proposals require user approval before execution.

**R10**: Processing a new conversation must not require reprocessing prior conversations. Only summaries and token counts of affected topics are recomputed.

**R11**: Full traceability: every topic, decision, and cross-reference must be traceable (directly or through graph edges) to specific text spans in the raw transcript.

### 5.2 Non-Functional

**R12**: Transcripts up to 250 KB (~70K tokens) must be processable. Sequential batch processing with rolling state is the mechanism. Raw transcript text must never be loaded into the main agent context.

**R13**: `get_topic_nodes()` must return only direct children of the specified parent (or root-level nodes), keeping context usage at O(branching_factor) regardless of total tree size.

**R14**: Batch-level analysis must maintain narrative continuity via sequential processing with rolling `Active_State`.

## 6. Design Decisions

### D1: Subagent-driven batch retrieval with adaptive token budget

Batch analysis subagents retrieve their own batch text by calling `get_next_turn_batch()` directly. The main agent never sees raw transcript text — it controls batch size indirectly by setting the `max_tokens` budget passed to each subagent. This budget can vary across batches: if a subagent's output quality suggests turns are being cut too aggressively, the main agent increases the limit for the next batch. The MCP server fits as many turns as possible within the token budget while preferring natural conversational boundaries for batch splits.

### D2: Intra-conversation decision consolidation

Within a single conversation, only final decisions are persisted as `Decision` nodes. If a position is proposed and then reverted or overruled within the same conversation, it does not become a separate Decision node — it becomes an entry in the `alternatives` array of the final decision, with rationale for why it was rejected. This prevents the graph from accumulating noise from the natural back-and-forth of a conversation.

Cross-conversation supersession is different: if conversation B overturns a decision from conversation A, a new `Decision` node is created with a `SUPERSEDES` edge to the original. Both remain in the graph as immutable records.

### D3: Event-driven micro-restructuring replaces global evaluation

Step 5 runs only when structural events (Step 2) or semantic shift events (Step 4) are flagged during the current processing run. When triggered, it evaluates only the flagged node's neighborhood (the node, its parent, and its siblings) — never the global tree. This prevents "tree jitter" from recency bias, keeps context usage minimal, and corrects drift while the causing conversation is fresh. The trade-off is more complex local state management during reparent/split operations.

### D4: Progressive hierarchical traversal for topic matching

Step 2 navigates the global topic tree top-down via `get_topic_nodes(parent_id?)` rather than loading the entire tree via a bulk context tool. At each level, the LLM sees only O(branching_factor) nodes, keeping context usage flat regardless of tree size. This eliminates the "Context Wall" problem where a growing topic tree would eventually overwhelm the LLM's context window, causing hallucinated placements or duplicate topic creation. The trade-off is O(log N) sequential tool calls per topic for a balanced tree.

### D5: Sequential batching with lookahead preserves narrative arcs

Step 1 processes batches sequentially with a rolling `Active_State`, rather than in parallel isolated chunks. This eliminates the "split-brain" problem where parallel subagents miss narrative arcs spanning chunk boundaries. A read-only lookahead window (typically 5–10 turns) appended to each batch prevents the "Punchline Problem" — premature extraction of positions that are immediately overturned. The trade-off is loss of full parallelism: batches must be processed in sequence, increasing wall-clock time compared to parallel chunking.

### D6: Handling discussions that span batch boundaries

Step 1 subagents classify idea units (including category `Decision`) but do not extract full ADR-structured decisions. After Step 2 stores all idea units with topic assignments, Step 3's decision writer subagents retrieve the complete set of `Decision`/`Position`/`Argument` idea units per topic from the graph — regardless of how they were split across batches. Decision synthesis is the subagent's responsibility, working from the complete, topic-grouped set.

Sequential batching with `Active_State` largely mitigates boundary issues: the narrative context carries forward, and the lookahead window provides immediate resolution. By the time decisions are extracted, the graph contains all idea units from all batches, and the topic-grouped query assembles the full discussion thread.
