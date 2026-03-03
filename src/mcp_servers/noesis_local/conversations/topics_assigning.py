"""Tools for topic embedding and assignment."""

import logging
from collections import defaultdict

import numpy as np
from sentence_transformers import SentenceTransformer

from .models import (
    ArbitrationCandidate,
    ArbitrationRequest,
    AssignResponse,
    AssignmentEntry,
    AssignmentProgress,
    ConversationState,
    EmbedResponse,
    FlatIdeaUnit,
    IdeaUnit,
    IdeaUnitCategory,
    PendingArbitration,
    SpeakerTurn,
    TopicCluster,
    TopicDraftEntry,
    TopicForLabeling,
    TopicStatement,
    TopicsDraft,
)
from .registry import get_conversation

logger = logging.getLogger(__name__)

_HIGH_CONFIDENCE_THRESHOLD = 0.82
_LOW_CONFIDENCE_THRESHOLD = 0.65
_EMBEDDING_MODEL = "all-MiniLM-L6-v2"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


async def embed_idea_units(conversation_id: str) -> EmbedResponse:
    """Compute embeddings for all non-irrelevant idea units.

    Loads the sentence-transformer model, encodes idea unit texts,
    and stores the resulting vectors in memory.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Status and the number of embedded idea units.
    """
    state = get_conversation(conversation_id)

    if state.turns is None or not all(t.idea_units is not None for t in state.turns):
        raise ValueError(f"No idea units found for conversation {conversation_id}")

    model = SentenceTransformer(_EMBEDDING_MODEL)
    texts, idea_unit_refs = _collect_embeddable_texts(state.turns)

    if not texts:
        return EmbedResponse(status="success", embedded_count=0)

    vectors = model.encode(texts, show_progress_bar=False)
    for iu, vec in zip(idea_unit_refs, vectors):
        iu.embedding = vec
    return EmbedResponse(status="success", embedded_count=len(texts))


async def assign_topics(conversation_id: str) -> AssignResponse:
    """Assign idea units to topics using embedding similarity.

    Processes idea units sequentially. High-confidence matches are assigned
    automatically, low-confidence cases spawn new topics. Ambiguous cases
    (between thresholds) pause and return an arbitration request.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Success with topic count, or arbitration request for ambiguous cases.
    """
    state = get_conversation(conversation_id)

    if state.turns is None or not all(t.idea_units is not None for t in state.turns):
        raise ValueError(f"No idea units found for conversation {conversation_id}")

    flat_units = _flatten_idea_units(state.turns)
    progress = AssignmentProgress(topics={}, next_id=1, assignments={})
    return _run_assignment_loop(state, flat_units, progress, position=0)


async def apply_topic_arbitration(conversation_id: str, topic_id: str) -> AssignResponse:
    """Apply an arbitration decision and continue topic assignment.

    Applies the chosen topic_id (or "NEW" for a new topic) to the pending
    ambiguous idea unit, then resumes the assignment loop.

    Args:
        conversation_id: UUID identifying the conversation.
        topic_id: The chosen topic ID, or "NEW" to create a new topic.

    Returns:
        Success with topic count, or another arbitration request.
    """
    state = get_conversation(conversation_id)

    if state.assignment_state is None:
        raise ValueError(f"No assignment state found for conversation {conversation_id}")
    if state.turns is None or not all(t.idea_units is not None for t in state.turns):
        raise ValueError(f"No idea units found for conversation {conversation_id}")

    progress = state.assignment_state
    pending = progress.pending_arbitration

    flat_units = _flatten_idea_units(state.turns)
    idea_unit = flat_units[pending.position].idea_unit
    embedding = idea_unit.embedding

    if topic_id == "NEW":
        new_tid = f"topic_{progress.next_id:03d}"
        progress.next_id += 1
        progress.topics[new_tid] = TopicCluster(centroid=embedding, idea_unit_count=1)
        _record_assignment(progress.assignments, new_tid, pending.speaker, pending.time, idea_unit)
    elif topic_id in progress.topics:
        _assign_to_existing(progress.topics, topic_id, embedding)
        _record_assignment(progress.assignments, topic_id, pending.speaker, pending.time, idea_unit)
    else:
        best_candidate = pending.candidates[0][0]
        logger.warning("Unknown topic_id '%s', falling back to best match '%s'", topic_id, best_candidate)
        _assign_to_existing(progress.topics, best_candidate, embedding)
        _record_assignment(progress.assignments, best_candidate, pending.speaker, pending.time, idea_unit)

    progress.pending_arbitration = None
    return _run_assignment_loop(state, flat_units, progress, position=pending.resume_position)


# ---------------------------------------------------------------------------
# Private: Assignment loop
# ---------------------------------------------------------------------------


def _run_assignment_loop(
    state: ConversationState,
    flat_units: list[FlatIdeaUnit],
    progress: AssignmentProgress,
    position: int,
) -> AssignResponse:
    while position < len(flat_units):
        speaker, time, idea_unit = flat_units[position]

        if idea_unit.category == IdeaUnitCategory.Irrelevant:
            position += 1
            continue

        embedding = idea_unit.embedding

        if not progress.topics:
            tid = _create_placeholder_topic(progress, embedding)
            _record_assignment(progress.assignments, tid, speaker, time, idea_unit)
            position += 1
            continue

        scores = _compute_similarities(embedding, progress.topics)
        best_topic_id, best_score = scores[0]

        if best_score > _HIGH_CONFIDENCE_THRESHOLD:
            _assign_to_existing(progress.topics, best_topic_id, embedding)
            _record_assignment(progress.assignments, best_topic_id, speaker, time, idea_unit)
            position += 1

        elif best_score < _LOW_CONFIDENCE_THRESHOLD:
            tid = _create_placeholder_topic(progress, embedding)
            _record_assignment(progress.assignments, tid, speaker, time, idea_unit)
            position += 1

        else:
            progress.pending_arbitration = PendingArbitration(
                speaker=speaker,
                time=time,
                idea_unit=idea_unit,
                candidates=scores[:3],
                resume_position=position + 1,
                position=position,
            )
            state.assignment_state = progress
            arbitration = _build_arbitration_request(idea_unit, progress.assignments, scores[:3])
            return AssignResponse(status="arbitration_needed", arbitration_request=arbitration)

    topics_draft = _build_topics_draft(progress.topics, progress.assignments)
    state.topics_draft = topics_draft
    state.assignment_state = None
    return AssignResponse(
        status="success",
        topic_count=len(progress.topics),
        topics_for_labeling=_build_topics_for_labeling(topics_draft),
    )


def _collect_embeddable_texts(turns: list[SpeakerTurn]) -> tuple[list[str], list[IdeaUnit]]:
    texts: list[str] = []
    idea_unit_refs: list[IdeaUnit] = []
    for turn in turns:
        for idea_unit in turn.idea_units:
            if idea_unit.category != IdeaUnitCategory.Irrelevant:
                texts.append(" ".join(idea_unit.sentences))
                idea_unit_refs.append(idea_unit)
    return texts, idea_unit_refs


def _flatten_idea_units(turns: list[SpeakerTurn]) -> list[FlatIdeaUnit]:
    flat: list[FlatIdeaUnit] = []
    for turn in turns:
        for idea_unit in turn.idea_units:
            flat.append(FlatIdeaUnit(turn.speaker, turn.time, idea_unit))
    return flat


def _compute_similarities(
    embedding: np.ndarray, topics: dict[str, TopicCluster]
) -> list[tuple[str, float]]:
    embedding_norm = np.linalg.norm(embedding)
    scores: list[tuple[str, float]] = []
    for topic_id, topic in topics.items():
        similarity = float(
            np.dot(embedding, topic.centroid) / (embedding_norm * np.linalg.norm(topic.centroid))
        )
        scores.append((topic_id, similarity))
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


def _create_placeholder_topic(progress: AssignmentProgress, embedding: np.ndarray) -> str:
    topic_id = f"topic_{progress.next_id:03d}"
    progress.topics[topic_id] = TopicCluster(centroid=embedding, idea_unit_count=1)
    progress.next_id += 1
    return topic_id


def _assign_to_existing(topics: dict[str, TopicCluster], topic_id: str, embedding: np.ndarray) -> None:
    topic = topics[topic_id]
    new_centroid = (topic.centroid * topic.idea_unit_count + embedding) / (topic.idea_unit_count + 1)
    topic.centroid = new_centroid
    topic.idea_unit_count += 1


def _record_assignment(
    assignments: dict[str, list[AssignmentEntry]], topic_id: str, speaker: str, time: str, idea_unit: IdeaUnit
) -> None:
    if topic_id not in assignments:
        assignments[topic_id] = []
    assignments[topic_id].append(AssignmentEntry(speaker=speaker, time=time, idea_unit=idea_unit))


def _get_representative_texts(assignments: dict[str, list[AssignmentEntry]], topic_id: str) -> list[str]:
    if topic_id not in assignments:
        return []
    return [" ".join(entry.idea_unit.sentences) for entry in assignments[topic_id][:5]]


def _build_arbitration_request(
    idea_unit: IdeaUnit,
    assignments: dict[str, list[AssignmentEntry]],
    candidates: list[tuple[str, float]],
) -> ArbitrationRequest:
    candidate_models = [
        ArbitrationCandidate(
            topic_id=tid,
            score=round(score, 4),
            representative_texts=_get_representative_texts(assignments, tid),
        )
        for tid, score in candidates
    ]
    return ArbitrationRequest(
        fragment=" ".join(idea_unit.sentences),
        category=idea_unit.category.value,
        candidates=candidate_models,
    )


def _build_topics_draft(
    topics: dict[str, TopicCluster], assignments: dict[str, list[AssignmentEntry]]
) -> TopicsDraft:
    topics_output: list[TopicDraftEntry] = []
    for topic_id in sorted(topics.keys()):
        topic_assignments = assignments.get(topic_id, [])

        statements_by_key: dict[tuple[str, str], list[IdeaUnit]] = defaultdict(list)
        for entry in topic_assignments:
            statements_by_key[(entry.speaker, entry.time)].append(entry.idea_unit)

        statements = [
            TopicStatement(speaker=speaker, time=time, idea_units=idea_units)
            for (speaker, time), idea_units in statements_by_key.items()
        ]

        all_texts = [" ".join(entry.idea_unit.sentences) for entry in topic_assignments]

        topics_output.append(TopicDraftEntry(
            topic_id=topic_id,
            label=f"Topic {topic_id}",
            summary="",
            representative_texts=all_texts[:10],
            categories=list({entry.idea_unit.category.value for entry in topic_assignments}),
            statements=statements,
        ))

    return TopicsDraft(topics=topics_output)


def _build_topics_for_labeling(topics_draft: TopicsDraft) -> list[TopicForLabeling]:
    return [
        TopicForLabeling(
            topic_id=entry.topic_id,
            representative_texts=entry.representative_texts,
            categories=entry.categories,
        )
        for entry in topics_draft.topics
    ]
