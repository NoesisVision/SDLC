"""Models for transcript parsing and structuring."""

import re

from pydantic import BaseModel

CONVERSATION_ID_PATTERN = re.compile(r"^<!--\s*conversation_id:\s*([\w-]+)\s*-->")


class RawTurn(BaseModel):
    speaker: str
    time: str
    sentences: list[str]


class RawTranscript(BaseModel):
    conversation_id: str
    turns: list[RawTurn]
