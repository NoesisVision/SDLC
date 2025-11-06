# Business Requirement Clarification

## Types of gaps

1. Ambiguities (Vague Language)
2. Missing Information (Critical Gaps)
3. Corner Cases (Edge Conditions)

## Detection Workflow

1. **Read requirement** carefully
2. **Check for triggers** (ambiguous language)
3. **Identify missing dimensions** (boundaries, errors, constraints, outcomes)
4. **Generate corner cases** (boundaries, timing, special values, state conflicts)
5. **Formulate questions** (specific, actionable) with 2-4 answer options
6. **Group by category** (ambiguities, missing info, corner cases)
7. **Prepare questions in batches** (3-5 questions per batch)
8. **Present to user using AskUserQuestion tool** (wait for response before next question)
9. **After completing a batch**, prepare next batch if needed

## Tips

1. **Start broad, then narrow**: First pass for obvious gaps, second pass for subtle ones
2. **Think adversarially**: "How could this break?"
3. **Consider context**: Domain-specific corner cases
4. **Be iterative**: Better to ask follow-ups than get it wrong
5. **Be helpful**: Provide 2-4 answer options that cover common cases (tool adds "Other" automatically)
6. **Be specific**: Concrete examples > abstract concepts
7. **Batch questions**: Prepare 3-5 questions per batch internally
8. **Never present more than one question at a time**: This ensures focused, quality answers

## Question Formatting with AskUserQuestion Tool

You MUST use the AskUserQuestion tool for ALL clarification questions. Follow these guidelines:

**Structure:**
- **header**: Short label (max 12 chars), e.g., "State", "Refund", "Timing"
- **question**: Clear, specific question ending with "?"
- **options**: 2-4 mutually exclusive choices
- **multiSelect**: Use false (default) for single choice, true only when multiple answers are valid

**Option Design:**
- **label**: The choice text (1-5 words), e.g., "Calendar days", "Billing days"
- **description**: Explanation of what this means or implications, e.g., "Count actual calendar days from start to cancellation"

**Best Practices:**
- Options MUST be mutually exclusive unless using multiSelect: true
- Descriptions MUST clarify trade-offs or implications
- Keep label concise, put details in description
- Cover most common cases (tool provides "Other" automatically)
- Use domain language, not technical jargon

## Quality Checklist

Before moving to the next step check:

- [ ] All critical questions answered
- [ ] No unresolved contradictions
- [ ] Assumptions documented and confirmed
- [ ] User has confirmed understanding
- [ ] Business value is clear
- [ ] Success criteria are defined
- [ ] Actors and permissions identified
- [ ] Happy path is clear
- [ ] Error cases are specified
- [ ] Corner cases are addressed