# Skills guidelines

## Python scripts

1. Every Python script in a skill must declare its third-party dependencies inline using [PEP 723](https://peps.python.org/pep-0723/) script metadata. These scripts are executed by AI agents without access to the repository's `pyproject.toml`.
2. If a script uses a function or classes from the other file, all third-party dependencies of that file MUST be present also in the parent file.
3. Always run scripts with `uv run script.py` (NOT `uv run python script.py`). `uv` automatically detects PEP 723 inline metadata and installs declared dependencies.

```python
# /// script
# dependencies = [
#     "some-package",
# ]
# ///
```
