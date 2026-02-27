# DDD Architectural Challenges - Private Benchmark

A Harbor-compatible benchmark for evaluating AI coding agents' ability to work with complex Domain-Driven Design (DDD) architectures.

## Overview

This benchmark tests whether an AI agent can:
- Understand and navigate a complex DDD/Hexagonal Architecture codebase
- Implement new features that require external API integration
- Identify when architectural refactoring is needed for extensibility
- Follow DDD tactical patterns appropriately
- Write comprehensive tests

## Structure

```
my-private-bench/
├── local-registry.json          # Harbor registry configuration
├── dataset.json                 # Dataset metadata
├── run-benchmark.sh             # Convenience script to run the benchmark
└── tasks/
    └── ddd-weather-discount/    # Weather-based discount challenge
        ├── task.json            # Task metadata
        ├── instruction.md       # Instructions for the AI agent
        ├── environment/
        │   └── Dockerfile       # Environment setup
        └── eval/
            └── eval.sh          # Evaluation script
```

## Task: Weather-Based Discount

**Difficulty**: Advanced
**Estimated Time**: 90 minutes
**Source**: [DDD-starter-dotnet](https://github.com/itlibrium/DDD-starter-dotnet)

### Challenge

Implement a weather-based discount feature that:
- Uses the Open-Meteo API to check weather conditions
- Applies 10% discount when precipitation > 0
- **Must be designed for extensibility** - many similar external-API-dependent discounts will follow
- Fits harmoniously into the existing DDD architecture

### Key Evaluation Criteria

1. **Compilation**: `dotnet build` succeeds
2. **Tests**: `dotnet test` passes (agent must write tests)
3. **Implementation**: Weather API integration is present
4. **Architecture**: Solution respects DDD/Hexagonal Architecture principles
5. **Extensibility**: Design makes adding similar features easy

### What Makes This Challenging

- The existing codebase has a **hardcoded discount chain** that needs refactoring
- Agent must identify this limitation without explicit hints
- Requires understanding of:
  - DDD tactical patterns (Policies, Domain Services, Value Objects)
  - Hexagonal Architecture (Ports & Adapters)
  - When to refactor vs. extend
  - Async external API integration in domain layer

## Running the Benchmark

### Prerequisites

```bash
# Install Harbor CLI (adjust based on actual Harbor installation)
pip install harbor-cli
# or
cargo install harbor
```

### Quick Start

```bash
# Make the script executable (if not already)
chmod +x run-benchmark.sh

# Run the benchmark
./run-benchmark.sh
```

### Manual Execution

```bash
# Run Harbor with local registry
harbor run \
  --registry-path ./my-private-bench/local-registry.json \
  --dataset ddd-architectural-challenges \
  --task ddd-weather-discount \
  --verbose
```

## Environment

- **Base Image**: `mcr.microsoft.com/dotnet/sdk:8.0`
- **Language**: C#
- **Framework**: .NET 8
- **Architecture**: Hexagonal Architecture / Clean Architecture
- **Testing**: xUnit, FluentAssertions, BDD-toolkit

## Evaluation Process

The evaluation script (`eval.sh`) performs the following checks:

1. **Build Verification**: Ensures the solution compiles
2. **Test Execution**: Runs all tests and verifies they pass
3. **API Integration Check**: Searches for Open-Meteo API URL in source code
4. **Feature Verification**: Confirms weather-related implementation exists

Exit code `0` = Success
Exit code `1` = Failure (with detailed error message)

## Design Philosophy

This benchmark intentionally:
- **Does NOT provide implementation hints** - agent must discover architectural needs
- **Requires both implementation and refactoring** - tests real-world scenarios
- **Emphasizes extensibility over quick fixes** - evaluates design thinking
- **Uses real, non-trivial codebase** - no toy examples

## Expected Agent Behavior

A successful agent should:
1. Explore the existing codebase structure
2. Identify the `OfferModifiers` factory pattern
3. Recognize the hardcoded chain as an extensibility bottleneck
4. Design a configurable/pluggable modifier system
5. Implement the weather discount as one instance of that system
6. Write comprehensive tests (unit + integration)
7. Handle errors gracefully (API failures)

## Future Enhancements

Potential additions to this benchmark suite:
- Stock market-based discount
- Air quality-based discount
- Multi-discount coordination (what if multiple external conditions apply?)
- Performance optimization challenge (caching, rate limiting)

## License

This benchmark is based on the [DDD-starter-dotnet](https://github.com/itlibrium/DDD-starter-dotnet) project, which is licensed under the MIT License.

## Contributing

This is a private benchmark for internal evaluation. Adjust Harbor CLI commands based on your specific Harbor installation and version.
