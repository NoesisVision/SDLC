# Conversation Analysis MCP Server

A Python-based MCP server that transforms meeting transcripts into structured FalkorDB knowledge graphs using a 5-phase NLP pipeline.

## Overview

This server analyzes conversation transcripts to extract:
- **Sentences** with speaker attribution and timing
- **Semantic topics** using embedding-based segmentation
- **IBIS categories** (Issues, Positions, Arguments)
- **Domain terminology** with standardization
- **Topic hierarchies** and relationships

All data is persisted in a FalkorDB knowledge graph for querying and analysis.

## Implementation Status

### ✅ Completed Components

#### Phase 1: Ingestion (Deterministic)
- **`capabilities/ingestion/cleaner.py`** - Regex-based transcript cleaning and speaker turn extraction
- **`capabilities/ingestion/splitter.py`** - Spacy sentence splitting with UUID assignment

#### Phase 2: Segmentation (Vector-Based)
- **`capabilities/segmentation/embedder.py`** - Sentence embeddings using sentence-transformers/all-MiniLM-L6-v2
- **`capabilities/segmentation/valley_detector.py`** - "Embedding Valley" algorithm for topic boundary detection with Max-Min chunking

#### Phase 5: Graph Construction
- **`capabilities/graph/schema.py`** - Cypher query templates for all node and relationship types
- **`capabilities/graph/builder.py`** - Graph population functions with idempotent MERGE operations

#### Core Infrastructure
- **`models.py`** - Dataclasses for internal data structures (Sentence, PotentialTopic, RealTopic, etc.)
- **`types.py`** - Pydantic DTOs for MCP API boundaries
- **`prompts.py`** - LLM prompt templates for IBIS classification and term standardization

### 🚧 Remaining Work

#### Phase 3: Classification (LLM-Based)
- **`capabilities/classification/ibis_classifier.py`** - MCP sampling integration for IBIS categorization
- **`capabilities/classification/term_extractor.py`** - Domain term extraction

#### Phase 4: Refinement (Neuro-Symbolic)
- **`capabilities/refinement/term_standardizer.py`** - LLM-based term consolidation
- **`capabilities/refinement/topic_merger.py`** - Topic hierarchy formation

#### Integration
- **`pipeline.py`** - Main orchestrator coordinating all 5 phases
- **`server.py`** - FastMCP server with tool definitions and lifespan management

#### Testing & Documentation
- Unit tests for all capabilities
- Integration tests for MCP server
- End-to-end pipeline tests
- Test fixtures and mock LLM responses

## Architecture

### Data Flow

```
Raw Transcript
    ↓
[Phase 1: Ingestion]
    → Sentences with metadata
    ↓
[Phase 2: Segmentation]
    → PotentialTopics (embedding-based)
    ↓
[Phase 3: Classification] (TODO)
    → IBIS categories + Domain terms
    ↓
[Phase 4: Refinement] (TODO)
    → RealTopics with hierarchies
    ↓
[Phase 5: Graph Construction]
    → FalkorDB Knowledge Graph
```

### Graph Schema

**Nodes:**
- `Conversation` - Root node for each analyzed conversation
- `Person` - Meeting participants
- `Sentence` - Atomic text units with metadata
- `Topic` - Semantic topic groupings
- `Issue / Position / Argument` - IBIS categories
- `DomainTerm` - Standardized terminology

**Relationships:**
- `(:Conversation)-[:CONTAINS]->(:Sentence)`
- `(:Conversation)-[:ATTENDED_BY]->(:Person)`
- `(:Person)-[:SPOKE]->(:Sentence)`
- `(:Topic)-[:HAS_ISSUE|HAS_POSITION|HAS_ARGUMENT]->(IBIS nodes)`
- `(:Topic)-[:RELATES_TO]->(:DomainTerm)`
- `(:Topic)-[:PARENT_OF]->(:Topic)` - Hierarchical structure

## Dependencies

### Runtime
- `mcp>=1.0.0` - Model Context Protocol
- `falkordblite>=0.4.0` - Embedded graph database
- `spacy>=3.7.0` - NLP processing
- `sentence-transformers>=2.3.0` - Semantic embeddings
- `scikit-learn>=1.4.0` - Similarity/clustering
- `numpy>=1.24.0` - Numerical operations

### Development
- `pytest>=7.0.0` - Testing
- `pytest-asyncio>=0.21.0` - Async test support
- `black>=23.0.0` - Code formatting
- `isort>=5.12.0` - Import sorting
- `mypy>=1.0.0` - Type checking
- `ruff>=0.1.0` - Linting

### Post-Install Setup

```bash
# Install dependencies
pip install -e .

# Download spacy model
python -m spacy download en_core_web_sm
```

## File Structure

```
src/mcp/conversation-analysis/
├── server.py (TODO)                # FastMCP entry point
├── models.py ✅                    # Internal dataclasses
├── types.py ✅                     # Pydantic DTOs
├── pipeline.py (TODO)              # Main orchestrator
├── prompts.py ✅                   # LLM prompt templates
└── capabilities/
    ├── ingestion/ ✅
    │   ├── cleaner.py             # Regex cleaning
    │   └── splitter.py            # Spacy sentence splitting
    ├── segmentation/ ✅
    │   ├── embedder.py            # Sentence embeddings
    │   └── valley_detector.py    # Topic boundary detection
    ├── classification/ (TODO)
    │   ├── ibis_classifier.py    # IBIS categorization
    │   └── term_extractor.py     # Term extraction
    ├── refinement/ (TODO)
    │   ├── term_standardizer.py  # Term consolidation
    │   └── topic_merger.py       # Topic hierarchy
    └── graph/ ✅
        ├── schema.py             # Cypher queries
        └── builder.py            # Graph construction

tests/mcp/conversation-analysis/ (TODO)
├── test_server.py
├── test_pipeline.py
├── fixtures/
│   ├── sample_transcript.txt
│   └── mock_llm_responses.py
└── capabilities/
    ├── ingestion/test_*.py
    ├── segmentation/test_*.py
    ├── classification/test_*.py
    ├── refinement/test_*.py
    └── graph/test_*.py
```

## Next Steps

### 1. Complete Phase 3 & 4 (LLM Integration)

Implement the classification and refinement capabilities using MCP Sampling:

```python
# Example from plan
async def classify_ibis_batch(potential_topics, ctx):
    result = await ctx.session.create_message(
        messages=[SamplingMessage(role="user", content=TextContent(text=prompt))],
        max_tokens=4000,
        temperature=0.1
    )
    return parse_ibis_json_response(result.content.text)
```

### 2. Implement Pipeline Orchestrator

Create `pipeline.py` to coordinate all 5 phases:
- Phase sequencing
- State management
- Error handling and checkpointing
- Progress tracking

### 3. Implement MCP Server

Create `server.py` following the `noesis-local` pattern:
- FastMCP with asynccontextmanager lifespan
- Load NLP models (spacy, sentence-transformers)
- Initialize FalkorDB connection
- Define MCP tools:
  - `analyze_conversation` - Main pipeline
  - `analyze_conversation_incremental` - Phase-by-phase
  - `query_conversation_graph` - Cypher queries

### 4. Create Tests

- Unit tests for each capability
- Integration tests for server lifecycle
- End-to-end pipeline tests
- Mock LLM responses for deterministic testing

### 5. Code Quality

```bash
# Format code
black src/mcp/conversation-analysis
isort src/mcp/conversation-analysis

# Type check
mypy src/mcp/conversation-analysis

# Lint
ruff check src/mcp/conversation-analysis

# Test
pytest tests/mcp/conversation-analysis
```

## Example Usage (Future)

Once complete, the server will be used via MCP:

```python
# Analyze a conversation
result = await analyze_conversation(
    transcript=raw_transcript,
    conversation_id="meeting-2026-02-05",
    confidence_threshold=0.5
)

# Query the graph
results = await query_conversation_graph(
    conversation_id="meeting-2026-02-05",
    cypher_query="MATCH (t:Topic)-[:RELATES_TO]->(d:DomainTerm) RETURN t.name, collect(d.term)"
)
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool Structure | 3 tools (main, incremental, query) | Balance simplicity with power user needs |
| State Management | Stateful with in-memory cache | Support incremental processing |
| LLM Integration | MCP Sampling | Standard MCP pattern for server-to-LLM calls |
| Batching | Dynamic token-based (~6000 tokens/batch) | Optimize LLM costs |
| Embedding Model | all-MiniLM-L6-v2 | Per spec: fast, good quality (384 dims) |
| Graph Idempotency | MERGE for all operations | Re-run safety |
| Testing | Mock LLM responses | Deterministic tests, no API costs |

## Performance Expectations

For a 1-hour meeting (~3000 sentences):
- Phase 1 (Ingestion): ~5 seconds
- Phase 2 (Segmentation): ~30 seconds
- Phase 3 (Classification): ~60 seconds (LLM batches)
- Phase 4 (Refinement): ~20 seconds (LLM calls)
- Phase 5 (Graph): ~10 seconds
- **Total: ~2 minutes**

## References

- **Specification**: `.specs/conversation-analysis/spec.md`
- **Implementation Plan**: `/home/marcin/.claude/plans/wise-singing-aurora.md`
- **MCP Pattern**: `src/mcp/noesis-local/server.py`
- **Code Guidelines**: `CLAUDE.md`
