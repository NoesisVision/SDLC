# Requirements Template Structure

Use this template to produce consistent, testable business requirements. Keep the skeleton intact, replace placeholders with feature-specific content, and repeat marked blocks as needed.

## Template Skeleton

```markdown
# Business Requirements: {{feature_name}}

**Specification Path:** `specs/{{yyyy_mm_dd}}_{{feature_slug}}/requirements.md`
**Version:** 1.0
**Date:** {{iso_date}}
**Status:** Draft | Review | Approved

---

## 1. Feature Overview

### Purpose
[Describe the problem, proposed solution, and business value in 1-2 paragraphs.]

### Scope

**In Scope:**
- [Capability 1]
- [Capability 2]
- [Capability N]

**Out of Scope:**
- [Explicitly excluded item 1]
- [Explicitly excluded item 2]

### Success Criteria
- [Metric 1]
- [Metric 2]
- [Metric N]

---

## 2. Actors

| Actor | Description | Capabilities |
|-------|-------------|--------------|
| [Actor 1] | [Role in system] | [Feature interactions] |
| [Actor 2] | [Role in system] | [Feature interactions] |

---

## 3. Functional Requirements

### REQ-001: [Action-Oriented Title]
**Priority:** Must Have | Should Have | Nice to Have
**Description:** System SHALL [testable behavior] WHEN [condition/trigger] SO THAT [business value]
**Rationale:** [Business justification]
**Acceptance Criteria:**
  - AC-001.1: [Specific, testable criterion]
  - AC-001.2: [Specific, testable criterion]

#### Business Rules

**BR-001: [Rule Name]**
- **Condition:** [When this rule applies]
- **Action:** [Required behavior]
- **Example:** [Clarifying example]

#### BDD Scenarios

**Scenario 001: [Happy Path Title]**
```gherkin
Scenario: [Goal of scenario]
  Given [precondition]
  And [additional context]
  When [trigger/action]
  Then [expected outcome]
  And [secondary assertion]
```

**Scenario 002: [Edge or Error Title]**
```gherkin
Scenario: [Edge or error condition]
  Given [precondition]
  When [trigger/action]
  Then [expected outcome]
  And [user/system feedback]
```

---

## 4. Data Requirements

### 4.1 Information Items

**[Data Item]**
- **Description:** [Meaning of the data]
- **Constraints:**
  - Format: [Pattern/type specification]
  - Range: [Min/max or allowed set]
  - Required: Yes | No
  - Unique: Yes | No
- **Validation Rules:**
  - [Rule 1]
  - [Rule 2]
- **Related Requirements:** [REQ-XXX](#req-xxx)

### 4.2 Data Interactions
- [Describe how data flows, transformations, storage, retention.]

---

## 5. Non-Functional Requirements

**NFR-001: [Category]**
- **Requirement:** [Specific, measurable target]
- **Measurement:** [How compliance is verified]
- **Related Requirements:** [REQ-XXX](#req-xxx)

**NFR-002: [Category]**
- **Requirement:** [...]
- **Measurement:** [...]

---

## 6. Assumptions & Dependencies

### Assumptions
1. [Assumption 1]
2. [Assumption 2]

### Dependencies
1. [Dependency 1]
2. [Dependency 2]

---

## 7. Constraints

1. [Regulatory constraint]
2. [Business constraint]
3. [Technical constraint]
4. [User constraint]

---

## 8. Glossary

| Term | Definition |
|------|------------|
| [Term] | [Precise definition] |
| [Term] | [Precise definition] |

---

## 9. Traceability Matrix

| Requirement | Priority | Scenario Count | Coverage Status |
|-------------|----------|----------------|-----------------|
| REQ-001 | [Priority] | [# scenarios] | ✅/⚠️ |
| REQ-002 | [Priority] | [# scenarios] | ✅/⚠️ |

**Coverage Summary:**
- Total Requirements: [N]
- Total Scenarios: [M]
- Requirements with Scenarios: [Count] (Goal: 100%)
- Scenarios per Requirement (avg): [M/N]
- Must Have Coverage: [X]/[Y]
- Should Have Coverage: [X]/[Y]
- Nice to Have Coverage: [X]/[Y]

---

## 10. Acceptance Checklist

**Requirements Quality**
- [ ] All requirements are testable and use SHALL/MUST
- [ ] No ambiguous language ("should", "may", "quickly", etc.)
- [ ] Actors, actions, and outcomes fully defined

**Completeness**
- [ ] Happy path, error, and corner cases covered
- [ ] Boundary conditions addressed
- [ ] Data, non-functional, assumptions, and constraints documented

**BDD Coverage**
- [ ] Every requirement has nested BDD scenarios
- [ ] Acceptance criteria map to Given/When/Then steps
- [ ] Scenario numbering resets per requirement

**Traceability**
- [ ] Traceability matrix lists every requirement and scenario count
- [ ] 100% coverage achieved or variance explained

---

## 11. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | {{iso_date}} | Requirements Analyst | Initial specification |
```

Repeat the `### REQ-001` block (including Business Rules and BDD Scenarios) for each additional requirement, incrementing IDs sequentially.

## Section Guidance

- **Purpose / Scope / Success Criteria**: Focus on business outcomes and measurable targets. Avoid solution details.
- **Functional Requirements**: Follow structure from [../references/language-standards.md](../references/language-standards.md) and [../references/bdd-scenario-rules.md](../references/bdd-scenario-rules.md). Repeat the requirement block for REQ-002 onward, incrementing IDs and scenario numbers.
- **Data Requirements**: Capture the shape, validation, retention, and ownership of critical data.
- **Non-Functional Requirements**: Use specific metrics with verification methods. Keep categories consistent (performance, usability, security, scalability, reliability, etc.).
- **Assumptions & Dependencies**: Track items that, if false or missing, jeopardize delivery.
- **Constraints**: Document limits imposed by regulation, business decisions, existing architecture, or user needs.
- **Glossary**: Define domain terms so stakeholders share the same vocabulary.
- **Traceability Matrix**: Ensure 100% coverage; no requirement should lack scenarios.
- **Acceptance Checklist**: Tick items only when fully satisfied.
- **Revision History**: Update on every change—never overwrite past entries.

## Example Snippets

Use the following examples as inspiration; do **not** copy them verbatim into the template skeleton.

### Feature Overview Example

**Purpose**  
Customer order tracking is currently manual and opaque. Customers frequently contact support to ask about order status, creating unnecessary load. This feature provides real-time order tracking with automated notifications, reducing support tickets by an estimated 40% while improving customer satisfaction.

**Success Criteria**
- 90% of customers track orders without contacting support.
- Support tickets tagged "where is my order" decrease by 40% within 90 days of launch.
- Customer satisfaction score increases by 15%.
- 95% of status updates delivered within 5 minutes of fulfillment updates.

### Actors Example

| Actor | Description | Capabilities |
|-------|-------------|--------------|
| Customer | Registered user who has placed orders | View own order status, receive notifications, view order history |
| Customer Support | Support team member | View any customer's order status, manually trigger notifications |
| System | Automated background processes | Update order status, send automated notifications |

### Functional Requirement Example

```markdown
### REQ-001: Display Current Order Status
**Priority:** Must Have
**Description:** System SHALL display current order status (pending, processing, shipped, delivered) WHEN customer views their order SO THAT customers know the current state without contacting support
**Rationale:** Transparent order status reduces support inquiries and improves customer confidence
**Acceptance Criteria:**
  - AC-001.1: Status displays within 2 seconds of page load
  - AC-001.2: Status is accurate within 5 minutes of actual change
  - AC-001.3: Status includes timestamp of last update
  - AC-001.4: Status shows estimated delivery date when available

#### Business Rules

**BR-001: Premium Customer Notification Priority**
- **Condition:** Customer has premium status (lifetime value >= $10,000)
- **Action:** Notifications SHALL be sent via email AND in-app
- **Example:** Customer "Alice" with $15,000 lifetime value receives both email and in-app notifications when order ships

#### BDD Scenarios

**Scenario 001: Customer views order status for shipped order**
```gherkin
Scenario: Customer views status of shipped order
  Given customer "Alice" has placed order "ORD-12345"
  And order "ORD-12345" has status "shipped"
  And order was updated 30 minutes ago
  When Alice navigates to order details page
  Then the system SHALL display status "Shipped"
  And the system SHALL display "Last updated: 30 minutes ago"
  And the system SHALL display estimated delivery date
```

**Scenario 002: Customer attempts to view non-existent order**
```gherkin
Scenario: Customer tries to view order that doesn't exist
  Given customer "Alice" is logged in
  When Alice navigates to order details for "ORD-99999"
  And order "ORD-99999" does not exist
  Then the system SHALL display error "Order not found"
  And the system SHALL NOT display any order details
  And the system SHALL offer link to order history page
```
```

### Data Requirement Example

**Order Status**
- **Description:** Current state of the order in the fulfillment process
- **Constraints:**
  - Format: Enumeration (pending, processing, shipped, delivered, cancelled)
  - Range: Fixed set of values
  - Required: Yes
  - Unique: No
- **Validation Rules:**
  - Must be one of the defined enumeration values
  - State transitions must follow defined workflow (pending → processing → shipped → delivered)
  - Cannot transition backward in the workflow
- **Related Requirements:** [REQ-001](#req-001), [REQ-002](#req-002)

### Non-Functional Requirement Example

**NFR-001: Page Load Performance**
- **Requirement:** Order status page SHALL load within 2 seconds for 95% of requests
- **Measurement:** Real User Monitoring 95th percentile page-load time
- **Related Requirements:** [REQ-001](#req-001), [REQ-002](#req-002)

### Assumptions & Dependencies Example

**Assumptions**
1. Order status data is available in real-time from the fulfillment system.
2. Customers have valid email addresses for notifications.

**Dependencies**
1. Fulfillment system exposes a real-time status API (REQ-DEP-001).
2. Notification service supports transactional emails (REQ-DEP-002).

### Glossary Example

| Term | Definition |
|------|------------|
| **Order** | A customer's request to purchase products, uniquely identified by order ID. |
| **Premium Customer** | Customer with lifetime order value ≥ $10,000. |
| **Real-time** | Within 5 minutes of the actual status change. |

## Template Usage Guidelines

### Section Order (Must Not Change)
1. Feature Overview
2. Actors
3. Functional Requirements (with nested Business Rules and BDD Scenarios)
4. Data Requirements
5. Non-Functional Requirements
6. Assumptions & Dependencies
7. Constraints
8. Glossary
9. Traceability Matrix
10. Acceptance Checklist
11. Revision History

### Minimum Content Requirements

A complete specification MUST include:
- ≥ 1 actor
- ≥ 5 functional requirements
- ≥ 10 BDD scenarios (nested under their requirements)
- Business rules where applicable
- Fully populated traceability matrix with 100% coverage

### Numbering Conventions

- Requirements: `REQ-001`, `REQ-002`, ...
- Scenarios: `Scenario 001`, `Scenario 002`, ... (restart numbering per requirement)
- Business Rules: `BR-001`, `BR-002`, ...
- Acceptance Criteria: `AC-REQ#.1`, `AC-REQ#.2`, ...
- Non-functional requirements: `NFR-001`, `NFR-002`, ...

### Language Standards

- Use SHALL/MUST for mandatory statements; SHALL NOT/MUST NOT for prohibitions.
- Replace vague terms with measurable criteria. Reference [../references/language-standards.md](../references/language-standards.md) for exhaustive rules.

### BDD Guidance

- Follow Given/When/Then structure for every scenario.
- Keep scenarios focused—one behavior per scenario.
- Reference [../references/bdd-scenario-rules.md](../references/bdd-scenario-rules.md) for detailed patterns.

### Validation Tips

- Run automated checks for forbidden modal verbs and vague terms.
- Confirm heading levels follow `## → ### → ####` without gaps.
- Ensure traceability matrix counts align with actual scenarios.
