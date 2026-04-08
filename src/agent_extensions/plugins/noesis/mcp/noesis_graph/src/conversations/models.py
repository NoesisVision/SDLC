"""Data models for conversation processing."""

import re

from pydantic import BaseModel, Field

CONVERSATION_ID_PATTERN = re.compile(r"^<!--\s*conversation_id:\s*([\w-]+)\s*-->")


class RawConversationMetadata(BaseModel):
    """Metadata extracted from a conversation transcript."""

    title: str | None = Field(default=None, description="Title of the conversation")
    date: str | None = Field(default=None, description="Date and time in YYYY-MM-DD HH:MM format")


class RawSpeakerTurn(BaseModel):
    """A single raw speaker turn in the conversation."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(
        description="Time of the statement relative to the beginning of the conversation in HH:MM:SS format"
    )
    sentences: list[str] = Field(description="Individual sentences from the speaker's text")


class RawConversation(BaseModel):
    """Raw conversation data."""

    conversation_id: str = Field(description="UUID identifying the conversation")
    metadata: RawConversationMetadata = Field(description="Conversation metadata")
    turns: list[RawSpeakerTurn] = Field(description="Speaker turns in the conversation")


class RegisterConversationResponse(BaseModel):
    """Response from register_conversation tool."""

    conversation_id: str = Field(description="UUID identifying the conversation")
    status: str = Field(description="'success' or 'incomplete'")
    missing: list[str] = Field(default_factory=list, description="Missing metadata fields")


class SetConversationMetadataResponse(BaseModel):
    """Response from set_metadata tool."""

    status: str = Field(description="'success'")


class GetRawSpeakerTurnsResponse(BaseModel):
    """Response from get_raw_speaker_turns tool."""

    turns: list[RawSpeakerTurn] = Field(description="Filtered speaker turns")
