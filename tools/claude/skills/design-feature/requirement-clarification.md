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
5. **Formulate questions** (specific, actionable)
6. **Group by category** (ambiguities, missing info, corner cases)
7. **Present to user** (5-7 questions at a time)

## Tips

1. **Start broad, then narrow**: First pass for obvious gaps, second pass for subtle ones
2. **Think adversarially**: "How could this break?"
3. **Consider context**: Domain-specific corner cases
4. **Be iterative**: Better to ask follow-ups than get it wrong
5. **Be helpful**: Offer up to 3 options, but value custom user input more
6. **Be specific**: Concrete examples > abstract concepts
7. **Batch questions**: Present 2-5 at a time, not 10+

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