# BDD Scenario Examples

This file contains examples of BDD scenarios for reference when creating model-changes.json.

## Format

BDD scenarios in the JSON file should be formatted as strings with newlines (`\n`) separating each line:

```json
"Scenario: User successfully logs in\n  Given the user is on the login page\n  And the user has valid credentials\n  When the user enters username and password\n  And clicks the login button\n  Then the user should be redirected to the dashboard\n  And a success message should be displayed"
```

## Example 1: Happy Path

```gherkin
Scenario: Calculate prorated refund for mid-period cancellation
  Given a user has an active subscription
  And the subscription billing period is monthly
  And 15 days remain in the current billing period
  When the user cancels the subscription
  Then the system SHALL calculate a prorated refund
  And the refund amount SHALL be 50% of the monthly fee
```

## Example 2: Edge Case

```gherkin
Scenario: Handle cancellation on last day of billing period
  Given a user has an active subscription
  And today is the last day of the billing period
  When the user cancels the subscription
  Then the system SHALL NOT issue a refund
  And the subscription SHALL remain active until midnight
```

## Example 3: Error Condition

```gherkin
Scenario: Reject refund calculation for invalid subscription
  Given a user has a cancelled subscription
  When the system attempts to calculate a prorated refund
  Then the system SHALL raise an InvalidSubscriptionStateError
  And the user SHALL receive an error message
```

## Example 4: Complex Business Rule

```gherkin
Scenario: Apply minimum billing period before allowing cancellation
  Given a user has a subscription with 3-month minimum commitment
  And only 1 month has elapsed since subscription start
  When the user attempts to cancel the subscription
  Then the system SHALL reject the cancellation
  And display the remaining commitment period
  And offer the option to schedule cancellation for a future date
```

## Tips for Writing BDD Scenarios in JSON

1. **Use proper escaping**: Remember to escape newlines as `\n` in JSON strings
2. **Keep scenarios focused**: Each scenario tests one specific behavior
3. **Use consistent Given-When-Then structure**:
   - **Given**: Setup/preconditions
   - **When**: Action/trigger
   - **Then**: Expected outcome
4. **Make assertions testable**: Avoid vague terms like "works correctly"
5. **Include edge cases**: Don't just test happy paths
6. **Use business language**: Avoid technical implementation details
