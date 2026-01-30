# Output Template

## Core Principle
- You MUST outputs TWO files: design.md and model-changes.json.
- You MUST strictly follow markdown teplate for design.md and JSON schema for model-changes.json.
- You MUST NOT add explanatory text, comments, or markdown formatting to model-changes.json.
- BDD scenarios must be properly escaped strings with `\n` for line breaks.

## File 1: design.md

```markdown
# [Feature Slug]

## Business Goal
[Describe the problem and business value in 2-5 sentences.]

## Rationale
[Explain why this feature is needed and the expected impact.]

## Functional Requirements

### FR-01: [Action-Oriented Title]

**Description:** System SHALL [testable behavior] WHEN [condition or trigger] SO THAT [business value]

## Non-Functional Requirements

### NFR-01: [Category]
- **Requirement:** [Specific, measurable target]
- **Measurement:** [How compliance is verified]
- **Related Requirements:** [FR-XX]

### NFR-02: [Category]
- **Requirement:** [...]
- **Measurement:** [...]
```

## File 2: model-changes.json

### Validation

The generated `model-changes.json` MUST be validated against the schema in `model-changes-schema.json`.
Use the provided validation script:
```bash
./validate-model-changes.sh model-changes.json
```

The script automatically uses the best available validator:
1. ajv-cli (if installed)
2. Python jsonschema (if installed)
3. Basic JSON syntax check (fallback)

### Schema Quick Reference

**ElementChange** (changeType: "element"):
- `elementType`: `"DomainBehavior"` | `"DomainObject"` | `"DomainModule"`
- `operation`: `"Create"` | `"Update"` | `"Delete"`
- **Create**: Requires `name` (string), `tags` (array of strings)
  - For DomainBehavior: Also requires `businessRules` (array of {name, description}) and `bddScenarios` (array of strings with `\n`)
- **Update**: Requires `elementId` (string - P3 Element ID), `tags` (array of strings)
  - For DomainBehavior: Also requires `businessRules` and `bddScenarios`
- **Delete**: Requires only `elementId` (string)

**RelationChange** (changeType: "relation"):
- `operation`: `"Create"` | `"Delete"`
- Required: `sourceId`, `destinationId` (string - P3 Element IDs)
- `type`: Must be one of:
  - `"DomainBehavior.InvokesBehavior"` - behavior calls another behavior
  - `"DomainBehavior.UsesObject"` - behavior uses domain object
  - `"DomainModule.ContainsDomainModule"` - module contains module
  - `"DomainModule.ContainsObject"` - module contains object
  - `"DomainModule.ContainsBehavior"` - module contains behavior
  - `"DomainObject.ContainsBehavior"` - object contains behavior
  - `"DomainObject.UsesObject"` - object uses another object

### Example

```json
{
  "changes": [
    {
      "changeType": "element",
      "elementType": "DomainBehavior",
      "operation": "Create",
      "name": "CalculateProration",
      "tags": ["EntryPoint"],
      "businessRules": [
        {
          "name": "BR-01: Prorated Refund Calculation",
          "description": "When a subscription is cancelled mid-period, the refund SHALL be calculated as (remaining_days / total_days) * monthly_fee"
        }
      ],
      "bddScenarios": [
        "Scenario: Calculate prorated refund for mid-period cancellation\n  Given a user has an active subscription\n  And the subscription billing period is monthly\n  And 15 days remain in the current billing period\n  When the user cancels the subscription\n  Then the system SHALL calculate a prorated refund\n  And the refund amount SHALL be 50% of the monthly fee"
      ]
    },
    {
      "changeType": "relation",
      "operation": "Create",
      "sourceId": "CalculateProration",
      "destinationId": "Subscription",
      "type": "DomainBehavior.UsesObject"
    }
  ]
}
```
