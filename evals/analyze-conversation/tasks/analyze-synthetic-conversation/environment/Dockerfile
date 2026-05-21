# Build context is THIS environment/ directory (Harbor sets context = task
# environment dir). All COPY sources are relative to environment/.
#
# nasde-toolkit (>=0.4.0) with [nasde.plugin] in task.toml automatically appends
# a fenced stage to this Dockerfile that stages and builds the live noesis
# plugin into the image, registers its skills for the agent, and injects its
# MCP server into task.toml. We DO NOT hand-wire those things here.
#
# oven/bun:1-debian: bun preinstalled, glibc present (the lbug / Kuzu native
# binding does not work on musl/Alpine). bun is needed by the plugin stage
# nasde appends below.
FROM oven/bun:1-debian

# git + curl: general agent tooling. python3: tests/test.sh uses it for JSON
# checks. build-essential: fallback toolchain in case lbug has no prebuilt
# linux-x64 binary and needs node-gyp at install time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git curl ca-certificates python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# --- Agent workspace ---
# /app/noesis/ is the project graph dir (NOESIS_PROJECT_DIR=/app). It is
# PRE-SEEDED with two topics so the analyze-conversation skill's Step-2
# Goldilocks search has an existing tree to reuse instead of starting empty.
WORKDIR /app
RUN mkdir -p /app/noesis/topics
COPY seed/noesis/topics/ /app/noesis/topics/

# The transcript is fixed, deterministic task input (its content hash IS the
# conversation_id) — identical for every variant and run. nasde does not stage
# task input files into the sandbox; Harbor delivers instruction.md as the
# agent prompt, but the transcript is a file the agent must read, so it is
# baked here. Keep environment/transcript.md byte-identical to
# tasks/.../transcript.md or the conversation_id / ground truth drift.
COPY transcript.md /app/transcript.md
CMD ["/bin/bash"]
