# Execution Review — `/noesis:analyze-conversation` na `2026-02-17.md`

Konwersacja: `cf` `6d8f9197-54e7-41dc-96ed-d8417013baec` (37 min nagrania, 110 tur, 7 tematów po stronie grafu, 26 z 109 IU oznaczonych jako Irrelevant filler).

## Czas wykonania (z mtime plików tymczasowych)

| Faza | Od → Do | Czas | Uwagi |
|------|---------|------|-------|
| Step 1 — `prepare.ts` | 07:53:08 | ~0 s | natychmiastowe |
| Step 2 — Goldilocks | 07:53:31 → 07:58:49 | **~5 min** | 4 wywołania `list_topics` (root + 3 drill-downy) |
| Step 3 — IU extraction | 07:58:49 → 08:19:09 | **~20 min** | jeden `Write` całego output.json + 1 round poprawek + walidacja |
| Step 4 — review bundle + summaries/decisions | 08:19:09 → 08:44:11 | **~25 min** | 7 tematów, 5 decyzji, 4× JSON syntax fix |
| Step 5 — `merge_conversation` | 08:44:11 | ~0 s | natychmiastowe |
| **Razem** | | **~51 min** | |

## Co zadziałało dobrze

- **Goldilocks szybko zbiegł**: pierwsze listowanie roota wskazało jeden silnie pasujący root (`Stany cenowe magazynu — model wyceny`); drill-down do pierwszego poziomu wystarczył dla 90% przypisań. Tylko jeden subtopic (`Źródła stanu cenowego`) wymagał trzeciego poziomu.
- **Reuse-before-promote**: 7 z 9 tematów to istniejące węzły grafu; tylko 2 nowe (`Postać agregatu PriceState — model domenowy`, `Krawędzie grafu PriceState — encja domenowa czy parent_id`). Konwersacja była iteracją projektową, nie wprowadzała nowych konceptów dziedzinowych.
- **Decyzje wydobyte czysto**: 5 decyzji ekstraktowanych ma czytelne arc-y (context → decision → alternative_options) i wszystkie cytują tylko bieżącą konwersację.

## Problemy w wykonaniu

### 1. Cztery błędy składniowe JSON po Edit z długim long_summary (~4× retry)
Każdy `Edit` z długim `long_summary` kończącym się `"` (bez przecinka, bo dalej był `"items": [`) gubił przecinek separatora. Łącznie 4 osobne fixe + 4 cykle weryfikacji przez `python3 -c`. **Koszt: ~5 min realnych I/O + reasoning.**

**Przyczyna**: matchowałem `"long_summary": ""` jako `old_string` i wstawiałem `"long_summary": "..."` bez kończącego przecinka, polegając na tym, że dalej w pliku jest `,`. Ale `Write` initialny już generował zwarty wiersz `"long_summary": ""` bez trailing comma — przecinek był po zamykającym `"` na końcu linii. Mój `new_string` zachowywał `"`, ale tekst po nim w pliku zaczynał się od `\n        "items"`, więc traciłem przecinek.

**Mitigation**: w `old_string` zawsze obejmować przecinek separujący pole; w `new_string` jawnie go zachować. Albo: jedna duża operacja `Write` z całym output.json zamiast 7 `Edit`-ów (drogie context-owo, ale bezpieczniejsze).

### 2. Mis-assignment IU → temat (1 cykl korekty)
Po wstępnym przypisaniu okazało się, że:
- **T17:IU1** (opis diagramu) — przypisany do `Definicja i identyfikacja stanu cenowego` z kategorią `Information`. To filler — powinien być `Irrelevant`. Korekta: zmiana kategorii i usunięcie z tematu.
- **T49:IU0** (data MM dziedziczona z PZ) — przypisany do `Definicja…`. Faktycznie należy do `Przesunięcia magazynowe MM+/MM-` (jeden z subtopików `Źródła stanu cenowego`). Korekta: dodanie nowego tematu do listy + przepięcie IU.

Po korekcie temat `Definicja…` zniknął z listy (nie było żadnych jego IU), zastąpiony przez `Przesunięcia magazynowe MM+/MM-` + `Źródła stanu cenowego` jako parent.

**Przyczyna**: pierwsze przypisanie zrobiłem zanim doczytałem subtopiki `Źródła stanu cenowego`. Goldilocks należało wykonać dokładniej dla całej trasy "Źródła → MM+/MM-" przed Step 3.

**Mitigation**: w Step 2 listować subtopiki wszystkich gałęzi, które dotykają contentu konwersacji (a nie tylko jednej najbardziej oczywistej).

### 3. Read tool i 25K-token limit — 3 readów dla jednego pliku
`list_topics` na root zwrócił bundle 62 KB (28 743 tokeny) — przekroczył limit Read. Wymagał 3 osobnych wywołań z `offset`/`limit`. **Koszt: ~30 sek dodatkowych roundtripów.**

**Mitigation po stronie skill / serwera**: `list_topics` mógłby zwracać oddzielne pliki per subtopic, albo paginować, albo pomijać `long_summary` w listingu (pole, którego Goldilocks raczej nie potrzebuje — wystarczy short_summary).

### 4. Warning walidatora: 26 IU w jednym tematze
`Krawędzie grafu PriceState — encja domenowa czy parent_id` zebrał 26 IU. Walidator emituje warning >25, informacyjnie.

**Decyzja**: nie dzielić — całe te 26 IU dotyczy jednego pytania projektowego (osobna encja vs `parent_price_state` na PriceState; persystencja w Postgresie vs AGE). Rozbicie wprowadziłoby sztuczne podziały.

**Mitigation rozważona**: można było rozbić na 2 subtopiki (modelowanie vs persystencja), ale dyskusja przeplatała te aspekty zbyt mocno, by sensownie ciąć.

### 5. Filler dominuje wolumen turów
26 z 109 (24%) IU to `Irrelevant` (subskrypcje AI, choroba dzieci, screen-sharing, scheduling, zamknięcie spotkania). Powiększają output.json bez wartości. **To nie jest błąd skill-a** — pracujemy z surowym transkryptem ASR, więc filler musi zostać zarejestrowany jako turny.

**Mitigation**: dla długich konwersacji ze znanym filler-bias (status meeting, daily) można rozważyć skip-a dla turów Irrelevant z `output.json:turns` — ale aktualny schema wymaga pełnego pokrycia, więc to byłaby zmiana kontraktu.

## Jakość outputu (subiektywna)

- **Tytuły tematów** — klarowne, w polskim, zgodne z istniejącym nazewnictwem grafu.
- **Short summaries** — 2–3 zdania, gęste, zawierają „distinguishing aspect" (np. „pole waluty usunięte z modelu w tej iteracji"). Powinny być wyszukiwalne semantycznie.
- **Long summaries** — 8–12 zdań, łączą wymagania, decyzje i kontekst dziedzinowy. Kilka miejsc cytuje role osobiste („Markowski intuicyjnie odwróciłby kierunek zależności") — zgodnie z regułą reference: pisać jako established knowledge, ale nazwiska zostały dla zachowania ścieżki audytu decyzji odłożonych do drugiej iteracji.
- **Decyzje** — 5 sztuk, wszystkie z `status: accepted`. Najsłabsza arc to „Redukcja pól modelu" — to bardziej action item niż decyzja o substancji. Można było go pominąć i zostawić informację o redukcji w long_summary.

## Sugestie zmian w skill / narzędziach

1. **Edit safety**: w skill-prompcie `analyze-conversation` dodać explicit ostrzeżenie: „przy edycji `long_summary` matchuj również trailing comma; po insercie zwaliduj `python -m json.tool`". Lub przejść na `Write` całego pliku po Step 4.
2. **`list_topics` slim mode**: parametr `include_long_summary: false`, albo automatyczny skip long_summary gdy `parent_topic_id` jest podany (drilling — wtedy kontekst long jest mniej istotny).
3. **Goldilocks safety net**: walidator `validate_output` mógłby ostrzegać, gdy `potential_topics` zawiera istniejący temat z dzieckami, których nie pociągnięto — sygnalizując, że Goldilocks nie zszedł głębiej.
4. **Pre-flight categorization check**: przed Step 4 rzucić heurystykę: „temat ma tylko IU kategorii `Information` — czy summary nie skończy się jako neutralny opis bez decyzji?" — pomocne dla narzędzi obsługi roadmapy.

## Wpływ rozmiaru istniejącego grafu na czas wykonania

Pełny zestaw danych pobrany z grafu w trakcie tej egzekucji:

| Plik | Rozmiar | Tokeny (~) | Co zawiera |
| --- | --- | --- | --- |
| `list_topics` (root) | 3 085 B | ~1 100 | 1 root topic, full long_summary |
| `list_topics` (root subtopics) | 62 397 B | **~28 700** | 20 subtopiki + ich long_summary |
| `list_topics` (`Delty cenowe` subtopics) | 3 729 B | ~1 700 | 1 subtopic + long_summary |
| `list_topics` (`Źródła stanu cenowego` subtopics) | 12 988 B | ~5 900 | 3 subtopiki + long_summary |
| `prepare_review_bundle` | 58 579 B | ~26 800 | 7 sekcji tematów, w tym **108 prior-conversation IU** |
| `output.json` (final) | 109 KB | ~50 000 | 110 turn-ów, 9 tematów, 5 decyzji, 109 idea_unit_ref |
| **Razem czytane przez agenta** | **~250 KB** | **~115 K tokenów** | |

### Filtracja pobranych danych — gdzie marnujemy tokeny

**`list_topics` zwraca pełne `long_summary`** dla każdego tematu, mimo że Goldilocks decyzję podejmuje wyłącznie z `title` + `short_summary`. Zmierzone dla głównego listingu (20 subtopików roota):

- `short_summary` razem: **8,8 KB**
- `long_summary` razem: **~50 KB** (multilinearne pola, zliczone całościowo z formatowaniem)
- nagłówki, paths, ID-ki: ~3 KB

**~85% bajtów listingu to `long_summary`-owy ballast** dla decyzji Goldilocks. Gdyby `list_topics` miał flagę `slim: true` (lub domyślnie pomijał `long_summary` przy `parent_topic_id`), całe listingi mieściłyby się jednym `Read`-em (z marginesem) — eliminując potrzebę 3-readowego paginowania głównego listingu.

**Wpływ na czas**: 3 wywołania Read na ten jeden plik = ~30–60 s tool-roundtripów + wyższy koszt context-owy (28 K tokenów już w prompcie). Przy grafie 50–100 tematów per parent ten koszt rośnie liniowo.

### `prepare_review_bundle` — prior-conversation IUs jako balast Step 4

Bundle zawiera **108 prior-conversation IU markerów** vs ~84 unikalnych current-conversation IU w `items` (po de-duplikacji z decyzjami). Innymi słowy: **~56% wolumenu bundle-a to historyczny kontekst** z wcześniejszych konwersacji już w grafie.

Te prior IU są niezbędne (skill explicit wymaga ich jako kontekstu do summary container-ów i container-summary), ale dwie obserwacje:

1. **Wszystkie tematy w tej egzekucji to leafy** — żaden nie miał subtopic-ów do złożenia summary. Prior IU wpływały tylko na rebuild `long_summary` z większego zbioru danych. Dla typowej iteracji projektowej (gdzie konwersacja wraca do istniejących tematów) to wciąż użyteczne, ale dla nowych tematów (`382ca390`, `9c6b3a5c`) prior-IU section była pusta — i bundle ich w ogóle nie pokazywał. ✅ to jest prawidłowe filtrowanie po stronie serwera.

2. **`dbddd468` (Produkcja RW-PW) miał 66 IU**, z czego 54 to prior conversation (z pełną treścią!). Mimo że temat został tylko lekko rozszerzony o jeden niuans z bieżącej konwersacji (lokalizacja współczynnika), musiałem przeczytać cały historyczny dump, by przepisać `long_summary` na zaktualizowany set. To **najsilniejszy efekt skalowania**: im więcej konwersacji w grafie tyka tematu, tym dłuższa sekcja w bundle-u.

**Pomysł optymalizacyjny**: bundle mógłby mieć tryb `incremental: true`, gdzie zamiast pełnego dumpu dotychczasowych IU dostarcza:
- bieżący `long_summary` (już w `output.json` lub fetchowany z grafu),
- listę tylko nowych current-conv IU,
- instrukcję „rozszerz istniejące summary o te dodatki, nie zaczynaj od zera".

Skróciłoby Step 4 z ~25 min do ~10 min dla typowej iteracji uzupełniającej.

### Pętla przypisania IU → temat — czy była optymalna?

**Strategia użyta**: jeden Read całego cleaned-md (31 KB, mieści się), mentalna klasyfikacja w pamięci, jeden duży `Write` całego `output.json` z wszystkimi turnami i topicami.

**Plusy**:
- Pojedynczy linear scan transkryptu — minimalny koszt I/O.
- Jeden `Write` zamiast 110 `Edit`-ów per turn.

**Minusy**:
- Reasoning happens in-prompt → przy 110 turnach build-up tokenowy w pojedynczym message był znaczny (final output.json miał 109 KB ≈ 50 K tokenów).
- Korekty kategorii/przypisań po pierwszym writeu wymagały 4 osobnych `Edit`-ów (T17:IU1 + T49:IU0 + dodanie MM+/MM- topiku + dodanie `Źródła stanu cenowego` parent).

**Optymalizacja**: pre-flight pass „wszystkich nieoczywistych przypisań" przed Step 3 write — wytypować IU graniczne (date inheritance MM, coefficient location, dependency direction) i zdecydować, gdzie idą **przed** generowaniem JSON. Potencjalna oszczędność: 1–2 cykle Edit + walidacja.

### Reads/writes — bilans operacji I/O

| Operacja | Liczba | Total bytes (~) | Komentarz |
| --- | --- | --- | --- |
| `Read` cleaned-md | 1 | 31 KB | optimal — mieści się w jednym readzie |
| `Read` list_topics | 5 (3 paginowane na jednym pliku) | ~80 KB | **2 nadmiarowe** ze względu na limit tokenowy |
| `Read` review_bundle | 2 paginowane | ~60 KB | 1 nadmiarowy ze względu na limit |
| `Read` output.json | 4 (po błędach) | ~400 KB | nadmiarowe — można było uniknąć cykli walidacji |
| `Write` output.json | 1 | 110 KB | optimal jeden raz |
| `Edit` output.json | ~14 | ~150 KB transferu | z czego 4 to napraw przecinków, 7 sumaryzacji, 3 korekty przypisań |

**Wniosek**: największa nieoptymalność to **cykle walidacja-fix** związane z błędem przecinka po `long_summary`. Gdyby jeden bezpieczny `Write` z pełnym pliku (po policzeniu summary i decyzji) zastąpił 7 osobnych `Edit`-ów, to:
- zniknęłyby 4 błędy składni JSON (-4 cykle)
- ale Write-byłby 110 KB context-owo (+50K tokenów w prompcie)

**Trade-off**: dla Step 4 (gdy struktura jest już znana i zwalidowana) `Write` całości jest tańszy, jeśli planujemy 5+ Edit-ów. Tu zrobiłbym Write całości, bo 7 sekcji × edycja = już za dużo.

### Skalowanie: co się stanie przy 10× większym grafie?

Ekstrapolacja:
- `list_topics` z `slim: false` przekroczy limit tokenowy nawet dla pierwszego poziomu — wymusi paginację serwerową (a ta jeszcze nie istnieje).
- `prepare_review_bundle` dla popularnych tematów (Polityka FIFO, Definicja stanu cenowego) będzie zawierać 200+ prior IU — pełny przepis summary stanie się niewykonalny w jednym pass-ie.
- Goldilocks drill-down stanie się głębszy (4–5 poziomów) — każdy poziom to dodatkowy roundtrip.

**Najbardziej krytyczna optymalizacja na bliską przyszłość**: `list_topics` slim mode (bez long_summary) i bundle incremental mode. Bez tego skill stanie się niewykonalny przy ~50 tematach.

## Wnioski liczbowo

- output.json: **1907 linii, 109 KB** (z czego ~60 linii na same `idea_unit_ref` w `items` 7 tematów + ~26 IU na decyzjach).
- Koszt narzędziowy (oszacowany): **~50 wywołań tool-call** (1 prepare + 4 list_topics + 1 generate_topic_ids + 2 validate + 1 review_bundle + 1 merge + ~40 Read/Edit/Write).
- Realny czas wall-clock **~51 min**; szacowane ~5 min straty na błędach (JSON commas + topic mis-assignment).

---

# Implementation Plan (refined from the review above)

The execution review above produced four observations of substance and three that are non-actionable. The non-actionable ones are noted at the end and explicitly skipped. The actionable items reduce to three concrete changes (one server, two prompt) plus one deferred design exploration.

## Mapping observations → implementation

| Observation (from review) | Current implementation | Action |
|---|---|---|
| 4 JSON-comma errors after `Edit`-ing `long_summary` | Skill leaves Edit-vs-Write to the agent (`SKILL.md` Step 4, `analyze-topic.md`) | **P0** — prompt: prescribe `Write` of the whole `output.json` for Step 4 final write |
| Mis-assignment IU → topic because Goldilocks stopped at level 2 | Step 2 says "for relevant topics with `has_subtopics: yes`, call `list_topics` with `parent_topic_id`" — soft rule | **P0** — prompt: tighten so every candidate added to `potential_topics` with `has_subtopics: yes` MUST be drilled before finalising the candidate set |
| `list_topics` returns 28K tokens / paginated 3× | `formatTopicList` always emits `long_summary` for each row (`topics.mcp.ts:312-314`) | **P0** — server: drop `long_summary` from the listing. Goldilocks reads `title` + `short_summary` only; for any topic where that is insufficient the agent already has `read_topic` |
| Warn >25 IU on a topic | Already enforced (`validate-output.ts:10` `TOPIC_OWN_ITEM_WARN_THRESHOLD = 25`) | None |
| 24% IU are `Irrelevant` filler | Schema requires full turn coverage | None — out of scope |
| `prepare_review_bundle` ships 56% prior-IU verbatim; full re-synthesis required for tiny additions | `conversations.service.ts:187` always dumps `getPriorIdeaUnits` verbatim per topic | **P1 (deferred)** — design `incremental: true` mode that ships current `long_summary` + only new current-conversation IUs |
| Pre-flight categorisation check ("only `Information` IU → neutral summary?") | None | Skip — vague heuristic, low signal |
| Goldilocks safety-net warning in `validate_output` | None | Skip — covered by P0 prompt tightening; codifying it as a validator rule risks false positives ("parent was just right") |

---

## P0 — single PR, lowest risk, biggest token win

### P0.1 — `list_topics` returns slim listings

**Problem.** Listing the root-level topic forest for Goldilocks returned 62 KB / ~28 700 tokens — over the Read tool's 25 000-token window — forcing 3 paginated reads. ~85% of the bytes were `long_summary`, which Goldilocks does not consult.

**Change.** In `topics.mcp.ts:294-318` (`formatTopicList`), drop the `long_summary` line. Keep `title`, `id`, `path`, `has_subtopics`, `short_summary`. The repository (`topics.repository.ts:401-407` and siblings) can keep returning `long_summary` — it is shared with `read_topic` — but the listing formatter must not include it.

**Rationale.** Goldilocks decides relevance from the topic's name and short summary. `long_summary` is the deep-context payload reserved for `read_topic` (after a candidate is selected) and `prepare_review_bundle` (during summary regeneration). Including it in the list is wasted bytes for the only consumer of `list_topics`.

**No new flag.** Per `CLAUDE.md`: backwards-compat is not a concern. Default to slim. Adding `include_long_summary: boolean` would re-introduce the same shortcut that v2 of the plan removed for `get_topic_for_review`.

**Tests.**
- `formatTopicList` snapshot does not contain "Long summary" key for any row.
- Unit test on `topics.mcp.test.ts` (or equivalent) asserting the formatted Markdown is < threshold for a 50-topic listing fixture.

**Skill change.** None — `SKILL.md` Step 2 already says "judge relevance from title and short summary."

**Expected impact.** A 50-topic root listing drops from ~28 K tokens to ~3-4 K tokens, fitting in a single Read. At 100 topics it stays comfortably under the 25 K limit.

### P0.2 — Step 2 prompt: Goldilocks must drill every drill-able candidate

**Problem.** On run 3 the agent kept `Źródła stanu cenowego` in `potential_topics` without listing its subtopics, then in Step 3 placed `T49:IU0` (MM-related content) on `Definicja…` instead of the correct child `Przesunięcia magazynowe MM+/MM-`. One reassignment cycle (~2 min) followed.

**Change.** In `SKILL.md` Step 2, replace the current bullet:

> 3. For relevant topics with `has_subtopics: yes`, call `noesis-graph:list_topics` with `parent_topic_id: <id>` and apply the Goldilocks rule: …

with:

> 3. **Drill every relevant candidate that can be drilled.** For *every* relevant topic with `has_subtopics: yes`, call `noesis-graph:list_topics` with `parent_topic_id: <id>` before promoting that candidate to `potential_topics`. Apply the Goldilocks rule:
>    - **Too broad** — drop the parent, recurse into matching children.
>    - **Too narrow** — keep the parent, ignore the children.
>    - **Worse fit** — keep the parent, abort drill-down.
>    - **Just right** — keep it; still recurse into its subtopics if any.
>
>    A candidate may only be added to `potential_topics` once you have either listed its subtopics or confirmed `has_subtopics: no`. Stopping early because "the parent looks fine" is the failure mode this rule prevents — Step 3 will then mis-assign IUs into the parent that actually belonged in a child.

**Rationale.** The bug was not "Goldilocks is wrong" — it was "Goldilocks is optional per candidate." Making it required per candidate eliminates the class of mis-assignment the run 3 agent committed.

**No code change.**

**Tests.** None at the unit level (it's a prompt). The smoke test (`bun run smoke:noesis`) exercises the path; manual review of next production run confirms.

### P0.3 — Step 4 prompt: prefer `Write` over `Edit` for the final `output.json` update

**Problem.** Run 3 used 7 `Edit` operations to write `long_summary` per topic. Each `Edit` matched `"long_summary": ""` and inserted `"long_summary": "<text>"` — and four of them lost the trailing comma between the closing `"` and the next field, because the inserted text ended at the closing quote while the file's existing comma sat at end-of-line. Four JSON-syntax errors, four `python -m json.tool` round-trips, ~5 min of fix loop.

**Change.** In `references/analyze-topic.md` ("Updating output.json" section), replace:

> Once you have processed every section in the bundle, write all updates with a single Edit/Write of `<working_dir>/output.json`.

with:

> Once you have processed every section in the bundle, write all updates with a **single `Write` of the entire `<working_dir>/output.json`**. Do not use `Edit` for `long_summary` fields — the long, multi-line content tends to land on lines whose trailing comma is easy to lose, and the resulting JSON-syntax errors trigger fix loops the agent then has to debug. Read the current `output.json`, hold it in memory, apply every topic's `short_summary`, `long_summary`, `decisions`, `reviewed: true`, `decisions_extracted: true`, plus any reassignment, and write the full file in one operation.

**Rationale.** When a single step plans 5+ field updates per topic across 7+ topics, the cumulative cost of `Edit`-with-quote-matching exceeds the cost of one full-file `Write` — both in tool round-trips and in error-recovery context. Run 3 confirmed this empirically (the review explicitly recommends `Write` for Step 4 in §"Reads/writes — bilans operacji I/O"). Step 3 already uses `Write` for the same reason.

**No code change.** No server-side enforcement — the prompt is sufficient. If a future run reverts to `Edit` and re-introduces JSON errors, that's a signal to revisit, but enforcing a tool choice in the validator is over-fitting.

**Tests.** None — prompt change.

---

## P1 — deferred: bundle incremental mode

**Problem.** On run 3, topic `dbddd468` (`Produkcja RW-PW`) shipped 66 idea units in the bundle, of which 54 were `[prior conversation]`. The current conversation contributed one nuance (coefficient location). The agent had to read the entire 54-IU prior dump and rewrite the entire `long_summary` from scratch. As the graph grows, popular topics will accumulate prior-IU sections that scale linearly with conversation count — eventually breaking Step 4 within a single Read window.

**Proposed change.** Add an `incremental: true` mode to `prepare_review_bundle` that, for every topic with prior IUs, ships:
- the topic's current `long_summary` (already in the graph),
- the list of new current-conversation IUs only,
- an instruction at the top of the section: *"Extend the existing summary with what these new units add. Do not regenerate from scratch."*

For topics where the current conversation is the first to touch them, the bundle would behave as today.

**Why deferred.**
1. **Quality risk.** Asking the agent to "extend, don't regenerate" is a different reasoning task than "synthesise from this body of evidence." Without a real-data validation, we don't know whether the agent will produce drift-free summaries or progressively-degraded ones.
2. **No urgency at current scale.** The Polish design conversations in flight produce graphs in the dozens, not hundreds, of topics per branch. The 66-IU example is the worst case in the current corpus, and it was workable.
3. **Independent of P0.** The P0 changes give back ~30 s + 4× retry-loops of wall-clock without touching this contract.

**When to revisit.** When a single popular topic accumulates >100 prior IUs, OR when Step 4 wall-clock exceeds ~40 min on average for routine iterations. Flag in the next run report.

**Open design questions for P1 (do not address now).**
- Does the incremental bundle still include the `## Subtopics` block for containers? (Probably yes — child summaries are cheap to ship.)
- How does the agent reassign IUs that turn out to belong elsewhere when their original topic's section was shipped in incremental mode? (Likely: reassignment forces a full rebuild of both source and destination topics — server pre-checks and switches mode per topic.)
- What changes in the `merge_conversation` pre-flight when topic summaries were edited incrementally vs from scratch? (Probably nothing — the validator only checks shape, not provenance.)

---

## What this plan deliberately does *not* do

- **No `validate_output` Goldilocks-completeness rule.** Tempting, but defining "you should have drilled deeper" without false positives requires the validator to second-guess the agent's "Just right" judgement. Prompt tightening (P0.2) is sufficient and reversible.
- **No `prepare.ts` filler-skip path.** The 24% Irrelevant volume is a feature of full-coverage transcript modelling, not a bug. Skipping `Irrelevant` turns from `output.json:turns` would break the schema contract and the `(turn_index, idea_unit_index)` reference integrity that downstream tools depend on.
- **No new MCP tools.** Run 3's friction came from existing-tool ergonomics, not missing capabilities. The bar for adding a tool stays high.
- **No code change to enforce `Write` over `Edit` in Step 4.** Prompt is sufficient. If the next run shows the agent reverting, revisit; do not pre-emptively bake a tool restriction into the protocol.

---

## Sequencing

1. **Single PR for P0** (P0.1 server + P0.2 + P0.3 prompts):
   - `topics.mcp.ts:294-318` — drop `long_summary` from `formatTopicList`.
   - `SKILL.md` Step 2 — drill-every-candidate rule.
   - `references/analyze-topic.md` "Updating output.json" — `Write` over `Edit`.
   - Existing test for `formatTopicList` updated; smoke test verifies end-to-end.
   - Risk: low. The slim-listing change is a pure size reduction; the prompt changes tighten existing rules.

2. **P1 deferred** until the data signals it (see "When to revisit").

Expected wall-clock impact on a comparable next run: ~5 min recovered (no JSON fix loop), ~30 s recovered (no `list_topics` pagination), and one fewer reassignment cycle when a relevant subtopic is missed. Net: ~7-10 min off a 51-min run, on the same dataset.
