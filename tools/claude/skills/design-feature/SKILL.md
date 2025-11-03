---
name: Design Feature
description: Turn rough feature ideas into a clarified design specification (using P3 Model and DDD). Use it whenever user ask for design of a feature or other system change.
---

# Design Feature

## Core Principle

**User's design decisions have priority.** This skill treats user's design sketch as the primary design source. AI assists by:
1. Validating sketch against requirements (finding inconsistencies, gaps, conflicts)
2. Filling ABSENT areas (where user didn't specify)
3. Questioning architectural issues (circular dependencies, coupling violations)

**Never silently override user's design.** Always use AskUserQuestion tool before deviating from EXPLICIT or IMPLIED user decisions.

## Quick Start
When asked to design or redesign a feature:
1. Split user input into: business requirements, rationale, design sketch
2. Clarify requirements in batches (prepare batches, present one by one)
3. Validate design sketch against clarified requirements
4. Design requirements individually (prioritize user's design decisions)
5. Unify P3 model changes
6. Provide design draft for user review
7. Create final design document only after explicit user acceptance

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

**IMPORTANT**: Mark each design decision with confidence level:
- EXPLICIT: User clearly stated this decision
- IMPLIED: Strongly suggested by user's description
- ABSENT: No user input on this aspect

### Step 2: Clarify requirements in batches

1. Process each requirement individually to identify: ambiguities, missing information, corner cases
2. Prepare clarification questions in batches (3-5 questions per batch)
3. Present questions to user using AskUserQuestion tool
4. After completing a batch, prepare next batch if needed
5. Improve requirement definitions based on responses

For clarification techniques see [requirement-clarification.md](requirement-clarification.md).

**Step 2 Validation Gate**
Before proceeding to Step 3, you MUST verify:
- [ ] All items in Quality Checklist (requirement-clarification.md:32-42) are checked
- [ ] User has explicitly confirmed requirements are clear
- [ ] No "TBD", "unclear", "needs clarification" or assumption markers remain
- [ ] Every requirement has clear actor, action, and business value

IF ANY validation fails: STOP and resolve before continuing.

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

**Step 2.5 Validation Gate**
Before proceeding to Step 3, you MUST verify:
- [ ] All conflicts between sketch and requirements resolved
- [ ] User has confirmed approach for handling gaps
- [ ] Design sketch is marked with confidence levels (EXPLICIT/IMPLIED/ABSENT)

IF ANY validation fails: STOP and resolve before continuing.

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
- NEVER create first-level Domain Module (Bounded Context) without user approval using AskUserQuestion tool
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

**Step 3 Validation Gate**
Before proceeding to Step 4, you MUST verify:
- [ ] Every business rule is categorized using business-rules.md patterns
- [ ] Every P3 change references source requirement(s) (FR-XX format)
- [ ] All new Domain Objects/Behaviors have parent Domain Module assigned
- [ ] No orphaned references (all "uses"/"invokes" targets exist)
- [ ] User's EXPLICIT design decisions from sketch are preserved (or conflicts resolved via AskUserQuestion)
- [ ] Any deviations from IMPLIED design decisions have documented rationale

IF ANY validation fails: STOP and fix before continuing.

### Step 4: Unify P3 model changes

1. Union all changes created for each requirement
2. Remove duplicates (same element, same change type)
3. Detect conflicts:
   - Same element modified differently by different requirements
   - Incompatible structural changes
   - Naming collisions
4. IF conflicts detected: Present to user with specific conflict details using AskUserQuestion tool (provide resolution options)
5. Merge resolved changes into unified change set

**Step 4 Validation Gate**
Before proceeding to Step 5, you MUST verify:
- [ ] No duplicate P3 elements with different names
- [ ] All conflicts resolved (either automatically or by user decision)
- [ ] P3 changes are internally consistent (no orphaned references)
- [ ] Change set is traceable (each change → originating requirement(s))

IF ANY validation fails: STOP and fix before continuing.

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

1. Generate complete design document using [output-template.md](output-template.md)
2. Follow Output Placement rules (see section below)
3. Confirm document creation with user including file path

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

**Required Sections (NEVER omit):**
- Purpose
- Functional Requirements (with RF-XX format)
- P3 Model Changes (with MC-XX format)
- Acceptance Checklist

**Conditional Sections:**
- Actors: Include only if feature involves user roles or system actors
- Non-Functional Requirements: Include only if NFRs are specified or obvious

**Flexibility:**
- You MAY add custom sections if they clarify the design
- You MUST maintain consistent numbering and cross-references (FR-XX, BR-XX, MC-XX, NFR-XX)
- NEVER include placeholder content like "[TODO]" or "TBD" in final document

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
- Place design content in single markdown file at: `{repository_root}/specs/{YYYY-MM-DD}_{feature-slug}/design.md`
- Create directory if it doesn't exist
- Confirm file path with user after creation

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

### p3model.json Not Found
1. Inform user: "I couldn't locate p3model.json in the repository."
2. Use AskUserQuestion tool with options:
   - "Proceed without P3 analysis"
   - "Use different file path"
3. Wait for response before continuing

### Invalid p3model.json Structure
1. Inform user: "p3model.json exists but has structural issues: [specific error]"
2. Use AskUserQuestion tool with options:
   - "Ignore and proceed"
   - "Abort design"
   - "Try again (after user fix)"
3. You MUST NEVER guess structure

### User Provides Contradictory Requirements
1. Detect contradiction: FR-XX says Y, but FR-YY says Z
2. Present both to user with specific conflict description
3. Use AskUserQuestion tool presenting both options with clear descriptions
4. Update requirements based on response

### Repository Root Cannot Be Determined
1. Attempt: git rev-parse --show-toplevel
2. If fails: Search upward for .git directory
3. If still fails: Inform user and return design content in response (do not write file)

### User Requests Out-of-Scope Task
Examples: "implement this", "write the code", "create unit tests"
1. Inform user: "That's outside the design phase scope."
2. Use AskUserQuestion tool with options:
   - "Add implementation notes to design"
   - "Defer to implementation phase"

### Unclear User Input
You MUST use AskUserQuestion tool to ask user for clarification with relevant options. NEVER guess or infer unclear requirements.

### Multiple Equally Valid Design Solutions
You MUST use AskUserQuestion tool when there are multiple equally valid solutions. Present each option with description. NEVER proceed with design without explicit user choice.

### User's Design Sketch Conflicts with Requirements
1. Identify specific conflict: "Requirement FR-XX says Y, but design sketch proposes Z"
2. Use AskUserQuestion tool with options:
   - "Prioritize requirement (adjust sketch)"
   - "Prioritize design sketch (adjust requirement)"
   - "Hybrid approach" (specify how to combine both)
3. Update affected artifacts based on response

## Reference File Usage Strategy

**Always load at start:**
- output-template.md (needed for final output)
- requirement-clarification.md (needed for Step 2)

**Load on demand:**
- business-rules.md - Load during Step 3.1 (business rule categorization)
- p3-model.md - Load during Step 3.2 (P3 analysis)
- ddd.md - Load when DDD terminology is unclear
- modularization.md - Load during Step 3.4 (module assignment)

**Never load:**
- SKILL.md (you're executing it)

This reduces token usage.

## Workflow State Machine

You MUST track workflow state and only perform actions valid for current state:

**State: INITIAL** → Parse user input
- Actions: Split into requirements, rationale, design sketch; mark design decisions (EXPLICIT/IMPLIED/ABSENT)
- Next: CLARIFYING or VALIDATING_SKETCH (if input is crystal clear) or DESIGNING (if input crystal clear AND no design sketch)
- Validation: Step 1 items completed, design decisions categorized

**State: CLARIFYING** → Ask questions, gather requirements
- Actions: Prepare question batches (3-5 questions), present ONE BY ONE, validate responses
- Next: CLARIFYING (if gaps remain) or VALIDATING_SKETCH (if Step 2 Validation Gate passes AND design sketch exists) or DESIGNING (if no design sketch)
- Exit condition: Quality Checklist (requirement-clarification.md:32-42) passes

**State: VALIDATING_SKETCH** → Validate design sketch against requirements
- Actions: Check consistency, identify conflicts, find gaps, resolve via AskUserQuestion if needed
- Next: DESIGNING (when Step 2.5 Validation Gate passes)
- Validation: Step 2.5 Validation Gate passes
- Exit condition: All conflicts resolved, gaps addressed, confidence levels confirmed

**State: DESIGNING** → Apply P3 model analysis per requirement (prioritizing user's sketch)
- Actions: Categorize business rules, assign to P3 elements (preserve user's EXPLICIT decisions), identify changes
- Next: UNIFYING
- Validation: Step 3 Validation Gate passes (including preservation of user decisions)

**State: UNIFYING** → Merge and deduplicate P3 changes
- Actions: Check conflicts, resolve duplicates
- Next: DRAFTING or CLARIFYING (if conflicts need user input)
- Validation: Step 4 Validation Gate passes

**State: DRAFTING** → Present design for review (highlighting preserved user decisions)
- Actions: Generate design.md from template, show preserved/modified/new decisions, present to user
- Next: Return to appropriate state based on revision type (CLARIFYING for req changes, VALIDATING_SKETCH for design conflicts, DESIGNING for design refinements), or FINALIZING (if user accepts)
- Validation: All required sections present, no placeholders, user decisions documented

**State: FINALIZING** → Write final design document
- Actions: Write to {repo_root}/specs/{date}_{slug}/design.md
- Next: COMPLETE
- Validation: File written successfully, path confirmed with user

**State: COMPLETE** → Design process finished
- No further actions

You SHOULD announce state transitions: "→ Entering VALIDATING_SKETCH state"
