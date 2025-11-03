---
name: Design Feature
description: Turn rough feature ideas into a clarified design specification (using P3 Model and DDD). Use it whenever user ask for design of a feature or other system change.
---

# Design Feature

## Quick Start
When asked to design or redesign a feature:
1. Split user input into: business requirements, rationale, design sketch
2. Clarify requirements in batches (prepare batches, present one by one)
3. Design requirements individually
4. Unify P3 model changes
5. Provide design draft for user review
6. Create final design document only after explicit user acceptance

## Design Workflow

### Step 1: Split user input into: business requirements, rationale, design sketch

Analyze user input and split in into 3 groups:
1. requirements: WHAT have to be done
2. rationale: WHY it have to be done
3. design sketch: proposed user solution (it can be almost ready to implement or only a first draft)

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

### Step 3: Design requirements individually

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

Use [p3-model.md](p3-model.md) to understand P3 Model structure and modeling guidelines.

**3.3. Assign business rules to Domain Behaviors or Domain Objects**
- For each business rule, determine appropriate P3 element.
- Create new elements if needed.
- Maintain traceability: each P3 change → originating requirement(s).
- Reference [ddd.md](ddd.md) for DDD pattern guidance.

**3.4. Assign Domain Behaviors and Domain Objects to Domain Modules**
- Follow guidelines in [modularization.md](modularization.md).
- NEVER create first-level Domain Module (Bounded Context) without user approval using AskUserQuestion tool.
- Place elements in module reflecting nearest domain concept.
- IF multiple candidate modules exist: Use AskUserQuestion tool to let user choose placement.

**3.5. Add or remove P3 relations (uses and invokes) based on requirements**
- Document all new/removed dependencies
- Check for circular dependencies

**Step 3 Validation Gate**
Before proceeding to Step 4, you MUST verify:
- [ ] Every business rule is categorized using business-rules.md patterns
- [ ] Every P3 change references source requirement(s) (FR-XX format)
- [ ] All new Domain Objects/Behaviors have parent Domain Module assigned
- [ ] No orphaned references (all "uses"/"invokes" targets exist)

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
- Any pending questions requiring clarification
- Any identified gaps or assumptions
- Summary of design decisions made

Present the draft and use AskUserQuestion tool to request approval with options:
- "Approve design" - Proceed with final document creation
- "Request revisions" - Provide feedback for changes
- "Add new information" - Provide additional context or requirements

**Branching Logic:**
- IF user selects "Request revisions" or "Add new information": Return to Step 3 and re-analyze all affected requirements
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
- Actions: Split into requirements, rationale, design sketch
- Next: CLARIFYING or DESIGNING (if input is crystal clear and passes all Quality Checklist items)
- Validation: Step 1 items completed

**State: CLARIFYING** → Ask questions, gather requirements
- Actions: Prepare question batches (3-5 questions), present ONE BY ONE, validate responses
- Next: CLARIFYING (if gaps remain) or DESIGNING (if Step 2 Validation Gate passes)
- Exit condition: Quality Checklist (requirement-clarification.md:32-42) passes

**State: DESIGNING** → Apply P3 model analysis per requirement
- Actions: Categorize business rules, assign to P3 elements, identify changes
- Next: UNIFYING
- Validation: Step 3 Validation Gate passes

**State: UNIFYING** → Merge and deduplicate P3 changes
- Actions: Check conflicts, resolve duplicates
- Next: DRAFTING or CLARIFYING (if conflicts need user input)
- Validation: Step 4 Validation Gate passes

**State: DRAFTING** → Present design for review
- Actions: Generate design.md from template, present to user
- Next: CLARIFYING (if user provides new info), FINALIZING (if user accepts), DRAFTING (if revisions needed)
- Validation: All required sections present, no placeholders

**State: FINALIZING** → Write final design document
- Actions: Write to {repo_root}/specs/{date}_{slug}/design.md
- Next: COMPLETE
- Validation: File written successfully, path confirmed with user

**State: COMPLETE** → Design process finished
- No further actions

You SHOULD announce state transitions: "→ Entering CLARIFYING state"
