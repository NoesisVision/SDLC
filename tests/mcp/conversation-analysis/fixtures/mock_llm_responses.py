"""
Mock LLM responses for deterministic testing.

This module contains pre-defined LLM responses for use in unit and integration tests.
"""

# Mock IBIS Classification Response
MOCK_IBIS_RESPONSE = """
[
  {"id": "uuid-1", "category": "Statement", "terms": ["backend", "architecture", "project"]},
  {"id": "uuid-2", "category": "Position", "terms": ["Python", "backend", "FastAPI", "Django"]},
  {"id": "uuid-3", "category": "Issue", "terms": ["scalability", "Python", "traffic"]},
  {"id": "uuid-4", "category": "Argument", "terms": ["async", "FastAPI", "uvicorn", "performance"]},
  {"id": "uuid-5", "category": "Argument", "terms": ["Python", "ecosystem", "documentation"]},
  {"id": "uuid-6", "category": "Issue", "terms": ["database"]},
  {"id": "uuid-7", "category": "Position", "terms": ["PostgreSQL", "Python", "SQLAlchemy"]},
  {"id": "uuid-8", "category": "Position", "terms": ["FalkorDB", "knowledge graph", "Python"]},
  {"id": "uuid-9", "category": "Statement", "terms": ["PostgreSQL", "FalkorDB", "architecture"]},
  {"id": "uuid-10", "category": "Position", "terms": ["Redis", "caching"]},
  {"id": "uuid-11", "category": "Issue", "terms": ["deployment", "Docker"]},
  {"id": "uuid-12", "category": "Position", "terms": ["Docker", "Kubernetes"]},
  {"id": "uuid-13", "category": "Statement", "terms": ["FastAPI", "database", "schema"]},
  {"id": "uuid-14", "category": "Statement", "terms": ["FalkorDB", "Docker"]}
]
"""

# Mock Term Standardization Response
MOCK_TERM_STANDARDIZATION_RESPONSE = """
[
  {"original": "backend", "standardized": "Backend"},
  {"original": "fastapi", "standardized": "FastAPI"},
  {"original": "py", "standardized": "Python"},
  {"original": "db", "standardized": "Database"},
  {"original": "postgres", "standardized": "PostgreSQL"},
  {"original": "k8s", "standardized": "Kubernetes"}
]
"""

# Mock Topic Hierarchy Response
MOCK_TOPIC_HIERARCHY_RESPONSE = """
{
  "merges": [
    ["topic-1", "topic-2"],
    ["topic-5", "topic-6"]
  ],
  "hierarchies": [
    {
      "parent": "topic-3",
      "children": ["topic-7", "topic-8"]
    }
  ],
  "renamed": {
    "topic-1": "Python Backend Architecture",
    "topic-3": "Database Design",
    "topic-4": "Deployment Strategy"
  }
}
"""


def get_mock_ibis_response() -> str:
    """Get mock IBIS classification response."""
    return MOCK_IBIS_RESPONSE


def get_mock_standardization_response() -> str:
    """Get mock term standardization response."""
    return MOCK_TERM_STANDARDIZATION_RESPONSE


def get_mock_hierarchy_response() -> str:
    """Get mock topic hierarchy response."""
    return MOCK_TOPIC_HIERARCHY_RESPONSE
