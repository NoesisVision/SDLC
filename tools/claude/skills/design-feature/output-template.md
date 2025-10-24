# Design Doc Template

Use this for all design docs.

```markdown
# [Feature Slug]

## Purpose
[Describe the problem, and business value in 2-5 sentences.]

## Actors

| Actor | Description | Actions |
|-------|-------------|---------|
| [Actor 1] | [Role in system] | [Feature interactions] |
| [Actor 2] | [Role in system] | [Feature interactions] |

## Functional Requirements

### REQ-01: [Action-Oriented Title]

**Description:** System SHALL [testable behavior] WHEN [condition or trigger] SO THAT [business value]
**Rationale:** [Business justification]

#### Business Rules

**BR-01: [Rule Name]**
- **Condition:** [When this rule applies]
- **Action:** [Required behavior]
- **Example:** [Clarifying example]

#### BDD Scenarios

**Scenario 01: [Happy Path Title]**
```gherkin
Scenario: [Goal of scenario]
  Given [precondition]
  And [additional context]
  When [trigger/action]
  Then [expected outcome]
  And [secondary assertion]
```

**Scenario 02: [Edge or Error Title]**
```gherkin
Scenario: [Edge or error condition]
  Given [precondition]
  And [additional context]
  When [trigger/action]
  Then [expected outcome]
  And [user/system feedback]
```

## Non-Functional Requirements

### NFR-01: [Category]
- **Requirement:** [Specific, measurable target]
- **Measurement:** [How compliance is verified]
- **Related Requirements:** [REQ-XX](#req-xx)

### NFR-02: [Category]
- **Requirement:** [...]
- **Measurement:** [...]

## P3 Model Changes

### Model Change 01: [Change Slug]

**Description**
[1-3 stentences description of the change]

**Rationale**
[Business and technical justification of the change]

## Acceptance Checklist

**Requirements Quality**
- [ ] All requirements are testable and use SHALL/MUST
- [ ] No ambiguous language ("should", "may", "quickly", etc.)
- [ ] Happy path, error, and corner cases covered

**Completeness**
- [ ] Functional requirements documented
- [ ] Non-functional requirements documented

**BDD Coverage**
- [ ] Every requirement has BDD scenarios
- [ ] Scenario numbering resets per requirement
```

