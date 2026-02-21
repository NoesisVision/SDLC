"""Dynamic topic mapping via embedding similarity and LLM arbitration.

Maintains a global topic registry where each topic has a centroid vector
(average of member embeddings). New idea units are routed to existing topics
or spawn new ones based on cosine similarity thresholds, with LLM arbitration
for ambiguous cases.
"""

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent
from sentence_transformers import SentenceTransformer

from .idea_unit import IdeaUnit, IdeaUnitCategory, TurnIdeaUnits

logger = logging.getLogger(__name__)

HIGH_CONFIDENCE_THRESHOLD = 0.82
LOW_CONFIDENCE_THRESHOLD = 0.65
_SUMMARY_UPDATE_COOLDOWN = 3
_MAX_RETRIES = 2
_EMBEDDING_MODEL = "all-MiniLM-L6-v2"

_NEW_TOPIC_PROMPT = """\
Create a topic label and summary for this discussion fragment.

Fragment ({category}): "{text}"

JSON: {{"label": "2-5 word topic name", "summary": "1-2 sentence description"}}"""

_ARBITRATION_PROMPT = """\
Does this fragment belong to an existing topic or introduce a new one?

Fragment ({category}): "{text}"

Topics:
{topics}

If existing: {{"topic_id": "<id>"}}
If new: {{"topic_id": "NEW", "label": "2-5 word name", "summary": "1-2 sentence description"}}"""

_SUMMARY_UPDATE_PROMPT = """\
Revise this topic summary incorporating new information. Denser, more informative. 1-3 sentences max.

Current: "{summary}"
New ({category}): "{text}"

JSON: {{"summary": "revised summary"}}"""


@dataclass
class TopicEntry:
    """Internal state for a single topic in the registry."""

    topic_id: str
    label: str
    summary: str
    centroid: np.ndarray
    idea_unit_count: int = 0
    additions_since_summary_update: int = 0
    statements: dict[tuple[str, str], list[IdeaUnit]] = field(default_factory=lambda: defaultdict(list))


class TopicRegistry:
    """In-memory registry of topics with embedding-based matching.

    Manages topic creation, assignment, centroid updates, and summary evolution.
    """

    def __init__(self, ctx: Context) -> None:
        self._ctx = ctx
        self._topics: dict[str, TopicEntry] = {}
        self._next_id = 1
        self._model: SentenceTransformer | None = None

    @property
    def topics(self) -> dict[str, TopicEntry]:
        """Access the current topic entries."""
        return self._topics

    async def assign_idea_units(
        self,
        turn_idea_units_list: list[TurnIdeaUnits],
        embeddings: dict[int, np.ndarray],
    ) -> None:
        """Assign all non-irrelevant idea units to topics.

        Args:
            turn_idea_units_list: All turns with their extracted idea units.
            embeddings: Pre-computed embeddings keyed by global idea unit index.
        """
        global_idx = 0
        for turn in turn_idea_units_list:
            for idea_unit in turn.idea_units:
                if idea_unit.category != IdeaUnitCategory.Irrelevant:
                    embedding = embeddings[global_idx]
                    await self._assign_single(idea_unit, embedding, turn.speaker, turn.time)
                global_idx += 1

    def encode_all_idea_units(self, turn_idea_units_list: list[TurnIdeaUnits]) -> dict[int, np.ndarray]:
        """Batch-encode all idea unit texts into embeddings.

        Args:
            turn_idea_units_list: All turns with their extracted idea units.

        Returns:
            Mapping from global idea unit index to its embedding vector.
        """
        model = self._get_model()
        texts: list[str] = []
        indices: list[int] = []
        global_idx = 0

        for turn in turn_idea_units_list:
            for idea_unit in turn.idea_units:
                if idea_unit.category != IdeaUnitCategory.Irrelevant:
                    texts.append(" ".join(idea_unit.sentences))
                    indices.append(global_idx)
                global_idx += 1

        if not texts:
            return {}

        vectors = model.encode(texts, show_progress_bar=False)
        return {idx: vec for idx, vec in zip(indices, vectors)}

    async def _assign_single(
        self,
        idea_unit: IdeaUnit,
        embedding: np.ndarray,
        speaker: str,
        time: str,
    ) -> None:
        if not self._topics:
            await self._create_new_topic(idea_unit, embedding, speaker, time)
            return

        scores = self._compute_similarities(embedding)
        best_topic_id, best_score = scores[0]

        if best_score > HIGH_CONFIDENCE_THRESHOLD:
            await self._assign_to_topic(best_topic_id, idea_unit, embedding, speaker, time)
        elif best_score < LOW_CONFIDENCE_THRESHOLD:
            await self._create_new_topic(idea_unit, embedding, speaker, time)
        else:
            await self._arbitrate(idea_unit, embedding, speaker, time, scores[:3])

    def _compute_similarities(self, embedding: np.ndarray) -> list[tuple[str, float]]:
        scores: list[tuple[str, float]] = []
        for topic_id, entry in self._topics.items():
            similarity = float(np.dot(embedding, entry.centroid) / (
                np.linalg.norm(embedding) * np.linalg.norm(entry.centroid)
            ))
            scores.append((topic_id, similarity))
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores

    async def _create_new_topic(
        self,
        idea_unit: IdeaUnit,
        embedding: np.ndarray,
        speaker: str,
        time: str,
    ) -> None:
        topic_id = f"topic_{self._next_id:03d}"
        self._next_id += 1
        text = " ".join(idea_unit.sentences)

        label, summary = await self._generate_topic_label_and_summary(text, idea_unit.category.value)

        entry = TopicEntry(
            topic_id=topic_id,
            label=label,
            summary=summary,
            centroid=embedding.copy(),
            idea_unit_count=1,
        )
        entry.statements[(speaker, time)].append(idea_unit)
        self._topics[topic_id] = entry

    async def _assign_to_topic(
        self,
        topic_id: str,
        idea_unit: IdeaUnit,
        embedding: np.ndarray,
        speaker: str,
        time: str,
    ) -> None:
        entry = self._topics[topic_id]
        self._update_centroid(entry, embedding)
        entry.statements[(speaker, time)].append(idea_unit)
        entry.additions_since_summary_update += 1
        await self._maybe_update_summary(entry, idea_unit)

    async def _arbitrate(
        self,
        idea_unit: IdeaUnit,
        embedding: np.ndarray,
        speaker: str,
        time: str,
        candidates: list[tuple[str, float]],
    ) -> None:
        text = " ".join(idea_unit.sentences)
        topics_text = "\n".join(
            f"- {tid}: {self._topics[tid].label} -- {self._topics[tid].summary}"
            for tid, _ in candidates
        )

        prompt = _ARBITRATION_PROMPT.format(
            category=idea_unit.category.value,
            text=text,
            topics=topics_text,
        )

        decision = await self._call_llm_json(prompt)
        if decision is None:
            await self._assign_to_topic(candidates[0][0], idea_unit, embedding, speaker, time)
            return

        chosen_id = decision.get("topic_id", "NEW")
        if chosen_id == "NEW":
            label = decision.get("label", "")
            summary = decision.get("summary", "")
            if label and summary:
                topic_id = f"topic_{self._next_id:03d}"
                self._next_id += 1
                entry = TopicEntry(
                    topic_id=topic_id,
                    label=label,
                    summary=summary,
                    centroid=embedding.copy(),
                    idea_unit_count=1,
                )
                entry.statements[(speaker, time)].append(idea_unit)
                self._topics[topic_id] = entry
            else:
                await self._create_new_topic(idea_unit, embedding, speaker, time)
        elif chosen_id in self._topics:
            await self._assign_to_topic(chosen_id, idea_unit, embedding, speaker, time)
        else:
            logger.warning("LLM returned unknown topic_id '%s', falling back to best match", chosen_id)
            await self._assign_to_topic(candidates[0][0], idea_unit, embedding, speaker, time)

    @staticmethod
    def _update_centroid(entry: TopicEntry, new_embedding: np.ndarray) -> None:
        n = entry.idea_unit_count
        entry.centroid = (entry.centroid * n + new_embedding) / (n + 1)
        entry.idea_unit_count += 1

    async def _maybe_update_summary(self, entry: TopicEntry, idea_unit: IdeaUnit) -> None:
        is_significant = idea_unit.category in (IdeaUnitCategory.Position, IdeaUnitCategory.Decision)

        if is_significant:
            await self._update_summary(entry, idea_unit)
            return

        if entry.additions_since_summary_update >= _SUMMARY_UPDATE_COOLDOWN:
            await self._update_summary(entry, idea_unit)

    async def _update_summary(self, entry: TopicEntry, idea_unit: IdeaUnit) -> None:
        text = " ".join(idea_unit.sentences)
        prompt = _SUMMARY_UPDATE_PROMPT.format(
            summary=entry.summary,
            category=idea_unit.category.value,
            text=text,
        )

        result = await self._call_llm_json(prompt)
        if result and "summary" in result:
            entry.summary = result["summary"]
            entry.additions_since_summary_update = 0

    async def _generate_topic_label_and_summary(self, text: str, category: str) -> tuple[str, str]:
        prompt = _NEW_TOPIC_PROMPT.format(category=category, text=text)
        result = await self._call_llm_json(prompt)

        if result and "label" in result and "summary" in result:
            return result["label"], result["summary"]

        return text[:50], text[:200]

    async def _call_llm_json(self, prompt: str) -> dict | None:
        for attempt in range(_MAX_RETRIES):
            try:
                result = await self._ctx.session.create_message(
                    messages=[SamplingMessage(role="user", content=TextContent(type="text", text=prompt))],
                    max_tokens=500,
                    temperature=0.1,
                )
                raw = result.content.text.strip()
                return _parse_json_response(raw)
            except Exception:
                if attempt == _MAX_RETRIES - 1:
                    logger.exception("LLM call failed after %d attempts", _MAX_RETRIES)
                    return None
                logger.warning("LLM call failed (attempt %d/%d), retrying", attempt + 1, _MAX_RETRIES)
        return None

    def _get_model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(_EMBEDDING_MODEL)
        return self._model


def _parse_json_response(raw: str) -> dict | None:
    text = raw
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    return parsed
