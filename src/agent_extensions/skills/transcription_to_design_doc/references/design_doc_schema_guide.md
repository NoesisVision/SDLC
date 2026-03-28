# DesignDoc Schema Guide

The DesignDoc describes changes to a system design as a diff. The JSON uses **camelCase** for multi-word field names.

## ChangeSet Pattern

Every collection in DesignDoc uses the ChangeSet pattern:

```json
{
  "added": [],
  "removed": [],
  "modified": []
}
```

- **added** — new elements. All required fields must be populated.
- **removed** — list of names (strings) of elements to remove.
- **modified** — elements with only changed fields set (plus `name` to identify which element). Unchanged fields are omitted or null.

**First iteration** (no existing design): everything goes into `added`. The `removed` and `modified` arrays stay empty.

**Modification** (existing design provided): compute the diff. Unchanged collections should be `null` (omitted from JSON).

## Root: DesignDoc

```json
{
  "description": "Summary of what this design change covers",
  "actors": { ChangeSet[Actor] },
  "boundedContexts": { ChangeSet[BoundedContext] }
}
```

Only `description` is required. Omit collections with no changes (set to `null` or leave out).

There are NO top-level fields for business goals, quality attributes, use cases, or domain concepts. Those concepts are modeled differently:
- **Use cases** → public behaviours on building blocks (`is_public: true` with `actor` set)
- **Business goals, quality attributes** → captured in descriptions and rules
- **Domain concepts** → captured as building block names and descriptions

## Element Types

### Actor
```json
{ "name": "Customer", "description": "End user placing orders" }
```
`name` is required. `description` is optional.

### Rule
```json
{ "name": "Order total consistency", "ruleType": "Consistency", "description": "Order total must equal sum of item prices" }
```
`name` is required. `ruleType` and `description` are optional.
RuleType enum: `Consistency`, `Structure`, `Computation`, `State change`.

### Scenario (BDD)
```json
{
  "name": "Successful order placement",
  "description": "Customer places an order with valid items",
  "given": "A customer with items in cart",
  "when": "The customer submits the order",
  "then": "An OrderPlaced event is emitted and order status is PLACED"
}
```
All five fields are required.

### Property
```json
{ "name": "total", "type": "Money" }
```
`name` is required. `type` is optional (BuildingBlock name or primitive type name).

### Behaviour
```json
{
  "name": "place",
  "description": "Places a new order",
  "type": "Command",
  "input": { "added": ["PlaceOrder"], "removed": [], "modified": [] },
  "output": { "added": ["OrderPlaced"], "removed": [], "modified": [] },
  "usedBuildingBlocks": { "added": ["OrderItem"], "removed": [], "modified": [] },
  "rules": { ChangeSet[Rule] },
  "scenarios": { ChangeSet[Scenario] },
  "is_public": true,
  "actor": "Customer"
}
```
`name` is required. All other fields are optional.

- `type` — BehaviorType enum: `Command`, `Event`, `Query`
- `input`, `output`, `usedBuildingBlocks` — ChangeSet[str] referencing BuildingBlock **names** (not IDs)
- `is_public` — defaults to `false`. Set to `true` for behaviours that represent use cases (entry points into the system initiated by an actor)
- `actor` — name of the Actor who initiates this behaviour (relevant when `is_public: true`)

**Use cases are modeled as public behaviours.** When a meeting discusses a use case like "Customer places an order", model it as a behaviour on the relevant aggregate with `is_public: true` and `actor: "Customer"`. Include scenarios, rules, input/output building blocks.

### BuildingBlock
```json
{
  "name": "Order",
  "type": "aggregate",
  "description": "Order aggregate root. Contains OrderItem entities.",
  "properties": { ChangeSet[Property] },
  "behaviours": { ChangeSet[Behaviour] },
  "rules": { ChangeSet[Rule] },
  "scenarios": { ChangeSet[Scenario] }
}
```
`name` is required. When adding, populate `type` and `description` at minimum.

BuildingBlockType enum: `aggregate`, `entity`, `value_object`, `domain_event`, `domain_command`, `domain_query`, `domain_service`, `application_service`, `repository`, `factory`, `external_integration`.

### DomainModule
```json
{
  "name": "Order Management",
  "description": "Core order processing",
  "buildingBlocks": { ChangeSet[BuildingBlock] }
}
```
`name` is required. When adding, populate `description`.

### BoundedContext
```json
{
  "name": "Ordering",
  "description": "Handles order lifecycle",
  "modules": { ChangeSet[DomainModule] },
  "buildingBlocks": { ChangeSet[BuildingBlock] }
}
```
`name` is required. When adding, populate `description`. `buildingBlocks` here holds BBs not belonging to any module.

## Complete First-Iteration Example

```json
{
  "description": "Initial design for order management system",
  "actors": {
    "added": [
      { "name": "Customer", "description": "End user placing orders" }
    ],
    "removed": [],
    "modified": []
  },
  "boundedContexts": {
    "added": [
      {
        "name": "Ordering",
        "description": "Handles order lifecycle",
        "modules": {
          "added": [
            {
              "name": "Order Management",
              "description": "Core order processing",
              "buildingBlocks": {
                "added": [
                  {
                    "name": "Order",
                    "type": "aggregate",
                    "description": "Order aggregate root",
                    "properties": {
                      "added": [
                        { "name": "id", "type": "OrderId" },
                        { "name": "status", "type": "OrderStatus" },
                        { "name": "total", "type": "Money" }
                      ],
                      "removed": [],
                      "modified": []
                    },
                    "behaviours": {
                      "added": [
                        {
                          "name": "place",
                          "description": "Places a new order",
                          "type": "Command",
                          "is_public": true,
                          "actor": "Customer",
                          "input": { "added": ["PlaceOrder"], "removed": [], "modified": [] },
                          "output": { "added": ["OrderPlaced"], "removed": [], "modified": [] },
                          "rules": {
                            "added": [
                              {
                                "name": "Order total consistency",
                                "ruleType": "Consistency",
                                "description": "Order total must equal sum of item prices"
                              }
                            ],
                            "removed": [],
                            "modified": []
                          },
                          "scenarios": {
                            "added": [
                              {
                                "name": "Successful order placement",
                                "description": "Customer places an order with valid items",
                                "given": "A customer with items in cart",
                                "when": "The customer submits the order",
                                "then": "An OrderPlaced event is emitted and order status is PLACED"
                              }
                            ],
                            "removed": [],
                            "modified": []
                          }
                        }
                      ],
                      "removed": [],
                      "modified": []
                    }
                  },
                  {
                    "name": "PlaceOrder",
                    "type": "domain_command",
                    "description": "Command to place a new order",
                    "properties": {
                      "added": [
                        { "name": "customerId", "type": "CustomerId" },
                        { "name": "items", "type": "list[OrderItemData]" }
                      ],
                      "removed": [],
                      "modified": []
                    }
                  },
                  {
                    "name": "OrderPlaced",
                    "type": "domain_event",
                    "description": "Event emitted when an order is successfully placed",
                    "properties": {
                      "added": [
                        { "name": "orderId", "type": "OrderId" },
                        { "name": "customerId", "type": "CustomerId" },
                        { "name": "total", "type": "Money" }
                      ],
                      "removed": [],
                      "modified": []
                    }
                  }
                ],
                "removed": [],
                "modified": []
              }
            }
          ],
          "removed": [],
          "modified": []
        }
      }
    ],
    "removed": [],
    "modified": []
  }
}
```

## Modification Example (diff against existing design)

When modifying an existing design, only include what changed:

```json
{
  "description": "Add cancellation capability to order management",
  "boundedContexts": {
    "added": [],
    "removed": [],
    "modified": [
      {
        "name": "Ordering",
        "modules": {
          "added": [],
          "removed": [],
          "modified": [
            {
              "name": "Order Management",
              "buildingBlocks": {
                "added": [
                  {
                    "name": "CancelOrder",
                    "type": "domain_command",
                    "description": "Command to cancel an existing order",
                    "properties": {
                      "added": [{ "name": "orderId", "type": "OrderId" }, { "name": "reason", "type": "string" }],
                      "removed": [],
                      "modified": []
                    }
                  }
                ],
                "removed": [],
                "modified": [
                  {
                    "name": "Order",
                    "behaviours": {
                      "added": [
                        {
                          "name": "cancel",
                          "description": "Cancels the order if not yet shipped",
                          "type": "Command",
                          "is_public": true,
                          "actor": "Customer",
                          "input": { "added": ["CancelOrder"], "removed": [], "modified": [] },
                          "rules": {
                            "added": [
                              { "name": "Cancellation window", "ruleType": "State change", "description": "Order can only be cancelled before shipping" }
                            ],
                            "removed": [],
                            "modified": []
                          }
                        }
                      ],
                      "removed": [],
                      "modified": []
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

Note: `Ordering` and `Order Management` appear in `modified` (not `added`). Within them, only changed building blocks are listed. The `name` field identifies which existing element is being modified. Unchanged elements are omitted entirely.
