# Idea Units extraction

## Categories

Assign exactly one category per unit using these strict definitions:

- **Issue:** A specific problem, blocker, question, or architectural dilemma raised for discussion.
- **Position:** A statement proposing how something should be done — a proposed solution, opinion, or stance.
- **Argument:** The reasoning, business logic, or justification supporting or refuting a specific position.
- **Information:** A factual description, clarification, historical context, or current-state report without advocating for a particular approach.
- **Agreement:** An explicit endorsement of or alignment with a previously stated position or fact ("tak, dokladnie", "zgadzam sie", "yes, exactly").
- **Decision:** A conclusion agreed upon by the group, or an action item assigned and accepted.
- **Irrelevant:** Filler, greetings, procedural remarks, meta-discussion about meeting logistics, off-topic small talk. This includes:
  - Short confirmations/acknowledgments with no substantive content ("tak", "OK", "rozumiem")
  - Deictic references without standalone meaning ("to tutaj na dole", "these two circles")
  - Meeting mechanics ("let's move on", "can everyone hear me?")
  - References to screen sharing or collaboration tools

## Category Disambiguation

When a statement could fit multiple categories, use these heuristics:

- If the speaker is **describing what exists** (current system, historical decisions, domain facts) without advocating change -> **Information**
- If the speaker says "yes", "exactly", "I agree", "that's right" to endorse someone else's point -> **Agreement**
- If the speaker is **proposing how things should be** -> **Position**
- If the speaker is **supporting why** a proposal is good/bad -> **Argument**
- A **Decision** requires visible group consent (multiple speakers agreeing, or an authority figure directing with no objection). A single person's plan for their own work is a **Position**, not a Decision.

## Splitting Guidelines

- A single idea unit should typically contain **1-4 sentences**. If you find yourself grouping 5+ sentences, check whether the unit actually covers multiple distinct points.
- Split when the speaker **changes sub-topic** within a turn (e.g., moves from describing the current system to proposing a change).
- Split when the speaker **shifts discourse function** (e.g., from stating a fact to asking a question).
- Do NOT split mid-sentence or break up a single line of reasoning that requires all its parts to be understood.