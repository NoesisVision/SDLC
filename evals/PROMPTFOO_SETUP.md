# Promptfoo Evaluation Setup for Coding Agents

This repository contains a promptfoo configuration to evaluate and compare three coding agents:
- **Claude Code** (Anthropic)
- **Gemini CLI** (Google)
- **Codex** (OpenAI)

## Overview

The evaluation tests how well each agent can act as a Senior Technical Product Manager, answering complex questions about:
1. **Real Grid Elements Resizing** - Technical feature overview and implementation details
2. **Messaging Backend** - Comprehensive status update including ownership, architecture, and task tracking

## Prerequisites

### 1. Install Promptfoo

```bash
npm install -g promptfoo
```

### 2. Install Coding Agents

Ensure you have the following CLI tools installed:
- `claude` - Claude Code CLI
- `gemini` - Gemini CLI
- `codex` - Codex CLI

Verify installation:
```bash
which claude gemini codex
```

### 3. Set Up Anthropic API Key

The evaluation uses Claude 3.5 Sonnet as the LLM judge. Set your API key:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Add this to your `~/.bashrc` or `~/.zshrc` for persistence:
```bash
echo 'export ANTHROPIC_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

## Configuration Files

### Main Configuration
- `promptfooconfig.yaml` - Main promptfoo configuration with test cases and LLM-as-Judge metrics

### Wrapper Scripts
Non-interactive execution wrappers for each agent:
- `claude-wrapper.sh` - Claude Code wrapper
- `gemini-wrapper.sh` - Gemini CLI wrapper
- `codex-wrapper.sh` - Codex wrapper

These scripts ensure agents:
- Run in non-interactive mode
- Complete work without user input
- Have appropriate timeouts (10 minutes default)
- Handle errors gracefully

## Running the Evaluation

### Basic Usage

Run all tests:
```bash
promptfoo eval
```

View results in the web UI:
```bash
promptfoo view
```

### Advanced Options

Run a specific test:
```bash
promptfoo eval -f promptfooconfig.yaml
```

Run with verbose output:
```bash
promptfoo eval --verbose
```

Run only specific providers:
```bash
promptfoo eval --providers exec:claude-code
```

## Test Cases

### Test 1: Real Grid Elements Resizing

**Expected Key Facts:**
- **Ownership**: Developed by Szymon Janikowski
- **Core Logic**: Dynamic calculation based on user rights and element state
- **Architecture**: Separation between Page Template and Real Grid Elements
- **Integration**: Architecturally separated module with dedicated unit tests

### Test 2: Messaging Backend Status

**Expected Key Facts:**
- **Concept**: Led by Szymon Janikowski and Paweł Gilewski
- **Implementation**:
  - PRIINT-12423: Krzysztof Pawlak (Database schema)
  - PRIINT-12424: Marek Lenart (Implementation)
- **Architecture**: Message Queue rejected due to complexity
- **Tickets**:
  - Epic: PRIINT-12404
  - Implemented: PRIINT-12423
  - In Testing: PRIINT-12424
  - Backlog: ~11 tickets
- **Design**: Figma references

## Evaluation Metrics

The configuration uses **LLM-as-a-Judge** with Claude 3.5 Sonnet to evaluate responses based on:

### Factual Accuracy
- Does the response include the expected key facts?
- Are specific names, ticket numbers, and dates correct?
- Does it avoid hallucinating information?

### Completeness
- Does it cover all required information areas?
- Does it provide specific, verifiable details?
- Does it reference actual documentation/code?

### Technical Quality
- Is the technical explanation clear and detailed?
- Does it demonstrate actual codebase access?
- Does it accurately represent project status?

## Interpreting Results

### Score Breakdown
Each test case has multiple assertions evaluated by the LLM judge. Scores range from 0-1:
- **0.9-1.0**: Excellent - All key facts present and accurate
- **0.7-0.8**: Good - Most key facts present, minor omissions
- **0.5-0.6**: Fair - Some key facts present, significant gaps
- **0.0-0.4**: Poor - Missing critical information or hallucinations

### Comparison View
The promptfoo web UI shows:
- Side-by-side comparison of all agent responses
- Individual scores for each metric
- Overall ranking across agents
- Response time and completion status

## Troubleshooting

### Agents Not Running in Non-Interactive Mode

If agents request user input, check:
1. Wrapper scripts are executable: `chmod +x *.sh`
2. Agent CLI flags for non-interactive mode (varies by tool)
3. Timeout settings in wrapper scripts (default 600s)

### LLM Judge Errors

If the Anthropic API fails:
1. Verify API key: `echo $ANTHROPIC_API_KEY`
2. Check API quota and rate limits
3. Ensure network connectivity

### Missing Expected Information

If agents consistently miss expected facts:
1. Verify the information exists in the codebase
2. Check documentation paths and file locations
3. Review git history and commit messages
4. Ensure Jira ticket references are in code/docs

## Customization

### Adding New Test Cases

Edit `promptfooconfig.yaml` and add to the `tests` section:

```yaml
tests:
  - description: "Your new test"
    vars:
      prompt: "Your test prompt"
    assert:
      - type: llm-rubric
        value: |
          Evaluation criteria here
        provider: anthropic:messages:claude-3-5-sonnet-20241022
```

### Adjusting Timeouts

Edit wrapper scripts and change the timeout parameter:
```bash
TIMEOUT="${2:-600}"  # Change 600 to desired seconds
```

### Using Different LLM Judges

Replace the provider in assertions:
```yaml
provider: openai:gpt-4  # Or other supported models
```

## Output Files

- `promptfoo-results.json` - Detailed evaluation results
- `.promptfoo/` - Cache and evaluation history

## Best Practices

1. **Run in Clean Environment**: Ensure no uncommitted changes that might confuse agents
2. **Consistent Prompts**: Keep prompts focused and specific
3. **Regular Updates**: Update expected facts as the codebase evolves
4. **Baseline Runs**: Run periodically to track agent performance over time
5. **Document Changes**: Update this guide when modifying test cases

## Further Reading

- [Promptfoo Documentation](https://promptfoo.dev/docs)
- [LLM-as-Judge Best Practices](https://promptfoo.dev/docs/guides/llm-as-judge)
- [Exec Provider Documentation](https://promptfoo.dev/docs/providers/exec)

## Support

For issues with:
- **Promptfoo**: https://github.com/promptfoo/promptfoo/issues
- **This configuration**: Contact the repository maintainers