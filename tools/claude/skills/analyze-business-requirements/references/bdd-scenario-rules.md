# BDD Scenario Rules

## Core Structure

Every BDD scenario MUST be nested under its parent requirement and follow this structure:

```markdown
### REQ-001: [Requirement Title]
...

#### BDD Scenarios

**Scenario 001: [Descriptive Title]**
```gherkin
Scenario: [What is being tested]
  Given [initial state/preconditions]
  And [additional context if needed]
  When [user action or trigger]
  Then [expected outcome]
  And [additional assertions]
```
```

## Mandatory Elements

### 1. Nested Under Requirement

Scenarios MUST be placed under the `#### BDD Scenarios` subsection within their parent requirement.

```markdown
### REQ-001: Display Order Status
**Priority:** Must Have
...

#### BDD Scenarios

**Scenario 001: Customer views shipped order**
**Scenario 002: Customer views non-existent order**
```

### 2. Sequential Numbering

- Number scenarios sequentially within each requirement: 001, 002, 003, ...
- Numbering restarts for each requirement
- Zero-padded for consistency

### 3. Descriptive Title

```markdown
**Scenario 001: User adds item to empty cart**
```

- Bold text for scenario title
- Includes scenario number
- Descriptive title (what is being tested)

### 4. Given/When/Then Structure

```gherkin
Scenario: Descriptive name
  Given [precondition]
  When [action]
  Then [outcome]
```

## Good Scenario Patterns

### Pattern 1: Happy Path

```markdown
### REQ-001: User Registration
...

#### BDD Scenarios

**Scenario 001: Successful user registration**
```gherkin
Scenario: User registers with valid email and password
  Given the user is on the registration page
  And no account exists with email "user@example.com"
  When the user submits:
    | Field    | Value              |
    | Email    | user@example.com   |
    | Password | SecureP@ss123      |
  Then the system SHALL create user account
  And the user SHALL receive confirmation email
  And the user SHALL be redirected to welcome page
```
```

### Pattern 2: Error Handling

```markdown
**Scenario 002: Registration fails with invalid email**
```gherkin
Scenario: User attempts registration with invalid email format
  Given the user is on the registration page
  When the user submits:
    | Field    | Value           |
    | Email    | invalid.email   |
    | Password | SecureP@ss123   |
  Then the system SHALL NOT create account
  And the system SHALL display error "Invalid email format"
  And the user SHALL remain on registration page
```
```

### Pattern 3: Boundary Testing

```markdown
### REQ-002: Password Validation
...

#### BDD Scenarios

**Scenario 001: Password length boundaries**
```gherkin
Scenario Outline: Password validation at boundaries
  Given the user is registering
  When the user provides password with <length> characters
  Then the system SHALL <result>
  And the user SHALL see <message>

  Examples:
    | length | result        | message                              |
    | 7      | reject        | "Password must be at least 8 chars"  |
    | 8      | accept        | "Password meets requirements"        |
    | 64     | accept        | "Password meets requirements"        |
    | 65     | reject        | "Password must be max 64 chars"      |
```
```

### Pattern 4: State Transitions

```markdown
### REQ-010: Order State Management
...

#### BDD Scenarios

**Scenario 001: Order status progression**
```gherkin
Scenario: Order moves through states correctly
  Given an order exists in "pending" state
  When the payment is confirmed
  Then the order SHALL transition to "processing"

  When the items are shipped
  Then the order SHALL transition to "shipped"

  When the customer confirms delivery
  Then the order SHALL transition to "completed"
```
```

### Pattern 5: Concurrent Actions

```markdown
### REQ-015: Prevent Duplicate Order Submission
...

#### BDD Scenarios

**Scenario 001: User clicks submit twice quickly**
```gherkin
Scenario: User clicks submit twice quickly
  Given the user has items in cart
  And the user is on checkout page
  When the user clicks "Place Order"
  And the user clicks "Place Order" again before first request completes
  Then the system SHALL create exactly 1 order
  And the system SHALL disable submit button after first click
  And the second click SHALL have no effect
```
```

## Scenario Quality Rules

### Rule 1: One Behavior Per Scenario

❌ Bad (tests multiple unrelated behaviors):
```gherkin
Scenario: User does everything
  Given user logs in
  When user adds items and checks out and pays
  Then user is happy
```

✅ Good (focused on one behavior):
```gherkin
Scenario: User adds item to cart
  Given the user is logged in
  And the user views product "Laptop"
  When the user clicks "Add to Cart"
  Then the cart SHALL contain 1 item
  And the cart total SHALL be $999.99
```

### Rule 2: Test Behavior, Not Implementation

❌ Bad (tests implementation):
```gherkin
Scenario: System calls payment API
  Given payment service is running
  When API endpoint /payment/process is called
  Then response code is 200
  And database record is created
```

✅ Good (tests behavior):
```gherkin
Scenario: Customer pays for order
  Given the customer has an order
  And the customer provides valid payment details
  When the customer submits payment
  Then the order SHALL be marked as paid
  And the customer SHALL receive payment confirmation
```

### Rule 3: Be Specific

❌ Bad (too vague):
```gherkin
Scenario: Cart works
  Given user wants to buy something
  When they add items
  Then it works
```

✅ Good (specific and testable):
```gherkin
Scenario: Add first item to cart
  Given the user has an empty cart
  When the user adds "Laptop" priced at $999.99
  Then the cart SHALL contain exactly 1 item
  And the cart total SHALL be $999.99
  And the user SHALL see "Item added to cart"
```

### Rule 4: Include Context in Given

❌ Bad (missing context):
```gherkin
Scenario: User deletes account
  When the user clicks delete
  Then account is deleted
```

✅ Good (proper context):
```gherkin
Scenario: User deletes account with no active subscriptions
  Given the user is logged in
  And the user has no active subscriptions
  And the user has no pending orders
  When the user confirms account deletion
  Then the system SHALL delete the account
  And the user SHALL receive deletion confirmation email
```

## Scenario Outline (Data-Driven)

Use for testing multiple similar cases:

```gherkin
<a id="scenario-006"></a>
#### Scenario 006: Email validation edge cases
**Requirement:** [REQ-020](#req-020)

Scenario Outline: Validate email format variations
  Given the user is registering
  When the user provides email <email>
  Then the system SHALL <result>
  And show message <message>
  
  Examples: Valid emails
    | email                    | result | message                    |
    | user@example.com         | accept | "Registration successful"  |
    | user+tag@example.com     | accept | "Registration successful"  |
    | user.name@example.co.uk  | accept | "Registration successful"  |
  
  Examples: Invalid emails
    | email                | result | message                |
    | invalid.email        | reject | "Invalid email format" |
    | @example.com         | reject | "Invalid email format" |
    | user@                | reject | "Invalid email format" |
    | user space@test.com  | reject | "Invalid email format" |
```

## Background (Shared Setup)

Use for common preconditions across multiple scenarios:

```gherkin
Feature: Shopping Cart

Background:
  Given the user is logged in as "customer@example.com"
  And the product catalog is available
  And the user has an empty cart

Scenario 001: Add first item
  When the user adds "Laptop" to cart
  Then the cart SHALL contain 1 item

Scenario 002: Add second item
  When the user adds "Mouse" to cart
  And the user adds "Keyboard" to cart
  Then the cart SHALL contain 2 items
```

## Traceability

### Visual Nesting Provides Traceability

Scenarios are nested under their parent requirement, making the relationship visually obvious:

```markdown
### REQ-001: User Registration
**Priority:** Must Have
...
**Acceptance Criteria:**
  - AC-001.1: ...
  - AC-001.2: ...

#### BDD Scenarios

**Scenario 001: Successful registration**
```gherkin
...
```

**Scenario 002: Registration with invalid email**
```gherkin
...
```
```

### Validation

- Every requirement MUST have a `#### BDD Scenarios` subsection
- Every requirement MUST have at least one scenario
- Scenarios MUST be nested under requirements (not standalone)
- Traceability matrix shows scenario count per requirement
- Coverage MUST be 100%

## Common Mistakes

### Mistake 1: Scenarios Not Nested Under Requirements

❌ Bad:
```markdown
### REQ-001: User Login
...

## 6. BDD Scenarios

#### Scenario 001: User logs in
```

✅ Good:
```markdown
### REQ-001: User Login
...

#### BDD Scenarios

**Scenario 001: User logs in**
```

### Mistake 2: Missing BDD Scenarios Subsection

❌ Bad:
```markdown
### REQ-001: User logs in
**Priority:** Must Have
...

**Scenario 001: User logs in successfully**
```

✅ Good:
```markdown
### REQ-001: User Login
**Priority:** Must Have
...

#### BDD Scenarios

**Scenario 001: User logs in successfully**
```

### Mistake 3: Testing Multiple Behaviors

❌ Bad:
```gherkin
Scenario: Complete user journey
  Given user visits site
  When user registers, logs in, adds items, checks out, and pays
  Then everything works
```

✅ Good (separate scenarios):
```gherkin
Scenario 001: User registration
  Given user visits registration page
  When user submits valid registration form
  Then account is created

Scenario 002: User login
  Given user has registered account
  When user submits valid credentials
  Then user is logged in

Scenario 003: Add item to cart
  Given user is logged in
  When user adds item to cart
  Then cart contains item
```

### Mistake 4: Implementation Details

❌ Bad:
```gherkin
Scenario: Database update
  Given database connection is open
  When INSERT statement executes
  Then row count is incremented
```

✅ Good:
```gherkin
Scenario: Save user profile
  Given user has updated their profile
  When user clicks "Save"
  Then profile changes SHALL persist
  And user SHALL see "Profile updated"
```

## Scenario Coverage Checklist

For each requirement, ensure scenarios cover:

- [ ] Happy path (primary success scenario)
- [ ] Alternative flows (valid variations)
- [ ] Error cases (validation failures, system errors)
- [ ] Boundary conditions (min, max, zero, one)
- [ ] Corner cases (unusual but valid situations)
- [ ] Concurrent actions (if applicable)
- [ ] State transitions (if stateful)

## Example: Complete Scenario Set

```markdown
### REQ-005: Add Item to Cart
**Priority:** Must Have
**Description:** System SHALL allow users to add items to cart...
**Acceptance Criteria:**
  - AC-005.1: ...

#### BDD Scenarios

**Scenario 001: Add item to empty cart (Happy Path)**
```gherkin
Scenario: User adds first item to cart
  Given the user has an empty cart
  And product "Laptop" is in stock
  When the user adds "Laptop" to cart
  Then the cart SHALL contain 1 item
  And the cart total SHALL be $999.99
```

**Scenario 002: Add item when out of stock (Error Case)**
```gherkin
Scenario: User attempts to add out-of-stock item
  Given the user has an empty cart
  And product "Laptop" is out of stock
  When the user attempts to add "Laptop"
  Then the system SHALL NOT add item to cart
  And the user SHALL see "Item out of stock"
```

**Scenario 003: Add item at cart limit (Boundary)**
```gherkin
Scenario: User adds item when cart is at limit
  Given the user has 99 items in cart
  And the cart limit is 100 items
  When the user adds 1 more item
  Then the cart SHALL contain 100 items

  When the user attempts to add another item
  Then the system SHALL reject the addition
  And the user SHALL see "Cart limit reached"
```
```

## Tools for Validation

After generating scenarios, validate:

```bash
# Check all requirements have BDD Scenarios subsections
grep -c "^#### BDD Scenarios" requirements.md

# Count total scenarios
grep -c "^\*\*Scenario [0-9]" requirements.md

# Verify scenarios are nested (should find scenario headers after BDD Scenarios markers)
```
