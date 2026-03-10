# Evals

System ewaluacji agentów AI używający [Harbor](https://github.com/harbor-ai/harbor) do uruchamiania triali i [Opik](https://github.com/comet-ml/opik) do śledzenia metryk.

## Struktura

```
evals/
├── eval-platforms/                   # Reusable framework (niezależny od benchmarku)
│   ├── evaluate_architecture.py      # Ewaluator architektury (Claude Code SDK + Opik)
│   ├── atif_parser.py                # Parser trajektorii ATIF
│   ├── import_opik.py                # (deprecated) Import do Opik
│   ├── .env                          # OPIK_API_KEY, OPIK_WORKSPACE
│   └── patches/                      # Patche vendor bibliotek
├── ddd-architectural-challenges/     # Benchmark: DDD/Hexagonal Architecture
│   ├── run-benchmark.sh              # Uruchamia benchmark (Harbor + opcjonalnie Opik/arch eval)
│   ├── tasks/                        # Definicje zadań
│   │   ├── ddd-threshold-discount/
│   │   │   ├── instruction.md
│   │   │   └── architecture_criteria.md   # Kryteria oceny architektury
│   │   └── ddd-weather-discount/
│   │       ├── instruction.md
│   │       └── architecture_criteria.md
│   ├── variants/                     # Konfiguracje agentów
│   └── jobs/                         # Wyniki triali (gitignored)
└── export_oauth_token.sh             # Eksport tokena z macOS Keychain
```

## Vendor patches — podejścia i decyzje

W tym projekcie stosujemy dwa podejścia do łatania bugów w zależnościach. Wybór zależy od charakteru buga.

### Podejście 1: Plik `.patch` (modyfikacja pliku na dysku)

**Jak działa:** `patch` modyfikuje plik źródłowy biblioteki w `.venv/`. Po aplikacji plik jest zmieniony na stałe — do czasu reinstalacji.

**Kiedy stosujemy:** Gdy bug wymaga złożonych zmian w klasie (np. dodanie nowych metod, zmiana `__init__` i `__setattr__` jednocześnie), których nie da się łatwo podmienić z zewnątrz.

**Wady:** Trzeba re-aplikować po każdym `uv sync` / `uv pip install`.

**Przykład:** `opik_harbor_deferred_metrics.patch` — opik 1.10.26 tworzy spany w `Step.__init__`, ale Harbor przypisuje metryki po konstrukcji. Patch dodaje nową funkcję `_create_span_for_step()`, zmienia `__init__` i dodaje `__setattr__` hook. Nie da się tego zrobić runtime monkeypatchem bo wymaga precyzyjnego patchowania kilku powiązanych miejsc w klasie.

```bash
# Aplikacja po reinstalacji opik:
./evals/eval-platforms/patches/apply_opik_patches.sh

# Weryfikacja:
./evals/eval-platforms/patches/apply_opik_patches.sh --check
```

### Podejście 2: Runtime monkeypatch (podmiana w pamięci)

**Jak działa:** Nasz kod Pythona podmienia funkcję/metodę biblioteki przy starcie programu. Plik na dysku się nie zmienia.

**Kiedy stosujemy:** Gdy bug dotyczy jednej pure function, a nasz kod jest jedynym konsumentem. Monkeypatch jest self-contained — nie wymaga osobnego kroku po reinstalacji.

**Wady:** Zależy od wewnętrznej struktury importów biblioteki (trzeba wiedzieć, w którym module podmienić referencję).

**Przykład:** `eval-platforms/evaluate_architecture.py` — claude-code-sdk 0.0.25 rzuca `MessageParseError` na nieznane typy wiadomości (np. `rate_limit_event`), co crashuje cały async stream. Monkeypatch podmienia `parse_message` w module `client` (nie `message_parser` — bo `client.py` importuje funkcję jako local name). Ewaluator jest jedynym konsumentem SDK, więc monkeypatch jest lokalny i bezpieczny.

### Podsumowanie

| Cecha | Plik `.patch` | Runtime monkeypatch |
|-------|---------------|---------------------|
| Przetrwa `uv sync` | Nie — wymaga re-aplikacji | Tak — jest w naszym kodzie |
| Złożoność zmian | Dowolna (diff na pliku) | Tylko zamiana funkcji/metod |
| Ryzyko | Zapomnienie re-aplikacji | Zmiana wewnętrznej struktury importów |
| Przykład | opik `Step.__init__`+`__setattr__` | claude-code-sdk `parse_message` |

## Uruchamianie benchmarku

```bash
# Tylko benchmark (Harbor)
./evals/ddd-architectural-challenges/run-benchmark.sh with-mcp

# Benchmark + Opik tracking
./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik with-mcp

# Benchmark + Opik + ewaluacja architektury
./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik --with-arch-eval with-mcp

# Standalone ewaluacja architektury na istniejącym trialu
uv run python evals/eval-platforms/evaluate_architecture.py \
    --trial-dir evals/ddd-architectural-challenges/jobs/<ts>/<trial> --with-opik
```

## Weryfikacja wyników w Opik (REST API)

```bash
# Lista traces z feedback scores
curl -s \
    -H "authorization: $OPIK_API_KEY" \
    -H "Comet-Workspace: $OPIK_WORKSPACE" \
    "https://www.comet.com/opik/api/v1/private/traces?project_name=ddd-architectural-challenges&limit=5" \
    | python3 -m json.tool

# Konkretny trace
curl -s \
    -H "authorization: $OPIK_API_KEY" \
    -H "Comet-Workspace: $OPIK_WORKSPACE" \
    "https://www.comet.com/opik/api/v1/private/traces/<trace-id>?project_name=ddd-architectural-challenges" \
    | python3 -m json.tool
```

Header autoryzacji to `authorization: <OPIK_API_KEY>` (nie `Comet-Api-Key`).
