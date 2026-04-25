---
name: noesis:create-design-doc
description: Create a design document (specification) for codebase changes based on input documents and the knowledge graph. Use when user asks for a design doc, specification, or design analysis for planned changes.
---

# Create Design Doc

## Core Principles

- Think like a senior analyst, architect, and developer in one person.
- Ground the design in existing domain knowledge from the knowledge graph.
- Produce a precise, actionable design doc — not a vague overview.
- Use ChangeSet semantics: first iteration puts everything in `added`; subsequent iterations use `added`/`removed`/`modified` as diffs.
- Query the knowledge graph ONLY via `noesis-graph` MCP tools.

## Environment

- All graph access goes through `noesis-graph` MCP tools. Read-style tools (`list_topics`, `read_topic`, `read_design_doc`, `list_design_docs`) write Markdown to a tmp file and return the file path — read it with the Read tool.

## Setup

- **Input path:** Get from `$ARGUMENTS`. A file or directory containing input documents (requirements, specs, notes, etc.). Ask user if missing.
- **Output path:** Get from `$ARGUMENTS`. Path for the output JSON file. Ask user if missing — suggest locations like `work_items/` or next to input files.

## Workflow

### Step 1: Get current design from knowledge graph

1. Call MCP tool `noesis-graph:list_topics` with no `parent_topic_id`. The response is JSON `{ "file": "<path>.md", ... }` — read that file with the Read tool to see the topic list.
2. Identify root topics that relate to the input subject area.
3. For each related root topic with `has_subtopics: yes`, drill down by calling `noesis-graph:list_topics` with `parent_topic_id: <topic_id>` (again, read the returned file path with the Read tool).
4. Collect IDs of all relevant topics (prefer mid-level topics that cover the area comprehensively).

### Step 2: Parse and classify input

1. Read all input documents from `<input_path>` (if directory, read each file).
2. Classify each document: requirement, user story, meeting notes, existing spec, constraint, etc.
3. Extract key information:
   - **Functional requirements:** what the system must do.
   - **Non-functional requirements:** quality attributes (performance, security, etc.).
   - **Actors:** who interacts with the system.
   - **Constraints:** technical or business limitations.
   - **Existing decisions:** choices already made.

### Step 3: Get relevant topic details from knowledge graph

For each relevant topic ID collected in Step 1, call MCP tool `noesis-graph:read_topic` with `topic_id: <id>`. The response is JSON `{ "file": "<path>.md", ... }` — read that file with the Read tool. Extract domain context from the long summary: existing bounded contexts, building blocks, patterns, decisions, and terminology.

### Step 4: Design analysis

Combine knowledge graph context (Step 3) with input requirements (Step 2) to produce the design:

1. **Identify actors** — who triggers actions or consumes outputs. Reuse existing actors from the knowledge graph where applicable.
2. **Map bounded contexts** — group related functionality into bounded contexts. Reuse or extend existing contexts.
3. **Design building blocks** — for each bounded context:
   - Identify aggregates, entities, value objects, domain events, commands, queries, services, repositories, and integrations.
   - Define properties for each building block.
   - Define behaviours (commands, events, queries) with inputs, outputs, and referenced building blocks.
   - Specify business rules with types (Consistency, Structure, Computation, State change).
   - Write BDD scenarios (Given/When/Then) for key behaviours.
4. **Organize into modules** — group building blocks into domain modules within each bounded context if the context is large enough.
5. **Quality attributes** — capture non-functional requirements as measurable quality attributes.

### Step 5: Save design doc

1. Construct the design doc JSON following the `DesignDoc` schema:
   - `id`: optional design id (omit for first iteration to auto-generate UUID; reuse the same id when iterating).
   - `name`: stable human-readable design name (e.g. `auth-system`).
   - `description`: summary of what this design change covers.
   - `actors`: ChangeSet of actors.
   - `boundedContexts`: ChangeSet of bounded contexts with modules, building blocks, behaviours, rules, and scenarios.
   - `qualityAttributes`: ChangeSet of quality attributes.
2. Write the JSON directly to `<output_path>` (the user-provided repository location — this file is version-controlled, not transient) using the Write tool.
3. Call MCP tool `noesis-graph:save_design_doc` with `path: <output_path>`. The tool reads the file, validates, and persists the design into the knowledge graph. Returns inline JSON `{ design_doc_id, totals: { added, modified, removed } }`.
4. Report the output path and the returned counts to the user.

## Design Doc Schema Reference

The output JSON must conform to the `DesignDoc` schema. Key types (all use camelCase field names):

- **DesignDoc**: `{ id?, name, description, actors?, boundedContexts?, qualityAttributes? }`
- **DesignedBoundedContext**: `{ name, description?, modules?, buildingBlocks? }`
- **DesignedDomainModule**: `{ name, description?, buildingBlocks? }`
- **DesignedBuildingBlock**: `{ name, type?, description?, properties?, behaviours?, rules?, scenarios? }`
  - `type`: aggregate | entity | value_object | domain_event | domain_command | domain_query | domain_service | application_service | repository | factory | external_integration
- **DesignedBehaviour**: `{ name, description?, type?, input?, output?, usedBuildingBlocks?, rules?, scenarios?, isPublic, actor? }`
  - `type`: Command | Event | Query
- **DesignedRule**: `{ name, ruleType?, description? }`
  - `ruleType`: Consistency | Structure | Computation | State change
- **DesignedScenario**: `{ name, description, given, when, then }`
- **DesignedActor**: `{ name, description? }`
- **DesignedQualityAttribute**: `{ name, type?, description? }`
- **DesignedProperty**: `{ name, type? }`
- **ChangeSet\<T\>**: `{ added: T[], removed: string[], modified: T[] }`

All collection fields use `ChangeSet` wrappers. For first-time design, put all items in `added`.

## Rules

- Query the graph via the `noesis-graph` MCP tools. Read-style tools (`list_topics`, `read_topic`, `read_design_doc`, `list_design_docs`) return a tmp file path in their JSON response — always read that file with the Read tool to see the actual content.
- Use the Write tool to produce the design doc directly at the user-provided `<output_path>` (a version-controlled file in the repository). Do not generate it via shell heredoc.
- After writing, call `save_design_doc` with that same path to persist into the graph.
- For first-time designs (no existing design to diff against), put everything in `added` arrays within ChangeSets.
- Reuse terminology and naming from the knowledge graph to maintain consistency.
