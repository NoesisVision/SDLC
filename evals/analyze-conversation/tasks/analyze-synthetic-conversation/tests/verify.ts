/**
 * Deterministic structural verifier for analyze-synthetic-conversation.
 *
 * Reuses the canonical baked Zod schemas at /opt/noesis-plugin so the contract
 * cannot drift from the plugin under test. Runs with the plugin's bun:
 *   cd /opt/noesis-plugin && bun run /tests/verify.ts <mode>
 *
 * mode = "with-skill" | "vanilla" (test.sh picks it from the artifact shape).
 *
 * CONTRACT (why this validates the persisted graph, not the skill's output.json):
 * the skill's transient output.json lives under /opt/noesis-data and is NOT the
 * source of truth — it only carries topics the run *touched*. When the skill
 * reuses a pre-seeded topic via Goldilocks, the new topics' parent_id points at
 * the seeded root whose canonical record is the on-disk /app/noesis/topics file,
 * not necessarily echoed back into output.json. The canonical, Harbor-captured
 * artifact (Harbor copies /app -> artifacts/workspace) is /app/noesis/. So:
 *
 *   with-skill: validate /app/noesis/{conversations,topics,decisions}/*.json
 *     with the canonical on-disk schemas, build the FULL topic tree INCLUDING
 *     the pre-seeded files, and assert topology over the complete persisted set.
 *   vanilla: no MCP, no merge. Validate /app/output.json against the skill
 *     output schema; resolve parent_id within its own topics OR against the
 *     pre-seeded ids it can legitimately see in /app/noesis/topics.
 *
 * Checks (deterministic only — semantics are the LLM judge's job):
 *   1. artifacts present + valid JSON + pass the canonical schema
 *   2. conversation_id == contentHashAsUuid(/app/transcript.md)
 *   3. turn indices contiguous from 0; idea-unit indices contiguous per turn
 *   4. topic parent_id integrity over the full set; no cycles; exactly one root
 *   5. every non-Irrelevant idea unit referenced by exactly one topic;
 *      every Irrelevant idea unit referenced by no topic
 *   6. (with-skill) every persisted topic reviewed:true & decisions_extracted:true
 *   7. decision supporting_content refs in range + correct conversation id
 *
 * Exit 0 + "VERIFY OK" when all pass; exit 1 + "VERIFY FAIL: ..." otherwise.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { AnalyzeConversationOutputSchema } from "/opt/noesis-plugin/shared-contracts/skills/analyze-conversation/output.ts";
import { ConversationSchema } from "/opt/noesis-plugin/shared-contracts/conversation.ts";
import { TopicFileSchema } from "/opt/noesis-plugin/shared-contracts/topic.ts";
import { DecisionFileSchema } from "/opt/noesis-plugin/shared-contracts/decision.ts";
import { contentHashAsUuid } from "/opt/noesis-plugin/shared-contracts/uuid.ts";

const TRANSCRIPT_PATH = "/app/transcript.md";
const NOESIS_DIR = "/app/noesis";
const VANILLA_OUTPUT = "/app/output.json";
// Pre-seeded topic ids (baked into the image at /app/noesis/topics). The vanilla
// agent can see these files even without MCP and may legitimately reference them.
const SEED_TOPIC_IDS = new Set([
  "11111111-1111-7111-8111-111111111111",
  "22222222-2222-7222-8222-222222222222",
]);

function fail(msg: string): never {
  console.log(`VERIFY FAIL: ${msg}`);
  process.exit(1);
}

function jsonFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    fail(`not valid JSON: ${path}: ${(e as Error).message}`);
  }
}

interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
}

/** Topology over the full topic set: exactly one root, parent_id resolves, no cycles. */
/**
 * A node is a "top-level attachment" if its parent_id is null, OR points to a
 * resolvable id that is NOT one of the run's own nodes (i.e. an existing graph
 * topic such as a pre-seeded root). There must be exactly one such attachment —
 * the single point where this conversation's subtree connects to the tree.
 *
 *  - with-skill: the seed files ARE in `nodes` (merged graph), so the genuine
 *    root has parent_id null → exactly one attachment, parent=null.
 *  - vanilla: no MCP/merge, so the seed is external. The agent attaches its
 *    subtree under a seed id it saw on disk → exactly one attachment whose
 *    parent is a seed id. Multiple distinct attachment points (or none) is the
 *    failure: a fragmented forest or a cycle.
 */
function checkTopology(nodes: TreeNode[], externalResolvableIds: Set<string>): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (
      n.parent_id !== null &&
      !byId.has(n.parent_id) &&
      !externalResolvableIds.has(n.parent_id)
    )
      fail(`topic '${n.title}' has dangling parent_id ${n.parent_id}`);
  }
  const attachments = nodes.filter(
    (n) => n.parent_id === null || !byId.has(n.parent_id),
  );
  if (attachments.length !== 1)
    fail(
      `expected exactly 1 top-level attachment (root or single connection to the existing graph), found ${attachments.length} (${attachments
        .map((r) => `'${r.title}'->${r.parent_id ?? "null"}`)
        .join(", ") || "none"})`,
    );
  for (const start of nodes) {
    const seen = new Set<string>();
    let cur: string | null = start.id;
    while (cur !== null) {
      if (seen.has(cur)) fail(`cycle in topic tree at '${start.title}'`);
      seen.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
  }
}

/** Coverage: every non-Irrelevant idea unit referenced once; Irrelevant referenced never. */
function checkCoverage(
  turns: { index: number; idea_units: { index: number; categories: string[] }[] }[],
  itemRefs: { type: string; turn_index: number; idea_unit_index: number }[],
): void {
  const refCount = new Map<string, number>();
  for (const it of itemRefs)
    if (it.type === "idea_unit_ref") {
      const k = `${it.turn_index}:${it.idea_unit_index}`;
      refCount.set(k, (refCount.get(k) ?? 0) + 1);
    }
  for (const turn of turns)
    for (const iu of turn.idea_units) {
      const k = `${turn.index}:${iu.index}`;
      const isIrrelevant =
        iu.categories.length === 1 && iu.categories[0] === "Irrelevant";
      const cnt = refCount.get(k) ?? 0;
      if (isIrrelevant && cnt > 0)
        fail(`Irrelevant idea unit ${k} is referenced by ${cnt} topic(s)`);
      if (!isIrrelevant && cnt !== 1)
        fail(`non-Irrelevant idea unit ${k} referenced ${cnt}x (want exactly 1)`);
    }
}

function checkIndices(turns: { index: number; idea_units: { index: number }[] }[]): void {
  turns.forEach((turn, i) => {
    if (turn.index !== i) fail(`turn[${i}].index = ${turn.index} (want ${i})`);
    turn.idea_units.forEach((iu, k) => {
      if (iu.index !== k)
        fail(`turn[${i}].idea_units[${k}].index = ${iu.index} (want ${k})`);
    });
  });
}

function checkRefs(
  refs: { type: string; conversation_id: string; turn_index: number; idea_unit_index: number }[],
  turnLen: number[],
  convId: string,
  where: string,
): void {
  for (const r of refs) {
    if (r.type !== "idea_unit_ref") continue;
    if (r.conversation_id !== convId)
      fail(`${where}: ref conversation_id ${r.conversation_id} != ${convId}`);
    if (r.turn_index < 0 || r.turn_index >= turnLen.length)
      fail(`${where}: ref turn_index ${r.turn_index} out of range`);
    if (r.idea_unit_index < 0 || r.idea_unit_index >= turnLen[r.turn_index])
      fail(`${where}: ref ${r.turn_index}:${r.idea_unit_index} out of range`);
  }
}

const mode = process.argv[2];
if (mode !== "with-skill" && mode !== "vanilla")
  fail(`unknown mode '${mode}' (expected with-skill | vanilla)`);

const expectedId = contentHashAsUuid(readFileSync(TRANSCRIPT_PATH));

if (mode === "with-skill") {
  // --- canonical artifact: the persisted /app/noesis/ graph ---
  const convFiles = jsonFilesIn(`${NOESIS_DIR}/conversations`);
  const topicFiles = jsonFilesIn(`${NOESIS_DIR}/topics`);
  const decisionFiles = jsonFilesIn(`${NOESIS_DIR}/decisions`);
  if (convFiles.length < 1)
    fail("/app/noesis/conversations/ empty — merge_conversation did not persist");
  if (topicFiles.length < 1) fail("/app/noesis/topics/ empty");

  // 1+2. conversation file: schema + content-hash id
  const conv = ConversationSchema.safeParse(readJson(convFiles[0]));
  if (!conv.success)
    fail(`conversation file schema: ${JSON.stringify(conv.error.issues.slice(0, 4))}`);
  const c = conv.data;
  if (c.conversation_id !== expectedId)
    fail(`conversation_id ${c.conversation_id} != content hash ${expectedId}`);

  // 3. index integrity
  checkIndices(c.turns);

  // 1. topic files schema + 4. topology over the FULL persisted set (incl. seed)
  const topicNodes: TreeNode[] = [];
  const allItemRefs: { type: string; turn_index: number; idea_unit_index: number }[] = [];
  for (const tf of topicFiles) {
    const parsed = TopicFileSchema.safeParse(readJson(tf));
    if (!parsed.success)
      fail(`topic file ${tf} schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    const t = parsed.data;
    topicNodes.push({ id: t.id, parent_id: t.parent_id, title: t.title });
    // 6. workflow flags on persisted topics
    if (!t.reviewed) fail(`persisted topic '${t.title}' has reviewed:false`);
    if (!t.decisions_extracted)
      fail(`persisted topic '${t.title}' has decisions_extracted:false`);
    for (const it of t.items)
      if ((it as { type: string }).type === "idea_unit_ref")
        allItemRefs.push(it as never);
  }
  checkTopology(topicNodes, SEED_TOPIC_IDS);

  // 5. idea-unit <-> topic coverage (only refs into THIS conversation count;
  //    seed topics have no items, prior-conversation refs would carry a
  //    different conversation_id and are excluded).
  const ownRefs = allItemRefs.filter(
    (r) => (r as { conversation_id?: string }).conversation_id === c.conversation_id,
  );
  checkCoverage(c.turns, ownRefs);

  // 1+7. decision files: schema + supporting refs
  const turnLen = c.turns.map((t) => t.idea_units.length);
  for (const df of decisionFiles) {
    const parsed = DecisionFileSchema.safeParse(readJson(df));
    if (!parsed.success)
      fail(`decision file ${df} schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    const d = parsed.data;
    checkRefs(d.context.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' context`);
    checkRefs(d.decision.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' decision`);
    for (const ao of d.alternative_options)
      checkRefs(ao.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' alternative`);
  }

  console.log(
    `VERIFY OK (mode=with-skill, turns=${c.turns.length}, topics=${topicFiles.length}, decisions=${decisionFiles.length}, conversation_id=${c.conversation_id})`,
  );
  process.exit(0);
}

// --- vanilla: validate /app/output.json (no MCP, no merge) ---
if (!existsSync(VANILLA_OUTPUT))
  fail(`vanilla deliverable ${VANILLA_OUTPUT} not found`);
const parsed = AnalyzeConversationOutputSchema.safeParse(readJson(VANILLA_OUTPUT));
if (!parsed.success)
  fail(`output.json schema: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`);
const c = parsed.data.conversation;
if (c.conversation_id !== expectedId)
  fail(`conversation_id ${c.conversation_id} != content hash ${expectedId}`);
checkIndices(c.turns);
// vanilla may attach its tree under a seeded id it saw on disk — resolve those too
checkTopology(
  c.topics.map((t) => ({ id: t.id, parent_id: t.parent_id, title: t.title })),
  SEED_TOPIC_IDS,
);
checkCoverage(
  c.turns,
  c.topics.flatMap((t) => t.items as never[]),
);
for (const t of c.topics) {
  if (!t.reviewed) fail(`topic '${t.title}' has reviewed:false`);
  if (!t.decisions_extracted) fail(`topic '${t.title}' has decisions_extracted:false`);
}
const turnLen = c.turns.map((t) => t.idea_units.length);
for (const t of c.topics)
  for (const d of t.decisions) {
    checkRefs(d.context.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' context`);
    checkRefs(d.decision.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' decision`);
    for (const ao of d.alternative_options)
      checkRefs(ao.supporting_content as never[], turnLen, c.conversation_id, `decision '${d.title}' alternative`);
  }
console.log(
  `VERIFY OK (mode=vanilla, turns=${c.turns.length}, topics=${c.topics.length}, conversation_id=${c.conversation_id})`,
);
process.exit(0);
