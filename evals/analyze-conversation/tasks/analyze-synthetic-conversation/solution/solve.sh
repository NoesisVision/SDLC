#!/bin/bash
# Reference solver — for the TOKEN-FREE verifier/MCP smoke only. Never run by a
# normal nasde run (Harbor invokes it only via the OracleAgent, and we drive it
# by hand during the smoke). It does NOT call an LLM.
#
# It exercises the exact with-skill deliverable path:
#   1. run prepare.ts  -> creates the skill working dir + cleaned.md + output.json
#   2. overwrite that output.json with the gold ground_truth/expected_output.json
#   3. drive the real noesis-graph MCP server over stdio to merge_conversation
#   4. leave the merged files under /app/noesis/ for /tests/test.sh to verify
#
# The gold output is expected at /solution/expected_output.json (bind-mounted at
# smoke time; it is NEVER present in the agent's sandbox).

set -eu
PLUGIN=/opt/noesis-plugin
export CLAUDE_PLUGIN_ROOT=/opt/noesis-plugin
export CLAUDE_PLUGIN_DATA=/opt/noesis-data
export NOESIS_PROJECT_DIR=/app
GOLD=/solution/expected_output.json
TRANSCRIPT=/app/transcript.md
TIME="2026-05-18 10:00:00"
MAIN_TOPIC="Parcel locker pickup-code expiry and retry design"

echo "[solve] prepare.ts ..."
cd "$PLUGIN"
PREP_JSON="$(bun run scripts/conversation/prepare.ts "$TRANSCRIPT" "$TIME" "$MAIN_TOPIC")"
echo "[solve] prepare -> $PREP_JSON"
WORKING_DIR="$(echo "$PREP_JSON" | bun -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).working_dir))')"
echo "[solve] working_dir = $WORKING_DIR"

echo "[solve] staging gold output into working dir ..."
cp "$GOLD" "$WORKING_DIR/output.json"

echo "[solve] driving merge_conversation over MCP stdio ..."
# initialize, then call merge_conversation with the working_dir. The server
# reads output.json + cleaned.md from there and writes source files to /app/noesis.
bun -e '
const wd = process.argv[1];
const init = {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"solve",version:"0"}}};
const initd = {jsonrpc:"2.0",method:"notifications/initialized"};
const call = {jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"merge_conversation",arguments:{working_dir:wd}}};
process.stdout.write(JSON.stringify(init)+"\n"+JSON.stringify(initd)+"\n"+JSON.stringify(call)+"\n");
' "$WORKING_DIR" | CLAUDE_PLUGIN_ROOT=/opt/noesis-plugin CLAUDE_PLUGIN_DATA=/opt/noesis-data NOESIS_PROJECT_DIR=/app \
  timeout 120 bun run mcp/noesis-graph/server.ts | tee /tmp/solve-mcp.out

echo "[solve] /app/noesis after merge:"
find /app/noesis -name '*.json' | sort
echo "[solve] done"
