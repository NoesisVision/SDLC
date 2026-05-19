# Build context is THIS environment/ directory (Harbor sets context = task
# environment dir). All COPY sources are relative to environment/.
#
# oven/bun:1-debian: bun preinstalled, glibc present (the lbug / Kuzu native
# binding does not work on musl/Alpine).
FROM oven/bun:1-debian

# git + curl: general agent tooling. python3: tests/test.sh uses it for JSON
# checks. build-essential: fallback toolchain in case lbug has no prebuilt
# linux-x64 binary and needs node-gyp at install time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git curl ca-certificates python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# --- Bake the noesis plugin (frozen snapshot) at a fixed path ---
ENV NOESIS_PLUGIN_ROOT=/opt/noesis-plugin
COPY _plugin-staging/ ${NOESIS_PLUGIN_ROOT}/

# Install deps at BUILD time so the lbug native binding compiles here, not
# during the (timed) agent run.
WORKDIR ${NOESIS_PLUGIN_ROOT}
RUN bun install --frozen-lockfile

# Per-project plugin data dir. The noesis-graph MCP server requires
# CLAUDE_PLUGIN_DATA (set in task.toml [environment.mcp_servers] wrapper too).
ENV CLAUDE_PLUGIN_DATA=/opt/noesis-data
RUN mkdir -p ${CLAUDE_PLUGIN_DATA}

# --- Agent workspace ---
# /app/noesis/ is the project graph dir (NOESIS_PROJECT_DIR=/app). It is
# PRE-SEEDED with two topics so the analyze-conversation skill's Step-2
# Goldilocks search has an existing tree to reuse instead of starting empty.
WORKDIR /app
RUN mkdir -p /app/noesis/topics
COPY seed/noesis/topics/ /app/noesis/topics/

# The transcript is fixed, deterministic task input (its content hash IS the
# conversation_id) — identical for every variant and run. nasde only stages
# variants/<name>/CLAUDE.md + skills/ into the sandbox; it does NOT stage task
# files. Harbor delivers instruction.md as the agent prompt, but the transcript
# is a file the agent must read, so it is baked here (same rationale as the
# pre-seeded topics above). Keep environment/transcript.md byte-identical to
# tasks/.../transcript.md or the conversation_id / ground truth drift.
COPY transcript.md /app/transcript.md

# NOTE: no `bun build` static-bundle smoke here. The noesis-graph server runs
# via `bun run server.ts` (runtime, lazy module resolution). NestJS lazily
# `loadPackage`s optional peers (class-validator, class-transformer,
# @nestjs/microservices, @fastify/static) only when those features are used —
# the server uses none, so they are intentionally NOT installed. `bun build`
# resolves every import path statically and would false-fail on them. The
# authoritative build-time gate is `bun install --frozen-lockfile` above; the
# real boot check is the token-free runtime MCP stdio smoke (run post-build),
# which exercises the actual `bun run` path.

CMD ["/bin/bash"]
