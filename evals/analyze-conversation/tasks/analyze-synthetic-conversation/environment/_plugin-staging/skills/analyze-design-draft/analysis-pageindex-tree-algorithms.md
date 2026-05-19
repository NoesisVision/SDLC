# PageIndex Tree Algorithms: Analysis and Application to Corporate Conversation Structuring

## Part 1: How PageIndex Builds and Searches Its Tree

### 1.1 Overview

PageIndex is a **vectorless RAG** (Retrieval-Augmented Generation) system. Instead of embedding documents into vectors and doing similarity search, it builds a **hierarchical tree index** (like a table of contents) over documents, then lets an LLM agent **reason over the tree structure** to find relevant content.

The core insight: humans don't search documents by computing cosine similarity between embedding vectors -- they scan a table of contents, identify promising sections, and drill down. PageIndex replicates this behavior.

### 1.2 Tree Construction Algorithm

The tree is built in a multi-phase pipeline. Each phase uses LLM calls rather than heuristic rules, making the system robust to varied document formats.

#### Phase 1: PDF Parsing

**Code**: `utils.py:387-410` (`get_page_tokens()`)

The document is parsed page-by-page using PyPDF2 or PyMuPDF. Each page produces a `(text, token_count)` tuple. Token counts are computed via LiteLLM's token counter, which matters for respecting LLM context limits in later phases.

#### Phase 2: Table of Contents Detection

**Code**: `page_index.py:696-732` (`check_toc()`) and `page_index.py:341-366` (`find_toc_pages()`)

The system scans the first N pages (default: 20) looking for a table of contents:

```
for each page in first 20 pages:
    ask LLM: "Does this page contain a table of contents?"
    if yes: mark as TOC page, continue scanning
    if no and previous page was TOC: stop (TOC region ended)
```

This is a **sequential boundary detection** algorithm -- it finds where the TOC starts and stops by detecting transitions. The LLM prompt explicitly excludes false positives like abstracts, notation lists, or figure lists.

If found, the system also checks whether the TOC contains page numbers (e.g., "Chapter 3 ... 42") or just section titles.

#### Phase 3: Structure Extraction (Three Modes)

The system selects one of three processing modes based on TOC availability, with automatic **fallback** between them:

**Mode A: TOC with page numbers** (`page_index.py:622-651`)

```
1. Transform raw TOC text into structured JSON via LLM
   (Each entry gets: structure code "1.2.3", title, page number)
2. Extract physical page indices from first few content pages
3. Calculate offset = physical_index - page_number (most common difference)
4. Apply offset to map all TOC page numbers to actual PDF pages
```

The **offset calculation** (`page_index.py:394-414`) is a clever voting algorithm: it computes `physical_index - page_number` for each verified pair and takes the **mode** (most frequent value). This handles the common case where PDF page numbering doesn't match document page numbering (e.g., front matter pages, different numbering schemes).

**Mode B: TOC without page numbers** (`page_index.py:597-618`)

```
1. Transform raw TOC text into structured JSON via LLM
2. Group document pages into overlapping chunks (by token limit)
3. For each chunk, ask LLM to locate where each section starts
4. Map section titles to physical page indices
```

**Mode C: No TOC** (`page_index.py:576-595`)

```
1. Group pages into overlapping chunks
2. For first chunk: ask LLM to generate hierarchical structure from scratch
3. For subsequent chunks: ask LLM to continue the structure
4. Merge all generated structures
```

This is the most computationally expensive mode -- the LLM must **infer** document structure by reading the actual content.

**Automatic fallback**: If Mode A achieves < 60% accuracy during verification, it falls back to Mode B. If Mode B fails, it falls back to Mode C. This cascade is implemented in `meta_processor()` at `page_index.py:959-997`.

#### Phase 4: Page Grouping

**Code**: `page_index.py:426-459` (`page_list_to_group_text()`)

When document pages need to be fed to the LLM in chunks, the grouping algorithm works as follows:

```
expected_parts = ceil(total_tokens / max_tokens)
avg_target = ceil((total_tokens / expected_parts + max_tokens) / 2)

for each page:
    if adding this page exceeds avg_target:
        save current group
        start new group with overlap_page=1 pages of overlap
    add page to current group
```

The **overlap** (default: 1 page) prevents losing context at group boundaries. The target size is the **average of the even split and the maximum**, which produces balanced groups rather than one full group and one tiny remainder.

#### Phase 5: Verification and Self-Correction

**Code**: `page_index.py:900-952` (`verify_toc()`) and `page_index.py:878-894` (`fix_incorrect_toc_with_retries()`)

After building the initial structure, the system **verifies** it:

```
for each TOC item (or a random sample of N items):
    ask LLM: "Does section [title] appear on page [physical_index]?"
    (with fuzzy matching for whitespace differences)

accuracy = correct_count / total_checked
```

If accuracy < 100% but > 60%, the system attempts to **fix** incorrect entries:

```
for each incorrect item:
    find nearest correct neighbor pages (before and after)
    search within that narrowed page range
    ask LLM: "Where does [section title] start in these pages?"
    verify the fix

retry up to 3 times
```

This is a **narrowing search with verification** -- each fix attempt works within progressively tighter bounds established by neighboring correct entries.

#### Phase 6: Flat List to Tree Conversion

**Code**: `utils.py:324-370` (`list_to_tree()`)

The flat list of `{structure: "1.2.3", title: "...", physical_index: N}` entries is converted to a nested tree using the **structure code as a hierarchy key**:

```
for each item:
    parent_code = item.structure minus last segment
    (e.g., "1.2.3" -> parent is "1.2")

    if parent exists in nodes dict:
        add as child of parent
    else:
        add as root node
```

The `post_processing()` function (`utils.py:433-452`) also computes `start_index` and `end_index` for each node. The end_index logic is nuanced:

- If the **next** section starts at the beginning of its page (`appear_start == "yes"`), the current section's end_index is `next.physical_index - 1`
- Otherwise, end_index is `next.physical_index` (the page is shared between sections)

#### Phase 7: Recursive Large Node Splitting

**Code**: `page_index.py:1000-1027` (`process_large_node_recursively()`)

After the tree is built, any node exceeding thresholds is recursively subdivided:

```
if node spans > max_page_num_each_node pages AND >= max_token_num_each_node tokens:
    extract the page subset for this node
    generate sub-structure using Mode C (no TOC)
    attach as children
    recursively check all children
```

This ensures no leaf node is too large for effective retrieval. The recursion naturally creates deeper hierarchies for dense document sections.

#### Phase 8: Enrichment

**Code**: `utils.py:578-596` (`generate_summaries_for_structure()`)

Finally, the tree is enriched with:
- **Node IDs**: 4-digit zero-padded identifiers assigned in depth-first order
- **Summaries**: LLM-generated descriptions for each node (generated concurrently via `asyncio.gather`)
- **Document description** (optional): A one-sentence description of the entire document

### 1.3 Tree Search Algorithm

The search algorithm is fundamentally different from traditional RAG. Instead of vector similarity, it uses **agentic LLM reasoning** over the tree structure.

#### The Three Retrieval Tools

**Code**: `retrieve.py:81-137`

The system exposes three tool functions to the agent:

1. **`get_document(doc_id)`** -- Returns metadata: name, description, type, status, page/line count
2. **`get_document_structure(doc_id)`** -- Returns the full tree hierarchy **without text fields** (summaries, titles, page ranges, node IDs only)
3. **`get_page_content(doc_id, pages)`** -- Returns actual text for specific page ranges (e.g., "5-7", "3,8", "12")

The critical design choice: `get_document_structure()` **strips text content** but keeps summaries. This gives the agent a compact "map" of the document that fits in its context window.

#### Agent Reasoning Flow

**Code**: `examples/agentic_vectorless_rag_demo.py:44-52`

The agent receives this system prompt:

```
- Call get_document() first to confirm status and page/line count.
- Call get_document_structure() to identify relevant page ranges.
- Call get_page_content(pages="5-7") with tight ranges; never fetch the whole document.
- Before each tool call, output one short sentence explaining the reason.
- Answer based only on tool output. Be concise.
```

A typical query flow:

```
User: "What does the paper say about attention residuals?"

Agent thinks: "I need to check the document status first."
-> calls get_document("doc_001")
   returns: {name: "attention-residuals.pdf", pages: 42, status: "completed"}

Agent thinks: "Let me find relevant sections in the structure."
-> calls get_document_structure("doc_001")
   returns: tree with summaries like:
     - "Introduction" (pages 1-3): "Overview of attention mechanisms..."
     - "Attention Residuals" (pages 12-18): "Novel technique for..."
       - "Theoretical Foundation" (pages 12-14): "Mathematical basis..."
       - "Experimental Results" (pages 15-18): "Benchmarks showing..."
     - "Conclusion" (pages 38-42): "Summary of contributions..."

Agent thinks: "Section 'Attention Residuals' on pages 12-18 is relevant."
-> calls get_page_content("doc_001", "12-18")
   returns: actual text of pages 12-18

Agent: "Based on the document, attention residuals are..."
```

This is **reasoning-based retrieval**: the LLM navigates the tree using its understanding of the query and the section summaries, then fetches only the pages it needs. No embedding, no similarity threshold, no chunk boundary problems.

#### Key Properties of This Search Approach

1. **Token-efficient**: The agent sees the full structure (~hundreds of tokens) instead of the full document (~tens of thousands of tokens). It only loads specific pages when needed.

2. **Context-aware**: The agent understands section relationships. If a question spans multiple topics, it can fetch from multiple non-contiguous sections.

3. **Explainable**: The agent explains why it chose each section, making retrieval decisions transparent.

4. **Iterative**: The agent can make multiple tool calls -- fetch a section, realize it needs more context, fetch adjacent pages.

### 1.4 Markdown Document Processing

**Code**: `page_index_md.py:243-300` (`md_to_tree()`)

For Markdown documents, the pipeline is simpler because the structure is already explicit in headers:

```
1. Extract headers via regex: ^(#{1,6})\s+(.+)$
   (skipping headers inside code blocks)
2. Assign text between headers to each node
3. Build tree from header levels (# = level 1, ## = level 2, etc.)
4. Optional: "thin" the tree by merging small nodes (< 5000 tokens) into parents
5. Generate summaries
```

The `tree_thinning_for_index()` function (`page_index_md.py:135-187`) prevents tree explosion from documents with many tiny sections. It computes token counts for each node including all children, and merges nodes below the threshold into their parents.

### 1.5 Configuration Parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `model` | gpt-4o-2024-11-20 | LLM for indexing |
| `retrieve_model` | gpt-5.4 | LLM for query agent |
| `toc_check_page_num` | 20 | Pages to scan for TOC |
| `max_page_num_each_node` | 10 | Triggers recursive splitting |
| `max_token_num_each_node` | 20000 | Triggers recursive splitting |
| `if_add_node_summary` | yes | Generate per-node summaries |
| `if_add_doc_description` | no | Generate document-level description |
| `if_add_node_text` | no | Store raw text in tree (increases size) |

---

## Part 2: Applying Tree-Based Structuring to Messy Corporate Conversations

### 2.1 The Problem

Corporate conversations about software design and requirements are chaotic by nature:

- **Multiple speakers** with different roles, knowledge levels, and agendas
- **Topic shifts** -- jumping between authentication, database schema, and deployment in the same thread
- **Arguments and reversals** -- "We decided on PostgreSQL" followed later by "Actually, let's use MongoDB"
- **Off-topic content** -- jokes, scheduling, unrelated complaints
- **Implicit decisions** -- conclusions reached without explicit "we decided" markers
- **Distributed context** -- one person says "like we discussed last week" without repeating what was discussed
- **Ambiguity** -- the same term used differently by different speakers

This is fundamentally different from documents PageIndex was designed for. Documents have an author-intended structure; conversations have emergent, non-linear structure. But the **core technique** -- LLM-driven hierarchical structuring followed by agentic retrieval -- can be adapted.

### 2.2 What We Can Borrow Directly from PageIndex

#### 2.2.1 LLM-Driven Structure Generation (Mode C)

PageIndex's "No TOC" mode is the most relevant. It asks an LLM to **infer** hierarchical structure from raw text. For conversations, this would mean:

```
Input: Raw conversation transcript
Output: Tree structure like:
  1. Authentication System
    1.1 OAuth vs. Session-based (Debate)
    1.2 Decision: OAuth 2.0 with PKCE
    1.3 Token Refresh Strategy
  2. Database Design
    2.1 Initial Proposal: PostgreSQL
    2.2 Counterargument: MongoDB for flexibility
    2.3 Reversal: Back to PostgreSQL with JSONB columns
  3. Deployment Strategy
    ...
```

The key adaptation: conversations don't have "pages" with fixed boundaries. Instead, we need to define **segmentation units** -- individual messages, time-windowed blocks, or speaker turns.

#### 2.2.2 Overlapping Chunk Strategy

PageIndex's page grouping with overlap (`page_list_to_group_text()`) translates directly. When feeding conversation segments to the LLM for structure extraction:

- Group messages into chunks that fit the LLM context window
- Overlap by a few messages at boundaries
- This prevents losing context when a topic bridges two chunks

#### 2.2.3 Incremental Structure Building

PageIndex builds structure incrementally: `generate_toc_init()` for the first chunk, then `generate_toc_continue()` for subsequent chunks. This is essential for long conversations (weeks/months of Slack threads):

```
Chunk 1 -> Initial structure
Chunk 2 -> "Continue from the previous structure, incorporating new topics"
Chunk 3 -> "Continue, noting that topic 2.1 was revisited"
...
```

#### 2.2.4 Verification Loop

The verify-and-fix cycle is directly applicable. After generating a conversation structure:

```
for each node in structure:
    ask LLM: "Does message range [X-Y] actually discuss [topic title]?"
    if no: search neighboring messages for the real location
```

#### 2.2.5 Agentic Retrieval

The three-tool retrieval pattern works naturally:

- `get_conversation_metadata()` -- participants, date range, channels
- `get_conversation_structure()` -- topic tree with summaries
- `get_messages(range)` -- actual message content for specific ranges

### 2.3 What Needs to Be Different

#### 2.3.1 Multi-Dimensional Structure (Not Just Hierarchical)

Documents have a single linear flow. Conversations have multiple interleaved threads. A pure hierarchy can't capture:

- Topic A discussed in messages 1-5, then revisited in messages 42-50
- Two topics discussed simultaneously in interleaved messages
- A decision in message 30 that reverses a decision from message 8

**Proposed adaptation**: Build a **multi-root forest with cross-references** instead of a single tree:

```json
{
  "topics": [
    {
      "title": "Authentication System",
      "segments": [
        {"messages": "1-5", "summary": "Initial discussion of auth approaches"},
        {"messages": "42-50", "summary": "Revisited after security review"}
      ],
      "decisions": [
        {"message": 5, "decision": "Use OAuth 2.0", "status": "superseded", "superseded_by": 47},
        {"message": 47, "decision": "Use OAuth 2.0 with PKCE", "status": "current"}
      ],
      "subtopics": [...]
    }
  ],
  "cross_references": [
    {"from_topic": "Authentication", "to_topic": "Database Design", "reason": "Token storage requirements"}
  ]
}
```

#### 2.3.2 Decision Tracking Layer

This is the highest-value addition for corporate conversations. On top of the topic tree, maintain a **decision registry**:

```
Decision: Use PostgreSQL with JSONB columns
  - First proposed: Message #12 by Alice
  - Challenged: Message #28 by Bob (wanted MongoDB)
  - Arguments for: [Message #12, #15, #34]
  - Arguments against: [Message #28, #30]
  - Resolved: Message #35 by Carol (tie-breaking)
  - Status: ACTIVE
  - Supersedes: Decision from Message #28 (MongoDB)
```

This can be extracted with an LLM prompt specifically designed to identify **decision patterns**:

```
Identify decisions in this conversation segment. For each:
1. What was decided?
2. Who proposed it?
3. Was there disagreement? Who disagreed and why?
4. Is this a new decision, a revision, or a reversal of a prior decision?
5. Is this decision still active, or was it later changed?
```

#### 2.3.3 Speaker Attribution and Role Awareness

Unlike documents, conversations have speakers with different authority levels. The structure should capture:

- **Who said what** -- critical for understanding authority of decisions
- **Role context** -- an architect saying "we should use microservices" carries different weight than an intern saying it
- **Consensus indicators** -- explicit agreement ("sounds good"), silence (implicit consent?), or explicit disagreement

#### 2.3.4 Relevance Filtering

PageIndex processes every page of a document. Conversations need **noise filtering**:

```
Classification prompt for each message segment:
- DECISION: Contains a decision or decision-reversal
- REQUIREMENT: States a requirement or constraint
- DESIGN: Discusses design approach or architecture
- ARGUMENT: Supports or opposes a proposal
- CONTEXT: Provides background information
- OFF-TOPIC: Not relevant to software design/requirements
- SOCIAL: Greetings, thanks, scheduling, etc.
```

Off-topic and social messages should be excluded from the structure tree but remain accessible (in case someone asks "when did we discuss X" and the answer is "right after Bob's birthday joke on Thursday").

### 2.4 Proposed Architecture

#### 2.4.1 Indexing Pipeline

```
Raw Conversation (Slack/Teams/Email/Meeting Transcript)
  |
  v
[1. Segmentation]
  Split into message-level units with metadata (speaker, timestamp, channel)
  |
  v
[2. Relevance Classification]
  LLM classifies each message: DECISION / REQUIREMENT / DESIGN /
  ARGUMENT / CONTEXT / OFF-TOPIC / SOCIAL
  (async, concurrent -- borrowed from PageIndex's async patterns)
  |
  v
[3. Topic Extraction]
  Group relevant messages into overlapping chunks (PageIndex's grouping algorithm)
  For first chunk: generate initial topic structure (like generate_toc_init)
  For subsequent chunks: extend structure (like generate_toc_continue)
  Handle topic revisits: allow multiple message ranges per topic
  |
  v
[4. Decision Extraction]
  Scan for decision patterns within each topic
  Track: proposal -> debate -> resolution -> possible reversal
  Link decisions to specific messages and speakers
  |
  v
[5. Verification]
  Verify topic assignments (PageIndex's verify_toc pattern)
  Verify decision attributions
  Fix incorrect assignments with narrowed search
  |
  v
[6. Summary Generation]
  Generate summaries for each topic node (PageIndex's generate_summaries_for_structure)
  Generate decision summaries
  Generate overall conversation summary
  |
  v
[7. Cross-Reference Detection]
  Identify topic dependencies and relationships
  Link related decisions across topics
  |
  v
Structured Conversation Index (JSON tree + decision registry)
```

#### 2.4.2 Output Structure

```json
{
  "conversation_name": "Backend Architecture Discussion Q1 2026",
  "participants": ["Alice (Architect)", "Bob (Senior Dev)", "Carol (PM)", "Dave (DevOps)"],
  "date_range": "2026-01-15 to 2026-02-28",
  "summary": "Architecture decisions for the new backend service...",

  "topics": [
    {
      "title": "Authentication System",
      "node_id": "0001",
      "summary": "Team debated OAuth vs session-based auth. Settled on OAuth 2.0 with PKCE after security review raised concerns about session fixation.",
      "segments": [
        {"start_msg": 1, "end_msg": 5, "date": "2026-01-15", "summary": "Initial auth discussion"},
        {"start_msg": 42, "end_msg": 50, "date": "2026-01-22", "summary": "Revisited after security review"}
      ],
      "decisions": [
        {
          "decision": "Use OAuth 2.0 with PKCE for all auth flows",
          "proposed_by": "Alice",
          "proposed_at": "msg #47",
          "status": "active",
          "supersedes": "msg #5 (basic OAuth without PKCE)"
        }
      ],
      "subtopics": [
        {
          "title": "Token Storage",
          "node_id": "0002",
          "summary": "Discussion of where to store refresh tokens...",
          "segments": [{"start_msg": 48, "end_msg": 50}]
        }
      ]
    }
  ],

  "open_questions": [
    {"question": "How long should refresh tokens live?", "raised_by": "Bob", "at": "msg #49"}
  ],

  "cross_references": [
    {"from": "0001", "to": "0005", "type": "depends_on", "reason": "Token storage affects database schema"}
  ]
}
```

#### 2.4.3 Retrieval Tools for the Agent

```python
def get_conversation_metadata() -> str:
    """Participants, date range, channels, message count."""

def get_conversation_structure() -> str:
    """Topic tree with summaries, decisions, and open questions. No message text."""

def get_decisions(topic_id: str = None, status: str = None) -> str:
    """All decisions, optionally filtered by topic or status (active/superseded/reverted)."""

def get_messages(range: str) -> str:
    """Actual message content for specific message numbers. Include speaker and timestamp."""

def get_topic_history(topic_id: str) -> str:
    """Full chronological history of a specific topic across all segments."""
```

Example agent interaction:

```
User: "What database did we decide on and why?"

Agent -> get_conversation_structure()
  Sees topic "Database Design" with decision "PostgreSQL with JSONB"

Agent -> get_decisions(topic_id="0005")
  Sees: Initially MongoDB (Bob, msg #28), reversed to PostgreSQL (Carol, msg #35)

Agent -> get_messages("28-35")
  Reads the actual debate

Agent: "The team decided on PostgreSQL with JSONB columns. Bob initially
proposed MongoDB for schema flexibility (msg #28), but Alice argued that
PostgreSQL's JSONB provides similar flexibility with ACID guarantees (msg #34).
Carol made the final call in msg #35, citing the team's existing PostgreSQL
expertise as the tiebreaker."
```

### 2.5 Key Challenges and Mitigations

| Challenge | Why It's Hard | Mitigation |
|-----------|---------------|------------|
| **Topic interleaving** | Messages 10-15 might alternate between two topics | LLM classifiers can assign each message to a topic; one message can belong to multiple topics |
| **Implicit decisions** | "OK let's go with that" -- what is "that"? | Include preceding messages as context when classifying; require the LLM to resolve pronouns |
| **Decision reversals** | Hard to know if a later statement overrides an earlier one | Temporal ordering + explicit "supersedes" tracking; mark old decisions as superseded, not deleted |
| **Scale** | Months of Slack history = millions of messages | Pre-filter by channel/thread/date; process threads independently; merge structures afterward |
| **Context loss at boundaries** | Chunk boundary might split a critical exchange | PageIndex's overlap strategy directly applies; use 3-5 message overlap |
| **Authority ambiguity** | Who has authority to make which decisions? | Capture role metadata; let the retrieval agent present decision-maker context rather than inferring authority |
| **Living documents** | Conversations continue; structure must update | Incremental indexing: process new messages with `generate_toc_continue()` pattern; re-verify affected topics |

### 2.6 Comparison: PageIndex Approach vs. Alternatives

| Approach | Strengths | Weaknesses |
|----------|-----------|------------|
| **Vector RAG** (embed + similarity search) | Fast, simple, works at scale | Loses structure; can't track decisions; chunk boundary problems; no notion of topic evolution or reversals |
| **PageIndex-style tree** (adapted) | Preserves structure; tracks decisions; explainable retrieval; handles topic revisits | Higher LLM cost for indexing; more complex pipeline; requires careful prompt engineering |
| **Knowledge graph** (entities + relations) | Rich relationship modeling; flexible queries | Very expensive to build; brittle extraction; hard to maintain; overkill for most queries |
| **Manual tagging** (human-created structure) | Most accurate | Doesn't scale; subjective; goes stale immediately |
| **Hybrid: Tree + Vector** | Tree for structure, vectors for fuzzy search within nodes | Best of both worlds but highest complexity |

### 2.7 Practical Recommendations

1. **Start with the PageIndex "No TOC" pattern**. Use the incremental structure generation approach (`generate_toc_init` + `generate_toc_continue`) but with message segments instead of page groups. This gives you 80% of the value with the simplest implementation.

2. **Add decision tracking as a second pass**. After the topic tree is built, run a focused decision-extraction prompt over each topic's message range. This separates concerns and makes each LLM call simpler.

3. **Use the verification loop**. PageIndex's verify-and-fix pattern is essential. LLMs will misattribute messages to topics or miss decision reversals. Budget for 2-3 verification rounds.

4. **Pre-filter aggressively**. Classify messages by relevance before structure extraction. A 1000-message Slack thread might have 200 substantive messages. Indexing 200 messages is 5x cheaper and more accurate than indexing 1000.

5. **Process threads independently, then merge**. If a conversation spans multiple Slack threads or email chains, build a tree for each, then use an LLM to merge the trees into a unified structure with cross-references.

6. **Keep raw messages accessible**. The tree is a navigation aid, not a replacement for the source material. Always let the agent fetch actual messages, just like PageIndex's `get_page_content()` returns actual page text.

7. **Design for incremental updates**. Corporate conversations are ongoing. Design the pipeline so new messages can be incorporated without rebuilding the entire tree. PageIndex's `generate_toc_continue()` pattern supports this naturally.
