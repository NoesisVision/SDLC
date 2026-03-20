# Evals

Benchmark for the `extract_decisions` skill — extracts software design decisions from team conversation transcripts.

Uses [nasde-toolkit](../nasde-toolkit/) for benchmark orchestration (Harbor + LLM-as-a-Judge assessment + Opik tracking).

## Quick start

```bash
# Install nasde-toolkit (once)
uv tool install path/to/nasde-toolkit

# Run benchmark with default variant
nasde run -C evals/decision-extraction

# Run with Opik tracking
nasde run --variant with-skill --with-opik -C evals/decision-extraction

# Re-evaluate existing results
nasde eval evals/decision-extraction/jobs/<timestamp> -C evals/decision-extraction --with-opik
```

## Variants

| Variant | Description |
|---------|-------------|
| `vanilla` | Baseline — agent extracts decisions without the skill |
| `with-skill` | Agent uses `extract_decisions` skill with subagent workflow |

## Assessment dimensions

| Dimension | Max score | Description |
|-----------|-----------|-------------|
| Completeness | 25 | Finding all major decisions with full detail |
| Accuracy | 25 | Correct decisions with faithful rationale and speaker attribution |
| Structure Quality | 25 | Well-formed JSON with clear context, rationale, consequences |
| Context Relevance | 25 | Correct codebase references and technical context |

## Opik verification

After runs with `--with-opik`, verify results via REST API (credentials in `.env`):

```python
python3 -c "
import urllib.request, json

req = urllib.request.Request(
    'https://www.comet.com/opik/api/v1/private/traces?project_name=decision-extraction&limit=1',
    headers={
        'authorization': '<OPIK_API_KEY>',
        'Comet-Workspace': '<OPIK_WORKSPACE>',
    },
)
resp = json.loads(urllib.request.urlopen(req).read())
trace = resp['content'][0]
print(f'Trace: {trace[\"name\"]}')
for s in sorted(trace.get('feedback_scores', []), key=lambda x: x['name']):
    print(f'  {s[\"name\"]}: {s[\"value\"]}')
"
```
