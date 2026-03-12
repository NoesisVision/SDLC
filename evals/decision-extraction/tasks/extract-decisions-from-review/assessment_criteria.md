# Assessment Criteria: Decision Extraction from Architecture Review

Evaluate the AI-generated decision extraction output across four dimensions. Each dimension is scored 0–25 points.

## 1. Completeness (0–25)

Evaluate whether the agent found all major decisions present in the transcript.

| Score | Criteria |
|-------|----------|
| 0     | No decisions extracted, or output is empty/invalid |
| 5     | Only 1 of 3 expected decisions found |
| 10    | 2 of 3 expected decisions found, but missing significant nuance |
| 15    | All 3 decisions found, but one is vaguely described or missing key details |
| 20    | All 3 decisions found with good coverage: Marten for write side, EF for read side, sync integration. Minor details missing (e.g., one alternative not listed) |
| 25    | All 3 decisions found with full detail: each has complete context, all discussed alternatives captured, team disagreement on async vs sync noted |

**Expected decisions:**
1. Adopt Marten Document Store (JSONB) for Order aggregate persistence (write side)
2. Keep EF Core for read side queries (CQRS pattern)
3. Keep synchronous integration between Sales and RiskManagement bounded contexts

## 2. Accuracy (0–25)

Evaluate whether the identified decisions are correct and faithful to what was discussed.

| Score | Criteria |
|-------|----------|
| 0     | Decisions are fabricated or completely wrong |
| 5     | Decisions exist but contain major factual errors (wrong technology chosen, wrong rationale attributed) |
| 10    | Decisions are roughly correct but contain inaccuracies (e.g., attributing wrong arguments to wrong speakers, mixing up which option was chosen vs rejected) |
| 15    | Decisions are correct but rationale is oversimplified or missing key arguments from the discussion |
| 20    | Decisions are accurate with correct rationale. Minor inaccuracies in details (e.g., slightly wrong file names, missing one argument) |
| 25    | Decisions are fully accurate: correct choices, correct rationale matching speakers' actual arguments, correct alternatives with correct rejection reasons, team conflict on Topic 2 accurately captured |

**Key accuracy checks:**
- Marten chosen for pragmatism, not performance
- EF chosen for read side because team knows LINQ, not because Marten can't do reads
- Sync integration kept because of YAGNI, not because async is bad
- Linh pushed for async (based on prior experience), Tomasz defended sync
- Event Sourcing rejected as too complex at current scale, not as fundamentally wrong

## 3. Structure Quality (0–25)

Evaluate whether decision records are well-formed with clear context, rationale, consequences, and alternatives.

| Score | Criteria |
|-------|----------|
| 0     | Output files missing or not valid JSON |
| 5     | JSON files exist but missing most required fields |
| 10    | Required fields present but content is shallow (one-sentence rationale, no consequences, empty alternatives) |
| 15    | Good structure with reasonable content, but consequences are generic or alternatives lack rejection rationale |
| 20    | Well-structured records: specific context, detailed rationale, meaningful consequences, alternatives with rejection reasons. Minor issues (e.g., design_concerns slightly off) |
| 25    | Excellent structure: context synthesizes the problem clearly, rationale captures the nuanced discussion, consequences mention specific trade-offs, each alternative has a specific rejection reason. structured.json has well-organized topics with idea units correctly categorized |

**Key structure checks:**
- Each decision file has: topic_id, topic_name, context, decision (description, rationale, consequences), alternative_options, design_concerns
- structured.json has: conversation_id, title, date, topics array with idea_units
- Idea units correctly categorized (Issue, Position, Argument, Decision, etc.)
- design_concerns use valid values from the enum

## 4. Context Relevance (0–25)

Evaluate whether the output correctly relates decisions to the actual codebase architecture.

| Score | Criteria |
|-------|----------|
| 0     | No codebase references, or references are fabricated |
| 5     | Generic references without connection to actual files/classes |
| 10    | Some correct references but mixed with incorrect ones (wrong file names, non-existent classes) |
| 15    | References are mostly correct but lack specificity (mentions "the repository" instead of specific implementation classes) |
| 20    | Good codebase grounding: references correct files (OrderSqlRepository variants, PlaceOrderHandler), correct bounded contexts (Sales, RiskManagement). Minor omissions |
| 25    | Excellent codebase grounding: references specific files (OrderSqlRepository.EF.cs, OrderSqlRepository.Document.cs, OrderSqlRepository.EventsSourcing.cs, PlaceOrderHandler.cs), mentions Sales.Adapters, RiskManagementIntegration interface, TechnicalStuff outbox. Context accurately describes how these relate to the decisions |

**Key context checks:**
- Mentions the 4 OrderSqlRepository implementations (EF, Document, EventsSourcing, Raw SQL)
- References PlaceOrderHandler and its synchronous call to RiskManagement
- Understands the bounded context boundaries (Sales, RiskManagement)
- References are to actual files/classes that exist in the repo
