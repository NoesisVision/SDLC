# Find Topics

Find existing topics in the knowledge graph that match a given query. Uses hierarchical search — evaluates root topics first, then drills into subtopics. Returns the most accurately matching topics (not too broad, not too narrow).

## Input

- `<query>` — short topic or problem description.
- `<working_dir>` — path to the working directory for this analysis.

## Workflow

### Step 1: Evaluate root topics

1. Call MCP tool `noesis-graph:list_topics` with no `parent_topic_id`. The response is a small JSON `{ "file": "<path>.md", ... }`. Read the file path it returned with the Read tool. The file is Markdown with one `##` section per topic (id, path, has_subtopics, short/long summary).
2. For each returned topic, evaluate whether its title and short summary are potentially related to `<query>`.
3. If **none** are potentially related, save an empty result (see Step 3) and stop.
4. Collect IDs of all potentially related root topics.

### Step 2: Drill into subtopics (recursive)

For each potentially related topic from the previous step:

1. If `has_subtopics` is `no`, keep this topic as a candidate and move on.
2. If `has_subtopics` is `yes`, call MCP tool `noesis-graph:list_topics` with `parent_topic_id: <topic_id>`, then read the file path returned in the response with the Read tool.
3. Evaluate children against `<query>`:
   - If **some children match more accurately** than the parent, drop the parent and recurse into those children (repeat from sub-step 1 for each).
   - If **no children match better** than the parent, keep the parent as a candidate (it is the right granularity level).

### Step 3: Save results

Build a `PotentialTopics` JSON object with:
- `topics` — list of candidate objects, each with `id`, `title`, `short_summary`, `path`.

Write the JSON to `{working_dir}/potential_topics_tmp.json` using the Write tool, then run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/topics/save-potential-topics.ts <working_dir> {working_dir}/potential_topics_tmp.json`

If no candidates were found, write `{"topics": []}` to the file.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly with `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/<path>.ts`.
- NEVER use Bash (`cat`, `echo`, heredoc, redirect) to write files. Use the Write tool for JSON inputs that scripts read.
- Query the knowledge graph ONLY via `noesis-graph:list_topics` / `noesis-graph:read_topic` MCP tools. Both return a tmp file path in their JSON response — always read that file with the Read tool to see the actual content.
- NEVER write inline code in Bash. Use only the provided scripts.
- Write only temporary JSON files (e.g. `potential_topics_tmp.json`) via the Write tool — scripts handle validation and persistence.
- Prefer precision over recall. A smaller list of accurate matches is better than a broad list of vague ones.
- A mid-level topic can be the best answer. Do not always drill to leaves.
- Use the `path` field to understand hierarchy context when judging "too broad vs too narrow."
