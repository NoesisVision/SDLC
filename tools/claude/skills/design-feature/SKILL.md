---
name: Design Feature
description: Turn rough feature ideas into a clarified design specification (using P3 Model and DDD). Use it whenever user ask for design of a feature or other system change.
---

# Design Feature

## Quick Start
When asked to design or redesign a feature:
1. Split user input into: business requirements, rationale, design sketch
2. Clarify requirements one by one
3. Design requirements one by one
4. Unify P3 model changes
5. Provide design draft

## Design Workflow

### Step 1: Split user input into: business requirements, rationale, design sketch

Analyze user input and split in into 3 groups:
1. requirements: WHAT have to be done
2. rationale: WHY it have to be done
3. design sketch: proposed user solution (it can be almost ready to implement or only a first draft)

### Step 2: Clarify requirements one by one

1. Check for: ambiguities, missing information, corner cases
2. Ask clarification questions
3. Improve requirement definition

For clarification techniques see [requirement-clarification.md](requirement-clarification.md).

### Step 3: Design requirements one by one

1. Categorize all new business rules from requirements.
2. Analyze actual solution based on P3 model snapshot (find and check p3model.json file).
3. Assign business rules to Domain Behaviors or Domain Objects, create new one if needed.
4. Assign Domain Behaviors and Domain Objects to Domain Modules.
4. Add or remove P3 relations (uses and invekes) based on requirements.

For details about business rules categories see: [business-rules.md](business-rules.md)
For details about assigning to mudules see: [modularization.md](modularization.md)
For details about P3 model see: [p3-model.md](p3-model.md)
For details about DDD see: [ddd.md](ddd.md)

### Step 4: Unify P3 model changes

1. Union all changes created for each requirement.
2. Remove duplicates.
3. Check if changea are confliction if yes ask user what to do.

### Step 5: Provide design draft

Provide user draft of the design with all questions and clarification needs.
If new information is provided go back to Step 3.
If user accepts the design create final design doc.

## Scope

**In scope:**
- requirement clarification
- analysing existing solution (code and P3 model)
- designing change on conceptual level (P3 model, DDD Building Blocks, algorithms)
**Out of scope:**
- implementation: DO NOT provide any code samples yet

## Output Format

Use [output-template.md](output-template.md) as a template for output.
Strictly follow this template (structure and scope of information).

## Output Placement

- Assume execution is inside a repository and resolve the repo root automatically.
- Place design content in single markdown file at: {repository_root}/specs/{YYYY-MM-DD}_{feature-slug}/design.md.
- If no reliable path for the repository can be resolved, skip file creation and return the design content in the response instead.

## Best Practices

1. **Extract clear acceptance criteria**: Know when "done" is done.
2. **Identify dependencies early**: Know what will be affected by designed change.
3. **Value names from user input and P3 model more than these from code**: Code can be legacy solution, following it can lead to poor design. Ask when in doubt.

## Common issues

- unclear user input: Ask user, do NOT guess.
- difficult design: Ask user, do NOT design if there are several equally possible solutions.
