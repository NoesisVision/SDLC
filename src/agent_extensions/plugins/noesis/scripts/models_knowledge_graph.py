"""Knowledge graph schema models."""

from pydantic import BaseModel

from models_core import Decision, Topic, Turn


class ConversationSummary(BaseModel):
    conversation_id: str
    time: str
    main_topic: str
    turns: list[Turn]


class TopicOverview(BaseModel):
    id: str
    title: str
    short_summary: str
    long_summary: str
    has_subtopics: bool
    path: list[str]


class KnowledgeGraph(BaseModel):
    conversations: list[ConversationSummary]
    topics: list[Topic]
    decisions: list[Decision]
