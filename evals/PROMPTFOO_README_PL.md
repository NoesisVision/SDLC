# Konfiguracja Promptfoo - Ewaluacja Agentów Kodujących

## 🎯 Przegląd

Została stworzona kompletna konfiguracja promptfoo do porównywania trzech agentów kodujących:
- **Claude Code** (Anthropic) - używa flagi `--print --dangerously-skip-permissions`
- **Gemini CLI** (Google) - używa flagi `--yolo --output-format text`
- **Codex** (OpenAI) - używa subkomendy `exec`

Wszystkie agenty są wywoływane w trybie **nieinteraktywnym** i mogą ukończyć pracę bez potrzeby odpowiedzi od użytkownika.

## 📁 Utworzone Pliki

### Główne pliki konfiguracyjne:
- **`promptfooconfig.yaml`** - Główna konfiguracja z testami i metrykami LLM-as-a-Judge
- **`PROMPTFOO_SETUP.md`** - Szczegółowa dokumentacja w języku angielskim
- **`PROMPTFOO_README_PL.md`** - Ten plik (dokumentacja po polsku)

### Skrypty exec (Node.js wrappers):
- **`claude_exec.js`** - Wrapper dla Claude Code (używa `claude --print`)
- **`gemini_exec.js`** - Wrapper dla Gemini CLI (używa `gemini --yolo`)
- **`codex_exec.js`** - Wrapper dla Codex (używa `codex exec`)

### Inne:
- **`run_evaluation.sh`** - Skrypt do łatwego uruchamiania ewaluacji
- **`.gitignore`** - Zaktualizowany o wyniki promptfoo

## 🚀 Szybki Start

### 1. Instalacja Promptfoo

```bash
npm install -g promptfoo
```

### 2. Sprawdź czy masz zainstalowane CLI agentów

```bash
which claude gemini codex
```

Wszystkie trzy komendy powinny zwrócić ścieżki do programów.

### 3. Ustaw Klucz API Anthropic

Konfiguracja używa Claude 3.5 Sonnet jako LLM-as-a-Judge:

```bash
export ANTHROPIC_API_KEY="twój-klucz-api"
```

Dodaj do `~/.zshrc` aby było permanentne:
```bash
echo 'export ANTHROPIC_API_KEY="twój-klucz-api"' >> ~/.zshrc
source ~/.zshrc
```

### 4. Uruchom Ewaluację

Najprościej:
```bash
./run_evaluation.sh
```

Lub bezpośrednio:
```bash
promptfoo eval
```

### 5. Zobacz Wyniki

```bash
promptfoo view
```

Lub:
```bash
./run_evaluation.sh --view-only
```

## 📋 Pytania Testowe

### Pytanie 1: Real Grid Elements Resizing

**Rola**: Senior Technical Product Manager
**Zadanie**: Szczegółowy przegląd techniczny funkcji "Real Grid Elements Resizing"

**Wymagane informacje:**
- Feature Overview & Ownership (właściciel, funkcjonalność, timeline)
- Documentation & Assets (mockupy, specyfikacje)
- Logic & Implementation (reguły, integracja z architekturą)

**Oczekiwane elementy w odpowiedzi:**
- **Ownership**: Szymon Janikowski
- **Logika**: Dynamiczne obliczenia oparte o prawa użytkownika i stan elementów
- **Architektura**: Separacja między Page Template a Real Grid Elements
- **Integracja**: Oddzielny moduł z dedykowanymi testami jednostkowymi

### Pytanie 2: Messaging Backend

**Rola**: Technical Project Manager / Lead Developer
**Zadanie**: Kompleksowy raport statusu implementacji messaging backend

**Wymagane informacje:**
1. Ownership & Responsibility (concept, implementacja, code review)
2. Architecture & Documentation (wybrana architektura, uzasadnienie, dokumentacja)
3. Task Tracking (zaimplementowane tickety, planowane, backlog)
4. References to design (referencje do designu)

**Oczekiwane elementy w odpowiedzi:**
- **Concept**: Szymon Janikowski i Paweł Gilewski
- **Implementacja**:
  - PRIINT-12423: Krzysztof Pawlak (schemat bazy danych)
  - PRIINT-12424: Marek Lenart (implementacja)
- **Architektura**: Odrzucenie Message Queue z powodu złożoności (uzasadnienie w dokumencie Pawła Gilewskiego)
- **Tickety**:
  - Epic: PRIINT-12404
  - Zaimplementowane: PRIINT-12423
  - W testach: PRIINT-12424
  - Backlog: ~11 ticketów
- **Design**: Referencje do Figma

## 🎯 Metryki LLM-as-a-Judge

Konfiguracja wykorzystuje **Claude 3.5 Sonnet** (model `claude-3-5-sonnet-20241022`) jako sędziego do oceny odpowiedzi według:

### Dokładność faktyczna (Factual Accuracy)
- Czy odpowiedź zawiera oczekiwane fakty?
- Czy nazwy, numery ticketów i daty są poprawne?
- Czy agent unika halucynacji?

### Kompletność (Completeness)
- Czy pokrywa wszystkie wymagane obszary?
- Czy podaje konkretne, weryfikowalne szczegóły?
- Czy odnosi się do prawdziwej dokumentacji/kodu?

### Jakość techniczna (Technical Quality)
- Czy wyjaśnienie techniczne jest jasne i szczegółowe?
- Czy wykazuje rzeczywisty dostęp do kodu?
- Czy dokładnie przedstawia status projektu?

## 📊 Interpretacja Wyników

### Skala ocen (0-1):
- **0.9-1.0**: Doskonale - Wszystkie kluczowe fakty obecne i dokładne
- **0.7-0.8**: Dobrze - Większość faktów obecna, drobne braki
- **0.5-0.6**: Średnio - Niektóre fakty obecne, znaczące luki
- **0.0-0.4**: Słabo - Brak krytycznych informacji lub halucynacje

### Widok porównawczy w UI:
- Porównanie odpowiedzi wszystkich agentów obok siebie
- Indywidualne wyniki dla każdej metryki (każde pytanie ma 2 metryki)
- Ogólny ranking agentów
- Czas odpowiedzi i status ukończenia

## 🔧 Szczegóły Techniczne

### Jak działają wrappery

Każdy plik `*-exec.js` to skrypt Node.js który:
1. Czyta prompt ze stdin
2. Zapisuje go do tymczasowego pliku w `/tmp`
3. Wywołuje odpowiedni CLI agent z poprawnymi flagami:
   - **Claude**: `claude --print --dangerously-skip-permissions`
   - **Gemini**: `gemini --yolo --output-format text`
   - **Codex**: `codex exec`
4. Zwraca output do promptfoo
5. Czyści pliki tymczasowe

### Tryb Nieinteraktywny

Flagi użyte w skryptach:
- **Claude `--print`**: Wypisz odpowiedź i zakończ (bez interactive mode)
- **Claude `--dangerously-skip-permissions`**: Pomiń dialogi o permissions (używaj tylko w zaufanych katalogach!)
- **Gemini `--yolo`**: Automatycznie akceptuj wszystkie akcje (bez promptów)
- **Gemini `--output-format text`**: Zwróć czysty tekst (nie JSON)
- **Codex `exec`**: Subkomenda dla trybu nieinteraktywnego

### Timeouts

Wszystkie skrypty mają:
- **Timeout Node.js**: 600000ms (10 minut)
- **Max Buffer**: 10MB na output

## 🛠️ Troubleshooting

### Problem: `ENOENT: spawn claude`

**Przyczyna**: CLI nie jest w PATH
**Rozwiązanie:**
```bash
which claude  # Sprawdź czy jest zainstalowany
# Jeśli nie ma, zainstaluj lub dodaj do PATH
```

### Problem: Błąd API Anthropic

**Przyczyna**: Brak klucza API lub quota
**Rozwiązanie:**
```bash
echo $ANTHROPIC_API_KEY  # Sprawdź czy klucz jest ustawiony
# Sprawdź quota na https://console.anthropic.com
```

### Problem: Timeout podczas ewaluacji

**Przyczyna**: Agenty potrzebują więcej czasu
**Rozwiązanie:** Edytuj `*-exec.js` i zwiększ timeout:
```javascript
const timeout = 1200000; // Zmień na 20 minut
```

### Problem: Brakujące informacje w odpowiedziach

**Możliwe przyczyny:**
- Informacje nie istnieją w repozytorium
- Dokumentacja jest w innej lokalizacji
- Tickety Jira nie są w kodzie/dokumentacji
- Agent nie ma dostępu do potrzebnych plików

**Rozwiązanie:** Sprawdź czy oczekiwane dane faktycznie są w repo:
```bash
grep -r "PRIINT-12423" .
grep -r "Szymon Janikowski" .
```

### Problem: Permission denied na plikach

**Przyczyna**: Skrypty nie są executable
**Rozwiązanie:**
```bash
chmod +x claude_exec.js gemini_exec.js codex_exec.js run_evaluation.sh
```

## 📝 Customizacja

### Dodawanie nowych testów

Edytuj `promptfooconfig.yaml` w sekcji `tests`:

```yaml
tests:
  - description: "Test 3: Mój nowy test"
    vars:
      prompt: |
        Role: ...
        Task: ...
    assert:
      - type: llm-rubric
        value: |
          Kryteria ewaluacji:
          - Punkt 1
          - Punkt 2
        provider: anthropic:messages:claude-3-5-sonnet-20241022
```

### Zmiana modelu sędziego

W `promptfooconfig.yaml`, zmień `provider` w assertions:

```yaml
provider: anthropic:messages:claude-opus-4-20250514  # Nowszy/inny model
```

### Zmiana timeoutów

Edytuj pliki `*-exec.js` i zmień:
```javascript
const timeout = 600000;  // Zmień na żądaną wartość w ms
```

### Dodawanie nowych pytań (prompts)

W `promptfooconfig.yaml`, dodaj w sekcji `prompts`:

```yaml
prompts:
  - id: my-new-query
    label: "Moje Nowe Pytanie"
    raw: |
      Role: ...
      Task: ...
```

Potem użyj w testach:
```yaml
tests:
  - description: "Test używający nowego prompta"
    vars:
      prompt: "{{prompts.my-new-query}}"
```

## 📚 Dalsze Kroki

1. **Pierwsza ewaluacja**: `./run_evaluation.sh`
2. **Analiza wyników**: Otwórz w przeglądarce przez `promptfoo view`
3. **Dostosuj pytania**: Jeśli potrzeba, edytuj oczekiwane odpowiedzi
4. **Regularne testy**: Uruchamiaj co tydzień/miesiąc aby śledzić postęp agentów
5. **Rozbuduj testy**: Dodawaj nowe pytania w miarę rozwoju projektu

## 🔗 Przydatne Linki

- [Dokumentacja Promptfoo](https://promptfoo.dev/docs)
- [LLM-as-a-Judge Guide](https://promptfoo.dev/docs/guides/llm-as-judge)
- [Exec Provider Docs](https://promptfoo.dev/docs/providers/exec)
- [Anthropic API](https://docs.anthropic.com/)

## 💡 Best Practices

1. **Czyste środowisko**: Commituj zmiany przed testami
2. **Konsystentne prompty**: Pytania powinny być jasne i konkretne
3. **Aktualizuj fakty**: Gdy kod się zmienia, zaktualizuj oczekiwane odpowiedzi w konfiguracji
4. **Baseline runs**: Uruchamiaj regularnie dla śledzenia postępów
5. **Dokumentuj zmiany**: Aktualizuj dokumentację przy modyfikacji testów
6. **Weryfikuj dane**: Upewnij się że oczekiwane informacje faktycznie są w repo
7. **Bezpieczeństwo**: `--dangerously-skip-permissions` używaj TYLKO w zaufanych katalogach!

## ⚠️ Bezpieczeństwo

**UWAGA**: Konfiguracja używa `--dangerously-skip-permissions` dla Claude i `--yolo` dla Gemini.

Te flagi **pomijają wszystkie dialogi bezpieczeństwa** i agenty mogą:
- Wykonywać dowolne komendy shell
- Modyfikować dowolne pliki
- Usuwać pliki
- Instalować pakiety

**Używaj TYLKO w:**
- Zaufanych repozytoriach
- Środowiskach testowych
- Sandboxach bez dostępu do internetu
- Katalogach bez wrażliwych danych

**NIE używaj w:**
- Produkcyjnych środowiskach
- Katalogach z sekretami (API keys, credentials)
- Katalogach z ważnymi danymi bez backupu

## ❓ Wsparcie

W przypadku problemów z:
- **Promptfoo**: https://github.com/promptfoo/promptfoo/issues
- **Claude Code**: https://github.com/anthropics/claude-code/issues
- **Konfiguracją**: Kontakt z maintainerami repozytorium

## 📊 Monitorowanie Postępu

### Logi w czasie rzeczywistym

Skrypty wrapper pokazują progress na stderr:

```
[Claude] Starting evaluation...
[Claude] Prompt preview: Role: You are acting as a Senior Technical Product Manager...
[Claude] ✓ Completed in 45.32s (1234 chars)

[Gemini] Starting evaluation...
[Gemini] Prompt preview: Role: Technical Project Manager / Lead Developer...
[Gemini] ✓ Completed in 38.21s (987 chars)
```

### Co zobaczysz podczas ewaluacji:
1. **Pasek postępu**: `[████████░░░░░] 33% | 4/12 |`
2. **Logi agentów**: Start, prompt preview, czas wykonania
3. **Błędy**: Jeśli wystąpią

### Przydatne opcje monitorowania:

```bash
# Z tabelą wyników
promptfoo eval --table

# Bez paska postępu (tylko logi)
promptfoo eval --no-progress-bar

# Tylko pierwsze N testów (debug)
promptfoo eval --filter-first-n 2

# Tylko konkretny agent
promptfoo eval --filter-providers claude

# Multiple output formats
promptfoo eval -o results.json -o results.html
```

**Więcej informacji**: Zobacz `MONITORING_GUIDE.md`

### Użycie tokenów LLM-as-a-Judge

Promptfoo **nie pokazuje** bezpośrednio użycia tokenów podczas ewaluacji.

**Jak sprawdzić:**
- Anthropic Console: https://console.anthropic.com (Usage/API Keys)
- JSON output: `cat promptfoo-results.json | grep tokenUsage`
- Web UI: `promptfoo view` (może pokazywać więcej szczegółów)

**Szacowany koszt per pełna ewaluacja:**
- 24 judge calls (3 providers × 2 tests × 4 assertions)
- ~48k input tokens + ~5k output tokens
- **≈ $0.21** (tylko dla LLM-as-a-Judge)

Koszty agentów (Claude/Gemini/Codex) zależą od długości odpowiedzi i modeli.

## 📋 Podsumowanie Komend

```bash
# Instalacja
npm install -g promptfoo

# Setup API key
export ANTHROPIC_API_KEY="sk-..."

# Uruchom ewaluację
promptfoo eval                    # Bezpośrednio
./run_evaluation.sh               # Przez skrypt helper
promptfoo eval --table            # Z tabelą wyników
promptfoo eval --no-progress-bar  # Bez paska, więcej logów

# Zobacz wyniki
promptfoo view                    # Otwórz w przeglądarce
./run_evaluation.sh --view-only   # Przez skrypt helper

# Debug i testowanie
promptfoo eval --filter-first-n 2              # Tylko 2 pierwsze testy
promptfoo eval --filter-providers claude       # Tylko Claude
promptfoo eval --no-cache                      # Bez cache
promptfoo eval --resume                        # Kontynuuj przerwane

# Testy manualne wrapper scripts
./claude_exec.js "test prompt"
./gemini_exec.js "test prompt"
./codex_exec.js "test prompt"

# Export wyników
promptfoo eval -o results.json -o results.csv -o results.html
```