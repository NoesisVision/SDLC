---
name: Design Feature
description: Turn rough feature ideas into a clarified design specification (using P3 Model and DDD). Use it whenever user ask for design of a feature or other system change.
---

# Design Feature

## Core Principle

User's design decisions have priority. Categorize every design aspect by confidence:
- **EXPLICIT:** User clearly stated → Use exactly as specified
- **IMPLIED:** Strongly suggested → Preserve unless architectural issue
- **ABSENT:** No user input → Fill with AI suggestions

AI assists by validating sketch, filling ABSENT areas, questioning architectural issues. Never deviate from EXPLICIT or IMPLIED decisions without user approval via AskUserQuestion tool.

## Quick Start
When asked to design or redesign a feature:
1. Split user input into: business requirements, rationale, design sketch
2. Clarify requirements in batches (prepare batches, present one by one)
3. Validate design sketch against clarified requirements
4. Design requirements individually (prioritize user's design decisions)
5. Unify P3 model changes
6. Provide design draft for user review
7. Create final design document only after explicit user acceptance

## Validation Gate Protocol

All validation gates in this workflow follow this protocol:
- **Check ALL criteria** listed in the gate before proceeding to next step
- **IF ANY criterion fails:**
  - STOP immediately, do not proceed
  - Identify which specific criteria failed
  - Determine root cause of failure
  - Resolve failure completely (not partially)
  - Re-check ALL criteria before continuing
- **Document resolution** in design draft for user visibility

This protocol applies to all validation gates (Steps 2, 2.5, 3, 4, 6).

## Design Workflow

### Step 1: Split user input into: business requirements, rationale, design sketch

Analyze user input and split in into 3 groups:
1. **requirements:** WHAT have to be done (functional capabilities, business rules, constraints)
2. **rationale:** WHY it have to be done (business value, problem statement, context)
3. **design sketch:** proposed user solution including:
   - Architectural decisions (modules, layers, components)
   - Technology choices (frameworks, libraries, patterns)
   - Data structures and relationships
   - P3 element suggestions (Domain Objects, Behaviors, Modules)
   - Integration points and dependencies
   - UI/UX considerations
   - Any other design decisions expressed by user

**IMPORTANT**: Mark each design decision with confidence level (see Core Principle for EXPLICIT/IMPLIED/ABSENT definitions).

### Step 2: Clarify requirements in batches

1. Process each requirement individually to identify: ambiguities, missing information, corner cases
2. Prepare clarification questions in batches (3-5 questions per batch)
3. Present questions to user using AskUserQuestion tool
4. After completing a batch, prepare next batch if needed
5. Improve requirement definitions based on responses

For clarification techniques see [requirement-clarification.md](requirement-clarification.md).

**Step 2 Validation Gate (see Validation Gate Protocol):**
Verify Quality Checklist (requirement-clarification.md:53-66) passes before proceeding to Step 3.

### Step 2.5: Validate design sketch against clarified requirements

**ONLY perform this step if user provided design sketch (not ABSENT).**

1. **Check consistency**: Does design sketch address all clarified requirements?
   - List requirements covered by design sketch
   - List requirements NOT covered by design sketch

2. **Identify conflicts**: Does design sketch contradict any requirements?
   - Example: Requirement says "synchronous", sketch proposes "event-driven"
   - Example: Requirement says "single module", sketch spreads across multiple

3. **Find gaps**: Does design sketch have missing corner cases?
   - Validate against requirement edge cases
   - Check error handling coverage
   - Verify data validation logic

4. **Resolution**:
   - IF conflicts OR significant gaps found: Use AskUserQuestion tool with options:
     - "Adjust requirements to match design sketch"
     - "Modify design sketch to match requirements"
     - "Hybrid approach" (explain specific combination)
   - IF minor gaps only: Note them for Step 3 (fill gaps while preserving user's decisions)
   - IF fully consistent: Proceed to Step 3

**Step 2.5 Validation Gate (see Validation Gate Protocol):**
Verify before proceeding: conflicts resolved; user confirmed gap handling; confidence levels assigned (EXPLICIT/IMPLIED/ABSENT).

### Step 3: Design requirements individually (prioritizing user's design sketch)

You MUST complete all substeps for each requirement separately before moving to the next requirement.

**3.1. Categorize all new business rules from requirements**
- Use patterns from [business-rules.md](business-rules.md)
- Document category and rationale for each rule

**3.2. Analyze actual solution based on P3 model snapshot**

You MUST locate the P3 model snapshot as follows:
1. Search for `p3model.json` starting from repository root using glob pattern `**/p3model.json`.
2. IF multiple files found: Use AskUserQuestion tool to let user select which file to use (list all found paths as options).
3. IF no file found: Use AskUserQuestion tool with options:
   - "Proceed without P3 model analysis"
   - "Specify alternative file location"
4. Validate JSON structure contains expected fields: check for Revision, Elements and Relations.

**Compare user's design sketch with P3 model:**
- IF user suggested specific P3 elements (Domain Objects/Behaviors): Verify they align with existing model structure
- IF user's suggestion conflicts with P3 model: Use AskUserQuestion tool presenting conflict with options
- IF user didn't specify P3 elements: Propose elements based on P3 model analysis

Use [p3-model.md](p3-model.md) to understand P3 Model structure and modeling guidelines.

**3.3. Assign business rules to Domain Behaviors or Domain Objects**

**PRIORITY ORDER:**
1. Use P3 elements from user's design sketch if specified (EXPLICIT/IMPLIED)
2. Only deviate if assignment violates DDD principles or creates architectural issues
3. If deviating: Use AskUserQuestion tool explaining why and offering alternatives

Process:
- For each business rule, determine appropriate P3 element
- IF user specified element in design sketch: Use it unless architecturally problematic
- IF user didn't specify: Propose element based on DDD patterns
- Create new elements if needed
- Maintain traceability: each P3 change → originating requirement(s)
- Reference [ddd.md](ddd.md) for DDD pattern guidance

**When to question user's choice:**
- Business logic assigned to Domain Object instead of Domain Behavior
- Behavior lacks clear domain concept (procedural thinking)
- Assignment creates circular dependencies

**3.4. Assign Domain Behaviors and Domain Objects to Domain Modules**

**PRIORITY ORDER:**
1. Use module placement from user's design sketch (if specified)
2. Only suggest alternative if user's placement violates modularization principles
3. If suggesting alternative: Use AskUserQuestion tool with clear rationale

Process:
- Follow guidelines in [modularization.md](modularization.md)
- IF user specified module in design sketch: Use it unless it violates cohesion/coupling principles
- IF user didn't specify: Place elements in module reflecting nearest domain concept
- IF multiple candidate modules exist: Use AskUserQuestion tool to let user choose placement

**When to question user's module choice:**
- Creates high coupling between unrelated bounded contexts
- Breaks module cohesion (mixed responsibilities)
- Introduces circular dependencies at module level

**3.5. Add or remove P3 relations (uses and invokes) based on requirements and design sketch**

**PRIORITY ORDER:**
1. Preserve dependencies specified in user's design sketch
2. Only suggest changes if dependencies create architectural issues
3. If suggesting changes: Use AskUserQuestion tool explaining architectural concern

Process:
- IF user specified integration points/dependencies in design sketch: Use them as baseline
- IF user's dependencies create circular references: Present issue with AskUserQuestion tool
- IF user didn't specify dependencies: Infer from requirements and P3 model structure
- Document all new/removed dependencies
- Check for circular dependencies
- Validate all "uses"/"invokes" targets exist

**Step 3 Validation Gate (see Validation Gate Protocol):**
Verify before proceeding: business rules categorized (business-rules.md patterns); P3 changes reference requirements (FR-XX); all elements have parent module; no orphaned references; EXPLICIT decisions preserved; IMPLIED deviations documented.

### Step 4: Unify P3 model changes

1. Union all changes created for each requirement
2. Remove duplicates (same element, same change type)
3. Detect conflicts:
   - Same element modified differently by different requirements
   - Incompatible structural changes
   - Naming collisions
4. IF conflicts detected: Present to user with specific conflict details using AskUserQuestion tool (provide resolution options)
5. Merge resolved changes into unified change set

**Step 4 Validation Gate (see Validation Gate Protocol):**
Verify before proceeding: no duplicate elements; conflicts resolved; changes internally consistent; change set traceable to requirements.

### Step 5: Provide design draft for user review

You MUST provide user a draft design including:
- All functional requirements with FR-XX numbering
- All identified business rules with BR-XX numbering
- All P3 model changes with MC-XX numbering
- **Design decisions summary**:
  - User's design decisions that were preserved (from design sketch)
  - User's design decisions that were modified (with rationale)
  - New design decisions made where user didn't specify (ABSENT areas)
- Any pending questions requiring clarification
- Any identified gaps or assumptions
- Deviations from user's design sketch (if any) with architectural justification

**Present draft clearly showing:**
- ✓ Preserved user decisions (highlight these positively)
- ⚠ Modified user decisions (explain why modification was necessary)
- + New decisions in areas not covered by user's sketch

Present the draft and use AskUserQuestion tool to request approval with options:
- "Approve design" - Proceed with final document creation
- "Request revisions" - Provide feedback for changes
- "Add new information" - Provide additional context or requirements

**Branching Logic:**
- IF user selects "Request revisions" or "Add new information": Return to appropriate step based on revision type
  - Requirements change: Return to Step 2
  - Design decision change: Return to Step 3
  - Conflict resolution: Return to Step 2.5
- IF user selects "Approve design": Proceed to Step 6
- NEVER proceed to Step 6 without explicit user approval via AskUserQuestion

### Step 6: Create final design document

You MUST create the final design document ONLY after user has explicitly accepted the draft.

**Step 6 Validation Gate (see Validation Gate Protocol):**
Verify before generating: requirements testable (SHALL/MUST); happy/error/corner cases covered; functional requirements documented; NFRs documented (if applicable); BDD scenarios present in model-changes.json; business rules present in model-changes.json.

**Document generation:**
1. Generate TWO files using [output-template.md](output-template.md):
   - design.md: Business Goal, Rationale, Requirements (Functional and Non-Functional)
   - model-changes.json: P3 model changes with business rules and BDD scenarios
2. Follow Output Placement rules (see section below)
3. Confirm document creation with user including both file paths

## Scope

**In scope:**
- Requirement clarification and validation
- Analyzing existing solution (code and P3 model)
- Designing change on conceptual level (P3 model, DDD Building Blocks, algorithms)
- Reading existing code to understand current implementation
- Referencing code structure/patterns in design rationale
- Quoting small code snippets (5-10 lines) to illustrate current behavior

**Out of scope:**
- Writing new implementation code
- Providing code samples for proposed design
- Suggesting specific code changes or refactorings
- Including code blocks in the design document

**When code analysis is needed:** Read, understand, abstract to P3 model concepts.

## Output Format

You MUST use [output-template.md](output-template.md) as the foundation structure.

**Required Sections in design.md (NEVER omit):**
- Business Goal
- Rationale
- Functional Requirements (with FR-XX format)

**Required in model-changes.json:**
- All P3 model changes as valid JSON
- Business rules and BDD scenarios for DomainBehavior changes

**Conditional Sections:**
- Actors: Include only if feature involves user roles or system actors
- Non-Functional Requirements: Include only if NFRs are specified or obvious

**Flexibility:**
- You MAY add custom sections to design.md if they clarify requirements
- You MUST maintain consistent numbering in design.md (FR-XX, NFR-XX)
- Business rules (BR-XX) are embedded in model-changes.json, not in design.md
- NEVER include placeholder content like "[TODO]" or "TBD" in final documents

**Requirement Numbering Rules:**
- Use sequential numbering: FR-01, FR-02, etc.
- Number ALL functional requirements in the order they are defined
- Start from FR-01 for each new design document
- Use the same FR-XX format consistently in cross-references
- Same applies to BR-XX (business rules), MC-XX (model changes), NFR-XX (non-functional requirements)

## Output Placement

**Repository Root Resolution:**
1. Attempt: `git rev-parse --show-toplevel`
2. If fails: Search upward for .git directory
3. If still fails: Inform user and return design content in response (do not write file)

**File Placement:**
- Place design content in TWO files at: `{repository_root}/specs/{YYYY-MM-DD}_{feature-slug}/`
  - design.md: Business Goal, Rationale, and Requirements
  - model-changes.json: P3 model changes with business rules and BDD scenarios
- Create directory if it doesn't exist

## Best Practices (ENFORCEMENT REQUIRED)

1. **Extract clear acceptance criteria**
   - MUST: Every requirement maps to ≥1 testable acceptance criterion
   - Check: Can QA write test cases from this requirement alone?
   - Anti-pattern: Vague success criteria like "works well" or "fast enough"

2. **Identify dependencies early**
   - MUST: Document which P3 elements will be affected before designing changes
   - Check: Have you identified all upstream/downstream impacts?
   - Anti-pattern: Designing changes in isolation without checking dependencies

3. **Value names from user input and P3 model over code**
   - MUST: When terminology conflicts (user ≠ P3 model ≠ code), ASK user for clarification
   - Check: Are you using ubiquitous language from domain, not technical jargon?
   - Anti-pattern: Copying class names from legacy code into design
   - Example: User says "subscription", code says "recurring_payment_contract" → Ask which term to use

## Error Handling

For detailed error handling procedures, see [error-handling.md](error-handling.md).

## Reference File Usage Strategy

**Always load at start:**
- output-template.md (needed for final output)
- requirement-clarification.md (needed for Step 2)

**Load on demand:**
- business-rules.md - Load during Step 3.1 (business rule categorization)
- p3-model.md - Load during Step 3.2 (P3 analysis)
- ddd.md - Load when DDD terminology is unclear
- modularization.md - Load during Step 3.4 (module assignment)
- bdd-examples.md - Load when writing BDD scenarios to model-changes.json (Step 6)
- error-handling.md - Load when specific errors occur

**Never load:**
- SKILL.md (you're executing it)

This reduces token usage.

## Prompt Caching Strategy

To optimize performance and reduce costs, implement prompt caching using Anthropic's cache breakpoints.

**Cache Block 1 - Stable Content (cache for full session):**
Files that rarely change and should be cached across all conversations:
- SKILL.md (full workflow, state machine, best practices)
- requirement-clarification.md (clarification techniques)
- business-rules.md (pattern catalog)
- p3-model.md (semantic guide)
- ddd.md (tactical patterns)
- modularization.md (principles)
- output-template.md (design document template)

**Cache Block 2 - Session-Specific Content (cache per design session):**
Content that stays stable within a single feature design:
- User's initial feature request and context
- P3 model snapshot (p3model.json content)
- Repository structure overview
- Existing codebase context (if analyzed)

**Non-Cached Content (changes each turn):**
Content that varies with each conversation turn:
- Current workflow state
- User responses to AskUserQuestion
- Accumulated design decisions
- Intermediate work products (categorized BR, P3 changes)
- Draft design documents

**Implementation:**
When invoking this skill, configure cache breakpoints to separate stable from dynamic content. See Anthropic's prompt caching documentation for specific API parameters.

## Workflow State Machine

You MUST track workflow state and only perform actions valid for current state. You SHOULD announce state transitions: "→ Entering [STATE_NAME] state"

| State | Actions | Next State(s) | Exit Condition | Validation |
|-------|---------|---------------|----------------|------------|
| **INITIAL** | Split input into requirements/rationale/design sketch; mark design decisions (EXPLICIT/IMPLIED/ABSENT) | CLARIFYING or VALIDATING_SKETCH (if clear + sketch exists) or DESIGNING (if clear + no sketch) | Input categorized, design confidence levels assigned | Step 1 items completed |
| **CLARIFYING** | Prepare question batches (3-5 questions), present ONE BY ONE, validate responses | CLARIFYING (if gaps remain) or VALIDATING_SKETCH (if sketch exists) or DESIGNING (if no sketch) | Quality Checklist (requirement-clarification.md:53-66) passes AND user confirmed requirements clear | All Step 2 Validation Gate items pass |
| **VALIDATING_SKETCH** | Check consistency, identify conflicts, find gaps, resolve via AskUserQuestion | DESIGNING | All conflicts resolved, gaps addressed, confidence levels confirmed | Step 2.5 Validation Gate passes |
| **DESIGNING** | Categorize BR, assign to P3 elements (preserve user's EXPLICIT decisions), identify changes (process each requirement separately) | UNIFYING | All business rules categorized, P3 changes reference source requirements, user's EXPLICIT decisions preserved | Step 3 Validation Gate passes |
| **UNIFYING** | Union P3 changes, remove duplicates, detect conflicts, resolve via AskUserQuestion if needed | DRAFTING or CLARIFYING (if conflicts need user input) | No duplicate elements, all conflicts resolved, changes traceable | Step 4 Validation Gate passes |
| **DRAFTING** | Generate design draft from template, show preserved/modified/new decisions, present to user with AskUserQuestion | CLARIFYING (req changes) or VALIDATING_SKETCH (design conflicts) or DESIGNING (design refinements) or FINALIZING (user accepts) | User approves design via AskUserQuestion | All required sections present, no placeholders, user decisions documented |
| **FINALIZING** | Write TWO files: {repo_root}/specs/{date}_{slug}/design.md and model-changes.json | COMPLETE | Both files written successfully | Files exist, paths confirmed with user |
| **COMPLETE** | No further actions | - | Design process finished | - |

**State Transition Rules:**
- Only ONE state active at any time
- Cannot skip states (must follow Next State(s) column)
- Must satisfy Exit Condition before transitioning
- DRAFTING can loop back to earlier states based on revision type
- User approval via AskUserQuestion is REQUIRED before FINALIZING
