# Monitoring Promptfoo Evaluation Progress

## Logi w czasie rzeczywistym

Skrypty wrapper (`claude_exec.js`, `gemini_exec.js`, `codex_exec.js`) teraz logują do stderr:

```
[Claude] Starting evaluation...
[Claude] Prompt preview: Role: You are acting as a Senior Technical Product Manager with deep access to the proj...
[Claude] ✓ Completed in 45.32s (1234 chars)
```

```
[Gemini] Starting evaluation...
[Gemini] Prompt preview: Role: Technical Project Manager / Lead Developer...
[Gemini] ✓ Completed in 38.21s (987 chars)
```

```
[Codex] Starting evaluation...
[Codex] Prompt preview: Role: You are acting as a Senior Technical Product Manager...
[Codex] ✓ Completed in 52.18s (1456 chars)
```

## Co zobaczysz podczas ewaluacji

### 1. Pasek postępu
```
Evaluating [████████░░░░░░░░░░░░░░░░░░░░░░] 33% | 4/12 |
```

### 2. Logi od agentów (stderr)
Każdy wrapper script wypisuje:
- **Starting**: Kiedy agent zaczyna pracę
- **Prompt preview**: Pierwsze 100 znaków prompta
- **Completed**: Czas wykonania i długość odpowiedzi

### 3. Błędy (jeśli wystąpią)
```
Provider call failed during eval
{
  "providerId": "exec:./claude_exec.js",
  "error": { ... }
}
```

## Uruchamianie z dodatkowymi opcjami

### Podstawowe uruchomienie
```bash
promptfoo eval
```

### Z tabelą wyników na końcu
```bash
promptfoo eval --table
```

### Bez paska postępu (tylko logi)
```bash
promptfoo eval --no-progress-bar
```

### Z outputem do pliku
```bash
promptfoo eval --output results.json --output results.html
```

### Ograniczenie do pierwszych N testów (do debugowania)
```bash
promptfoo eval --filter-first-n 2  # Tylko pierwsze 2 testy
```

### Tylko konkretny provider
```bash
promptfoo eval --filter-providers claude  # Tylko Claude
```

## Monitorowanie użycia tokenów

Niestety promptfoo **nie pokazuje** bezpośrednio użycia tokenów dla LLM-as-a-Judge podczas ewaluacji.

Aby zobaczyć zużycie tokenów:

### Opcja 1: Sprawdź w Anthropic Console
1. Otwórz https://console.anthropic.com
2. Przejdź do "Usage" lub "API Keys"
3. Zobacz recent usage

### Opcja 2: Sprawdź w wynikach JSON
```bash
cat promptfoo-results.json | grep -A 5 "tokenUsage"
```

### Opcja 3: Zobacz w Web UI
```bash
promptfoo view
```
Web UI może pokazywać więcej szczegółów niż CLI.

## Szacowanie kosztów

### Koszty per ewaluacja:

**Agenty (Claude/Gemini/Codex):**
- Zależą od providera i modelu
- Claude Code używa modelu z twojej konfiguracji
- Brak bezpośredniego pomiaru w promptfoo

**LLM-as-a-Judge (Claude 3.5 Sonnet):**
- Model: `claude-3-5-sonnet-20241022`
- Koszt: ~$3/million input tokens, ~$15/million output tokens
- Per test: 2 assertions × 2 prompty = 4 judge calls
- Total: 3 providers × 2 tests × 4 assertions = 24 judge calls

Szacowane zużycie tokenów per judge call:
- Input: ~2000 tokens (prompt + response + rubric)
- Output: ~200 tokens (ocena)

**Szacowany koszt dla pełnej ewaluacji:**
- Judge input: 24 × 2000 = 48,000 tokens ≈ $0.14
- Judge output: 24 × 200 = 4,800 tokens ≈ $0.07
- **Total judge cost: ~$0.21**

Agent costs zależą od długości odpowiedzi i modeli.

## Debugowanie problemów

### Agent wisi i nic się nie dzieje
```bash
# Sprawdź czy proces działa
ps aux | grep -E "(claude|gemini|codex)"

# Zabij wisujące procesy
pkill -f claude_exec.js
pkill -f gemini_exec.js
pkill -f codex_exec.js
```

### Brak logów od agentów
Sprawdź czy skrypty są executable:
```bash
ls -la *-exec.js
chmod +x claude_exec.js gemini_exec.js codex_exec.js
```

### Provider error: ENOENT
Agent nie jest zainstalowany lub nie w PATH:
```bash
which claude gemini codex
```

### Timeout errors
Zwiększ timeout w plikach `*-exec.js`:
```javascript
const timeout = 1200000; // 20 minut zamiast 10
```

## Monitorowanie w czasie rzeczywistym

### Obserwuj pliki tymczasowe
```bash
# W osobnym terminalu
watch -n 1 'ls -lh /tmp/*-prompt-*.txt 2>/dev/null'
```

### Tail stderr z ewaluacji
Stderr jest przekierowywany do terminala, więc po prostu obserwuj output podczas `promptfoo eval`.

### Monitoruj procesy
```bash
# W osobnym terminalu
watch -n 2 'ps aux | grep -E "(claude|gemini|codex)" | grep -v grep'
```

## Po zakończeniu ewaluacji

### Zobacz tabelę wyników
```bash
promptfoo view
```

### Sprawdź JSON
```bash
cat promptfoo-results.json | jq '.'
```

### Eksportuj do CSV
```bash
promptfoo eval --output results.csv
```

### Zobacz poprzednie ewaluacje
```bash
ls -la ~/.promptfoo/output/
```

## Tips & Tricks

1. **Uruchom z mniejszą liczbą testów do debugowania:**
   ```bash
   promptfoo eval --filter-first-n 1
   ```

2. **Testuj tylko jednego agenta:**
   ```bash
   promptfoo eval --filter-providers claude
   ```

3. **Wyłącz cache dla czystych testów:**
   ```bash
   promptfoo eval --no-cache
   ```

4. **Zapisz output do wielu formatów:**
   ```bash
   promptfoo eval -o results.json -o results.csv -o results.html
   ```

5. **Kontynuuj przerwane testy:**
   ```bash
   promptfoo eval --resume
   ```
