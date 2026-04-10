import sys
from pathlib import Path

# PEP 723 scripts use bare imports (e.g. `from models import ...`).
# Add their directories to sys.path so both pytest CLI and IDE test runners resolve them.
_REPO = Path(__file__).resolve().parent.parent
_EXTRA_PATHS = [
    _REPO / "src" / "agent_extensions" / "plugins" / "noesis" / "scripts",
    _REPO / "tests" / "agent_extensions" / "plugins" / "noesis" / "scripts",
]
for _p in _EXTRA_PATHS:
    _s = str(_p)
    if _s not in sys.path:
        sys.path.insert(0, _s)
