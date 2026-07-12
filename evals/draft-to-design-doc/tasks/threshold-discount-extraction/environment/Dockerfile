# Draft → Design Doc extraction — sandbox for vanilla / guided variants.
#
# Includes the DDD-starter-dotnet repo at /app/repo so the agent can verify what
# already exists in code (e.g. the existing `Discount`, `PercentageDiscount`,
# `ValueDiscount` value objects in `Sources/Sales/Sales.DeepModel/Pricing/Discounts/`).
# This is needed for the agent to correctly classify the BC + module + existing BBs
# as `modified` rather than `added` in the produced Design Doc.
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    jq \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/itlibrium/DDD-starter-dotnet.git /app/repo
RUN mkdir -p /app/output

CMD ["/bin/bash"]
