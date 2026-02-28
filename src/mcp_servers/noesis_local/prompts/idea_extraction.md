Extract idea units from each turn below. An idea unit groups consecutive sentences carrying one coherent piece of information.

CATEGORIES (exactly one per unit):
- Issue: question or problem raised for discussion
- Position: proposed solution, opinion, or stance
- Argument: evidence or reasoning for/against a position
- Decision: agreed conclusion or action item
- Irrelevant: filler, greetings, procedural remarks

RULES:
1. Every sentence must appear in exactly one idea unit
2. Preserve sentence text verbatim
3. Later turns may reference earlier ones - use full context

TURNS:
{turns}

JSON response - array with one object per turn, in order:
[{{"speaker":"...","time":"HH:MM","idea_units":[{{"sentences":["..."],"category":"Issue|Position|Argument|Decision|Irrelevant"}}]}}]
