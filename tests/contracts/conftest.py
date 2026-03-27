import pytest


@pytest.fixture
def sample_design_doc_data() -> dict:
    return {
        "actors": [
            {"id": "actor-1", "name": "Customer", "description": "End user placing orders"}
        ],
        "businessGoals": [
            {"id": "bg-1", "name": "Enable online ordering", "description": "Allow customers to place orders online"}
        ],
        "domainConcepts": [
            {"id": "dc-1", "name": "Order", "description": "A request to purchase products"},
            {"id": "dc-2", "name": "OrderItem", "description": "A single product line within an order"},
        ],
        "rules": [
            {
                "id": "rule-1",
                "ruleType": "Consistency",
                "description": "Order total must equal sum of item prices",
            },
            {
                "id": "rule-2",
                "ruleType": "State change",
                "description": "Order can only be cancelled before shipping",
            },
        ],
        "qualityAttributes": [
            {
                "id": "qa-1",
                "name": "Order placement latency",
                "type": "performance",
                "description": "Order placement must complete within 500ms",
            }
        ],
        "boundedContexts": [
            {
                "id": "bc-1",
                "name": "Ordering",
                "description": "Handles order lifecycle",
                "modules": [
                    {
                        "id": "mod-1",
                        "name": "Order Management",
                        "description": "Core order processing",
                        "buildingBlocks": ["bb-1", "bb-2", "bb-3", "bb-4"],
                    }
                ],
                "buildingBlocks": [],
            }
        ],
        "buildingBlocks": [
            {
                "id": "bb-1",
                "name": "Order",
                "type": "aggregate",
                "description": "Order aggregate root. Contains OrderItem entities.",
                "properties": [
                    {"name": "id", "type": "OrderId"},
                    {"name": "status", "type": "OrderStatus"},
                    {"name": "total", "type": "Money"},
                ],
                "behaviours": [
                    {
                        "name": "place",
                        "description": "Places a new order",
                        "input": ["bb-3"],
                        "output": ["bb-4"],
                        "rules": ["rule-1"],
                    }
                ],
            },
            {
                "id": "bb-2",
                "name": "OrderItem",
                "type": "entity",
                "description": "A line item within an Order aggregate",
                "properties": [
                    {"name": "productId", "type": "ProductId"},
                    {"name": "quantity", "type": "int"},
                    {"name": "price", "type": "Money"},
                ],
                "behaviours": [],
            },
            {
                "id": "bb-3",
                "name": "PlaceOrder",
                "type": "domain_command",
                "description": "Command to place a new order",
                "properties": [
                    {"name": "customerId", "type": "CustomerId"},
                    {"name": "items", "type": "list[OrderItemData]"},
                ],
                "behaviours": [],
            },
            {
                "id": "bb-4",
                "name": "OrderPlaced",
                "type": "domain_event",
                "description": "Event emitted when an order is successfully placed",
                "properties": [
                    {"name": "orderId", "type": "OrderId"},
                    {"name": "customerId", "type": "CustomerId"},
                    {"name": "total", "type": "Money"},
                ],
                "behaviours": [],
            },
        ],
        "useCases": [
            {
                "id": "uc-1",
                "name": "Place Order",
                "actor": "actor-1",
                "type": "Command",
                "description": "Customer places a new order with selected products",
                "businessGoal": "bg-1",
                "input": ["bb-3"],
                "output": ["bb-4"],
                "usedBuildingBlocks": ["bb-1", "bb-2"],
                "rules": ["rule-1", "rule-2"],
                "scenarios": [
                    {
                        "name": "Successful order placement",
                        "description": "Customer places an order with valid items",
                        "given": "A customer with items in cart",
                        "when": "The customer submits the order",
                        "then": "An OrderPlaced event is emitted and order status is PLACED",
                    }
                ],
                "qualities": ["qa-1"],
            }
        ],
        "scenarios": [
            {
                "name": "Successful order placement",
                "description": "Customer places an order with valid items",
                "given": "A customer with items in cart",
                "when": "The customer submits the order",
                "then": "An OrderPlaced event is emitted and order status is PLACED",
            }
        ],
    }
