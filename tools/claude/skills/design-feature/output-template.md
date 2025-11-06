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

### FR-01: [Action-Oriented Title]

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
- **Related Requirements:** [FR-XX](#req-xx)

### NFR-02: [Category]
- **Requirement:** [...]
- **Measurement:** [...]

## P3 Model Changes

### MC-01: [Create|Update|Delete] [Element Type] "[Element Name]"

**Type:** [DomainModule | DomainObject | DomainBehavior]
**Operation:** [Create | Update | Delete]
**Parent Module:** [Module path, e.g., "Billing.Invoicing"]

**Description**
[1-3 sentences: what changes and why]

**Changes:**
- **Name:** [New name or "N/A" if not changing]
- **Tags:** [Add: tag1, tag2 | Remove: tag3 | No change]
- **Contains:** [Add: Child1, Child2 | Remove: Child3 | N/A]
- **Uses:** [Add: Dep1, Dep2 | Remove: Dep3 | N/A]
- **Invokes:** [Add: Behavior1 | Remove: Behavior2 | N/A]

**Affected Requirements:** [FR-01, FR-03]
**Rationale:** [Business/technical justification]

---

**Example:**

### MC-01: Create DomainBehavior "CalculateProration"

**Type:** DomainBehavior
**Operation:** Create
**Parent Module:** Billing::Subscriptions

**Description**
New behavior to calculate prorated refunds when subscriptions are cancelled mid-period.

**Changes:**
- **Name:** CalculateProration
- **Tags:** Add: Calculation, QueryHandler
- **Uses:** Add: Subscription, BillingPeriod, Money
- **Invokes:** N/A

**Affected Requirements:** FR-02
**Rationale:** FR-02 requires accurate prorated refund calculations; extraction into dedicated behavior ensures reusability and testability.
```
