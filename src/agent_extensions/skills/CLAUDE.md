# Skills guidelines

## Python scripts

1. Every Python script in a skill must declare its third-party dependencies inline using [PEP 723](https://peps.python.org/pep-0723/) script metadata. These scripts are executed by AI agents without access to the repository's `pyproject.toml`.
2. Always run scripts with `uv run --script script.py` (NOT `uv run python script.py`). The `--script` flag tells `uv` to parse PEP 723 inline metadata and install declared dependencies automatically.

```python
# /// script
# dependencies = [
#     "some-package",
# ]
# ///
```
