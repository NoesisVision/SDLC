1. Read/save shape asymmetry. read_design_doc returns a snapshot but reuses DesignDoc (with empty removed/modified). If the agent round-trips the result back into save_design_doc, every item is
   re-added (idempotent thanks to upsert, but semantically muddled). Consider a separate DesignDocSnapshot type with plain arrays for reads.
2. Identity by name is fragile. All nested entities (BC, Module, BB, Behaviour, Rule, Scenario) are upserted by name within parent. Renaming = removed + added, which loses identity and any future
   cross-references. Adding optional stable id fields to nested types and preferring them when present would make renames safe.
3. Behaviour input/output/uses are STRING[], not edges. Currently stored as arrays on the behaviour node, so you can't traverse "which behaviours produce OrderPlaced?". Resolving names to BB ids at
   save time and emitting BEHAVIOUR_INPUT_BB/OUTPUT_BB/USES_BB edges would unlock cross-cutting queries. Forward references would need a two-pass resolve.
4. Behaviour → Actor link is best-effort. linkBehaviourToActor silently no-ops if the actor doesn't exist yet. Two-pass save (create all nodes first, then resolve all edges) would make ordering
   irrelevant.
5. Properties stored as a JSON blob. Easy to write, but not graph-queryable. Acceptable for v1; promote to nodes if you ever need to ask cross-BB property questions.
6. DM_HAS_MODULE edge is dead schema. DesignedDomainModuleSchema does not allow nested submodules, so the edge never fires. Either drop it or extend the schema (skill workflow currently does not use
   submodules — YAGNI says drop).
7. No traceability link to Topics/Decisions. The whole point of grounding design in the knowledge graph is lost in storage: no edge ties a DesignedBoundedContext back to the Topic/Decision nodes that
   motivated it. Adding optional supportingTopics: string[] / supportingDecisions: string[] on bounded-context-level entities and emitting edges would close the loop and enable the analyze-design-draft
   skill to traverse "design ← rationale".
8. Quality attributes are orphans. They attach only to the DesignDoc, with no edge to the BCs/BBs they constrain. Worth adding appliesTo: string[] referencing BC names.
9. No history / audit trail. Each save overwrites state; the ChangeSet payload itself is not preserved. Storing each save's input as a Document node linked to the DesignDoc would give you free history
   with zero extra schema pressure.
10. Scanner vs designed type duplication. BoundedContext/BuildingBlock/Behavior exist in scanner/domain-model (observed reality) and Designed* (intent). I deliberately did not merge them — different
    lifecycles, different fields. But a future diff_design_vs_actual(design_doc_id) MCP tool would justify them living in the same module and exposing a comparison query.
11. Bun crashes when running multiple Kuzu test suites in one process (pre-existing — same crash on mcp/noesis-graph/knowledge alone). Tests pass per-file. Consider splitting bun test per directory in
    CI, or filing upstream.
