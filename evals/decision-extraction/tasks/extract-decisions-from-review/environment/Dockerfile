FROM python:3.12-slim

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app/repo
RUN git clone https://github.com/itlibrium/DDD-starter-dotnet.git .

WORKDIR /app
RUN mkdir -p /app/output/decisions

CMD ["/bin/bash"]
