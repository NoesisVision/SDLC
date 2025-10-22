# Clarification Dialog Workflow

## Overview

The clarification dialog systematically transforms vague feature descriptions into complete, testable requirements. This workflow guides you through asking the right questions in the right order.

## Process Flow

```
User Input
    ↓
Phase 1: Automatic Analysis
    ↓
Phase 2: Gap Detection
    ↓
Phase 3: Question Formulation
    ↓
Phase 4: User Response Collection
    ↓
Phase 5: Validation & Follow-up
    ↓
Complete Understanding
```

## Phase 1: Automatic Analysis

When user provides feature description, immediately analyze for:

### 1. Core Intent
- What problem is being solved?
- Who benefits?
- What value does it create?

### 2. Key Actors
- Who interacts with this feature?
- What roles exist?
- Are there system actors?

### 3. Main Actions
- What can users do?
- What triggers these actions?
- What are the outcomes?

### 4. Critical Data
- What information flows through?
- What data must be accurate?
- What data has constraints?

### 5. Business Rules
- What rules govern behavior?
- What validations apply?
- What are the boundaries?

**Output**: 2-3 sentence summary of understanding

## Phase 2: Gap Detection

Use patterns from [gap-detection-patterns.md](../references/gap-detection-patterns.md) to identify:

### Scan 1: Ambiguities
- Fuzzy quantities: "many", "few"
- Vague time: "quickly", "soon"
- Unclear quality: "user-friendly"
- Relative terms: "better", "faster"
- Modal confusion: "should", "may"

### Scan 2: Missing Information
- Boundaries (min/max values)
- Error cases (what if fails)
- Constraints (who/when/what)
- Outcomes (what happens next)

### Scan 3: Corner Cases
- Boundaries (zero, one, max)
- Timing (simultaneous, sequence)
- Special values (empty, null)
- State conflicts (exists, locked)

**Output**: Categorized list of gaps

## Phase 3: Question Formulation

### Question Quality Rules

Each question MUST have:
1. **Clear category** (Ambiguity / Missing Info / Corner Case)
2. **Specific focus** (not "what about errors?")
3. **Context** (why it matters)
4. **Options** (with implications)
5. **Action request** ("Your choice: ___")

### Question Template

```markdown
**Q[N]: [Category] - [Specific Question]**

Context: [Why I'm asking / What this affects]

Options:
A) [Option 1 with implications]
B) [Option 2 with implications]
C) Other (please specify)

**Your answer:** ___
```

### Question Batching

- Present 5-7 questions at a time
- Group related questions together
- Don't overwhelm with 20+ questions
- Allow iteration

### Example Good Question

```markdown
**Q1: Ambiguity - File Size Limits**

Context: You mentioned users can upload files. Without size limits, users might upload gigabyte files causing storage and performance issues.

Options:
A) Small files only (up to 10MB) - typical for profiles/avatars
B) Medium files (up to 100MB) - supports documents, presentations
C) Large files (up to 1GB) - supports videos, large datasets
D) No limit - requires robust storage architecture

Impact: Affects storage costs, upload time UX, and architecture

**Your answer:** ___
```

### Example Bad Question

```markdown
**Q1: What about errors?**

[Too vague, no context, no options]
```

## Phase 4: User Response Collection

### Presenting Questions

Use this format:

```markdown
## Requirements Analysis: [Feature Name]

### 🎯 Core Intent (My Understanding)
[2-3 sentence summary]

**Does this match your intent?** If not, please clarify.

---

### ⚠️ Ambiguities Found

I found [N] ambiguous terms that need clarification:

[Questions 1-3 about ambiguities]

---

### ❓ Missing Information

Critical gaps in the specification:

[Questions 4-6 about missing info]

---

### 🔍 Corner Cases to Consider

I identified [N] edge conditions:

[Questions 7-9 about corner cases]

---

### 📋 Assumptions I'll Make

Where information wasn't provided, I'll assume:

[List assumptions with rationale]

**Correct?** [ ] Yes [ ] No - actually: ___

---

**Ready to proceed?**
- If all questions answered → I'll generate specification
- If you want to add more → Please provide additional context
- If you want to change direction → Let me know what to adjust
```

### Response Handling

Accept multiple response formats:
- Letter choices: "A", "B", "C"
- Descriptive: "We need medium files, up to 100MB"
- Mixed: "B for most, but D for admin users"
- Deferred: "Not sure yet - make reasonable assumption"

### Follow-up Logic

After user responds:
1. **Validate completeness**: All questions answered?
2. **Check consistency**: Any contradictions?
3. **Generate follow-ups**: New questions from answers?
4. **Confirm assumptions**: Document what's assumed

## Phase 5: Validation & Follow-up

### Consistency Check

```python
def check_consistency(answers):
    conflicts = []
    
    # Example: User said "no authentication" but "only admin can delete"
    if not answers['requires_auth'] and answers['admin_only_delete']:
        conflicts.append("Conflicting: No auth but admin-only feature")
    
    return conflicts
```

### Missing Answers

If user skips questions:
1. Highlight skipped questions
2. Offer to make reasonable assumptions
3. Document assumptions clearly
4. Mark for future review

### New Questions from Answers

Sometimes answers reveal new gaps:

**Example**:
- User answers: "Files up to 100MB"
- New question: "What if user's storage quota is less than 100MB?"

### Confirmation Format

```markdown
## 📝 Summary of Clarifications

Based on your answers, here's what I understood:

**File Uploads:**
- Maximum size: 100MB
- Allowed types: PDF, DOCX, PNG, JPG
- Storage: User quota applies
- Error handling: Show progress, allow retry on failure

**User Permissions:**
- Any authenticated user can upload
- Users can only access their own files
- Admins can access all files

**Corner Cases:**
- Files exactly 100MB: Accepted
- Duplicate filenames: Auto-rename (filename-1.pdf)
- Upload interrupted: Resume supported

**Assumptions Made:**
- File virus scanning: Will be performed (assumed)
- Retention policy: Files kept indefinitely (needs clarification later)

**Is this correct?** [Y/N]
```

## Common Patterns

### Pattern 1: Progressive Refinement

Start broad, narrow down:

**Round 1**: "Who can upload files?"
- Answer: "Authenticated users"

**Round 2**: "Any authenticated user, or only certain roles?"
- Answer: "Any authenticated user"

**Round 3**: "Can users see each other's files?"
- Answer: "No, only their own"

### Pattern 2: Example-Driven

Use concrete examples:

**Question**: "How should duplicate filenames be handled?"

**Bad**: "What's the duplicate handling strategy?"

**Good**: 
```
Scenario: User "Alice" uploads "report.pdf"
Later, Alice uploads another "report.pdf"

Options:
A) Overwrite first file (data loss risk)
B) Auto-rename: "report-1.pdf", "report-2.pdf"
C) Error: "File exists, choose different name"
D) Version: Keep both, show "report.pdf (v1)", "report.pdf (v2)"
```

### Pattern 3: Impact-Driven

Show consequences:

**Question**: "Should uploads be synchronous or asynchronous?"

**With impact**:
```
Options:
A) Synchronous: User waits for upload
   - Pro: Immediate feedback
   - Con: Page blocked, bad UX for large files
   
B) Asynchronous: Background upload
   - Pro: Better UX, user can continue
   - Con: More complex, needs notifications
```

## Difficult Situations

### User Says "I Don't Know"

Response options:
1. **Provide recommendation**: "Based on similar systems, I recommend..."
2. **Explain consequences**: "If we don't decide now, here's the risk..."
3. **Defer with assumption**: "I'll assume X for now, we can revise"
4. **Escalate**: "This is critical - suggest consulting with [role]"

### User Gives Contradictory Answers

```markdown
I notice a potential conflict:

- Earlier you said: "Any user can upload files"
- Just now you said: "Only premium users can upload"

Can you clarify which is correct, or if there's a nuance I'm missing?
```

### User Asks Too Many Follow-up Questions

```markdown
Let me address your questions, then continue with clarifications:

[Answer user's questions]

Now, to complete the requirements, I still need to clarify:
[Resume with remaining questions]
```

## Quality Checklist

Before moving to specification generation:

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

## Next Steps

After clarification is complete:
1. Resolve repository context automatically (see Step 1 in [file-generation.md](file-generation.md))
2. Generate the feature slug
3. Produce the specification using the file-generation workflow (auto-create file or return inline content based on context)

## Tips

1. **Be patient**: Users need time to think through questions
2. **Be specific**: Concrete examples > abstract concepts
3. **Be helpful**: Offer options, don't make them guess
4. **Be iterative**: Better to ask follow-ups than get it wrong
5. **Be respectful**: User's time is valuable, batch questions efficiently
