# Sandbox for the Noesis variant of the threshold-discount-extraction task.
#
# Layers:
#   1. Ubuntu base + apt deps (jq, curl, ca-certs, python3 for prepare.ts).
#   2. Bun install (cached unless the install URL changes).
#   3. Plugin source copy (re-runs only when plugin sources change).
#   4. bun install + plugin registration (re-runs only when sources change).
#
# The noesis-graph MCP server is started by Harbor via the [[environment.mcp_servers]]
# entry in task.toml: `cd /opt/noesis-plugin && bun run mcp/noesis-graph/server.ts`.
# The skill is registered as a Claude Code plugin under /root/.claude/plugins/noesis/.

# ubuntu:24.04 ships GLIBC 2.39 — required by `lbug` (ladybug-db) native module.
# Older ubuntu:22.04 has GLIBC 2.35 and fails to dlopen lbugjs.node.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    jq \
    curl \
    ca-certificates \
    python3 \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun. We pin a version to keep builds reproducible.
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
ENV PATH="/usr/local/bin:${PATH}"
RUN bun --version

# Plugin sources are staged into ./_plugin-staging/ next to this Dockerfile by
# the prepare-context.sh helper before `nasde run` is invoked. Harbor's docker
# build context is the directory containing this Dockerfile, so a relative COPY
# is the only portable way to pull plugin sources in.
#
# .dockerignore (sibling file) excludes node_modules, .serena, noesis/ scratch
# dirs and other host-only artefacts so the COPY stays small (~6 MB).
COPY _plugin-staging/ /opt/noesis-plugin/

WORKDIR /opt/noesis-plugin
RUN bun install --production --frozen-lockfile

# Register the plugin so Claude Code in the sandbox finds the noesis:analyze-design-draft skill.
# Claude Code looks for plugins under ~/.claude/plugins/<name>/ with a .claude-plugin/plugin.json manifest.
RUN mkdir -p /root/.claude/plugins && \
    ln -s /opt/noesis-plugin /root/.claude/plugins/noesis && \
    ls /root/.claude/plugins/noesis/.claude-plugin/

# CLAUDE_PLUGIN_ROOT is referenced by SKILL.md scripts at runtime — set it so
# any "${CLAUDE_PLUGIN_ROOT}/..." path inside the skill resolves correctly.
ENV CLAUDE_PLUGIN_ROOT=/opt/noesis-plugin

# Workdir where the agent will operate. The skill will write Design Doc JSON
# under /app/noesis/design-docs/ via save_design_doc.
WORKDIR /app
RUN mkdir -p /app/noesis/design-docs /app/noesis/conversations /app/noesis/documents /app/noesis/topics /app/noesis/decisions /app/noesis/design-drafts

# Clone the target codebase so the agent (and the noesis-graph scan_to_tmp tool)
# can verify what is already implemented. The skill's Step 6 expects the diff
# baseline to be the implemented codebase. Without the repo the agent cannot
# tell that the existing `Sales` BC, `Sales.Pricing.Discounts` module and
# the `Discount` / `PercentageDiscount` / `ValueDiscount` value objects already
# exist — and therefore must be classified as `modified` rather than `added`.
RUN git clone --depth 1 https://github.com/itlibrium/DDD-starter-dotnet.git /app/repo

CMD ["/bin/bash"]
