"""Shared test data for noesis plugin script tests."""

SAMPLE_CONVERSATION_ID = "test-conv-001"

SAMPLE_TRANSCRIPT = """\
**00:05**
Alice
We need to discuss the authentication module design. The current implementation uses session cookies.

**00:32**
Bob
I think we should migrate to JWT tokens for session management. They are stateless and scale better with our microservices architecture.

**01:15**
Alice
Good point. What about refresh token rotation for security? We had issues with token theft last quarter.

**01:45**
Bob
Agreed. Let us implement refresh token rotation with a 15-minute access token lifetime. That is the decision then.

**02:10**
Alice
Sounds good. Oh by the way, is the conference room booked for tomorrow's standup?
"""

SAMPLE_TRANSCRIPT_WITH_ID = f"<!-- conversation_id: {SAMPLE_CONVERSATION_ID} -->\n{SAMPLE_TRANSCRIPT}"

SAMPLE_KNOWLEDGE_GRAPH = {
    "conversations": [],
    "topics": [
        {
            "id": "topic-auth",
            "title": "Authentication",
            "summary": "Authentication and identity management",
            "idea_units": [],
            "subtopics": [
                {
                    "id": "topic-jwt",
                    "title": "JWT Implementation",
                    "summary": "JSON Web Token based authentication",
                    "idea_units": [],
                    "subtopics": [],
                }
            ],
        },
        {
            "id": "topic-api",
            "title": "API Design",
            "summary": "REST API design patterns and standards",
            "idea_units": [],
            "subtopics": [],
        },
    ],
    "decisions": [],
}
