# Language Standards

## Modal Verbs

### MUST Use

**SHALL** (mandatory requirement):
- System SHALL validate email format
- User SHALL provide password

**SHALL NOT** (mandatory prohibition):
- System SHALL NOT store passwords in plain text
- Users SHALL NOT access other users' data

**MUST** (absolute requirement):
- Email MUST be unique
- Transaction MUST be atomic

**MUST NOT** (absolute prohibition):
- Payment data MUST NOT be logged
- Passwords MUST NOT be transmitted unencrypted

### NEVER Use

**should** - Ambiguous, unclear if mandatory
- ❌ "System should respond quickly"
- ✅ "System SHALL respond within 2 seconds"

**may** - Unclear if optional or possible
- ❌ "User may receive notification"
- ✅ "System SHALL send notification to user"

**could** - Vague possibility
- ❌ "System could cache results"
- ✅ "System SHALL cache results for 5 minutes"

**might** - Uncertain
- ❌ "Performance might degrade"
- ✅ "System SHALL maintain response time under load"

## Vague Terms to Replace

### Quantities

❌ Replace with ✅:
- "many users" → "at least 1000 concurrent users"
- "few items" → "up to 10 items"
- "several attempts" → "3 retry attempts"
- "large file" → "files up to 100MB"
- "small dataset" → "datasets under 1000 records"

### Time

❌ Replace with ✅:
- "quickly" → "within 2 seconds"
- "soon" → "within 1 hour"
- "eventually" → "within 24 hours"
- "real-time" → "within 100ms"
- "promptly" → "within 5 minutes"

### Quality

❌ Replace with ✅:
- "user-friendly" → "accessible via keyboard navigation per WCAG 2.1 AA"
- "intuitive" → "90% of users complete task without help"
- "simple" → "requires no more than 3 clicks"
- "fast" → "response time < 2 seconds (95th percentile)"
- "reliable" → "99.9% uptime"

### Comparisons

❌ Replace with ✅:
- "better performance" → "50% faster response time"
- "improved reliability" → "uptime increased from 99% to 99.9%"
- "more secure" → "implements OAuth 2.0 + MFA"

## Requirement Structure

Every requirement SHALL follow this pattern:

```markdown
### FR-XXX: [Action-oriented title]
**Priority:** Must Have | Should Have | Nice to Have
**Description:** The system SHALL [specific, testable behavior] WHEN [condition/trigger] SO THAT [business value]
**Rationale:** [Why needed]
**Acceptance Criteria:**
  - AC-XXX.1: [Specific criterion]
  - AC-XXX.2: [Specific criterion]

#### Business Rules
[If applicable]

#### BDD Scenarios
[Scenarios for this requirement]
```

### Example

```markdown
### FR-015: Validate Email Format
**Priority:** Must Have
**Description:** The system SHALL reject email addresses that do not match RFC 5322 format WHEN a user submits a registration form SO THAT only valid email addresses are stored
**Rationale:** Invalid emails cause delivery failures and support burden
**Acceptance Criteria:**
  - AC-015.1: Email "user@example.com" is accepted
  - AC-015.2: Email "invalid.email" is rejected with message "Invalid email format"
  - AC-015.3: Email with unicode characters "用户@例え.jp" is handled per IDN standards

#### BDD Scenarios

**Scenario 001: Valid email accepted**
```gherkin
Scenario: User submits valid email
  Given the user is on registration page
  When the user submits email "user@example.com"
  Then the system SHALL accept the email
```

**Scenario 002: Invalid email rejected**
```gherkin
Scenario: User submits invalid email
  Given the user is on registration page
  When the user submits email "invalid.email"
  Then the system SHALL reject with message "Invalid email format"
```
```

## Acceptance Criteria Format

Each criterion MUST be:
- Specific (not vague)
- Testable (can verify objectively)
- Measurable (if applicable)
- Action-oriented

### Good Examples

✅ "System responds within 2 seconds for 95% of requests"
✅ "Email validation rejects addresses without @ symbol"
✅ "User sees confirmation message 'Profile updated successfully'"
✅ "Cart contains exactly 1 item after adding first item"

### Bad Examples

❌ "System is fast"
❌ "Email validation works"
❌ "User gets feedback"
❌ "Cart is updated"

## Requirement Titles

**Pattern**: `[Action Verb] + [Object] + [Context]`

### Good Examples

✅ FR-001: Validate Email Format on Registration
✅ FR-002: Calculate Customer Lifetime Value Daily
✅ FR-003: Display Order Status in User Dashboard
✅ FR-004: Prevent Duplicate Order Submission

### Bad Examples

❌ FR-001: Email (too vague)
❌ FR-002: Customer Value (unclear action)
❌ FR-003: Dashboard (what about it?)
❌ FR-004: Orders (no specificity)

## Nested Structure

### Requirements Contain Scenarios

Scenarios are nested directly under requirements - no separate linking needed:

```markdown
### FR-001: User Authentication
**Priority:** Must Have
**Description:** System SHALL authenticate users...
**Acceptance Criteria:**
  - AC-001.1: ...

#### BDD Scenarios

**Scenario 001: Successful Login**
```gherkin
Scenario: User logs in with valid credentials
  Given the user has valid credentials
  When they submit the login form
  Then they SHALL be redirected to dashboard
```

**Scenario 002: Invalid credentials**
```gherkin
Scenario: User provides invalid password
  Given the user has account
  When they submit wrong password
  Then they SHALL see error message
```
```

## Glossary Terms

Define domain-specific terms clearly:

| Term | Definition |
|------|------------|
| **User** | Authenticated individual with account credentials |
| **Customer** | User who has completed at least one transaction |
| **Premium Customer** | Customer with lifetime value >= $10,000 |
| **Session** | Authenticated period from login to logout or 30-minute timeout |

## Examples vs. Non-Examples

When defining concepts, use both:

**Example**:
```markdown
**Premium Customer**: Customer with lifetime value >= $10,000

Examples:
- Customer A: $10,500 lifetime value → Premium
- Customer B: $15,000 lifetime value → Premium

Non-Examples:
- Customer C: $9,999 lifetime value → Standard
- Customer D: New customer, no history → Standard (until calculated)
```

## Common Mistakes

### Mistake 1: Mixing SHALL with "should"

❌ Bad:
```
FR-001: System should validate emails
FR-002: Passwords SHALL be encrypted
```

✅ Good:
```
FR-001: System SHALL validate email format per RFC 5322
FR-002: System SHALL encrypt passwords using bcrypt (cost factor 12)
```

### Mistake 2: Implementation in Requirements

❌ Bad:
```
FR-003: System SHALL use PostgreSQL for data storage
```

✅ Good:
```
FR-003: System SHALL persist user data with ACID guarantees
```

### Mistake 3: Untestable Requirements

❌ Bad:
```
FR-004: System SHALL be user-friendly
```

✅ Good:
```
FR-004: System SHALL allow 90% of users to complete checkout without help
(measured via usability testing with 50 participants)
```

### Mistake 4: No Business Value

❌ Bad:
```
FR-005: System SHALL log all events
```

✅ Good:
```
FR-005: System SHALL log all authentication attempts
SO THAT security team can detect brute force attacks
```

## Validation Checklist

Before finalizing requirements, verify:

- [ ] Every SHALL/MUST is testable
- [ ] No "should", "may", "could", "might"
- [ ] No vague quantities/times/qualities
- [ ] All terms defined in glossary
- [ ] All requirements have SO THAT clause
- [ ] All acceptance criteria are specific
- [ ] All requirements linked to scenarios
- [ ] Consistent terminology throughout
