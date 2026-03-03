"""Tools for topic embedding and assignment."""

import logging
from collections import defaultdict

import numpy as np
from sentence_transformers import SentenceTransformer

from .models import (
    ArbitrationCandidate,
    ArbitrationRequest,
    AssignResponse,
    ConversationState,
    EmbedResponse,
    IdeaUnit,
    IdeaUnitCategory,
    SpeakerTurn,
    TopicForLabeling,
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
    return _run_assignment_loop(state, flat_units, topics={}, next_id=1, position=0, assignments={})


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

    astate = state.assignment_state
    topics = _restore_topics(astate)
    next_id = astate["next_id"]
    assignments = astate["assignments"]
    pending = astate["pending_arbitration"]

    flat_units = _flatten_idea_units(state.turns)
    pending_position = pending["position"]
    idea_unit = flat_units[pending_position][2]
    embedding = idea_unit.embedding
    speaker = pending["speaker"]
    time = pending["time"]

    if topic_id == "NEW":
        new_tid = f"topic_{next_id:03d}"
        next_id += 1
        topics[new_tid] = {"centroid": embedding.tolist(), "idea_unit_count": 1}
        _record_assignment(assignments, new_tid, speaker, time, idea_unit)
    elif topic_id in topics:
        _assign_to_existing(topics, topic_id, embedding)
        _record_assignment(assignments, topic_id, speaker, time, idea_unit)
    else:
        best_candidate = pending["candidates"][0]["topic_id"]
        logger.warning("Unknown topic_id '%s', falling back to best match '%s'", topic_id, best_candidate)
        _assign_to_existing(topics, best_candidate, embedding)
        _record_assignment(assignments, best_candidate, speaker, time, idea_unit)

    position = pending["resume_position"]
    return _run_assignment_loop(state, flat_units, topics, next_id, position, assignments)


# ---------------------------------------------------------------------------
# Private: Assignment loop
# ---------------------------------------------------------------------------


def _run_assignment_loop(
    state: ConversationState,
    flat_units: list[tuple[str, str, IdeaUnit]],
    topics: dict,
    next_id: int,
    position: int,
    assignments: dict,
) -> AssignResponse:
    while position < len(flat_units):
        speaker, time, idea_unit = flat_units[position]

        if idea_unit.category == IdeaUnitCategory.Irrelevant:
            position += 1
            continue

        embedding = idea_unit.embedding

        if not topics:
            tid, next_id = _create_placeholder_topic(topics, next_id, idea_unit, embedding)
            _record_assignment(assignments, tid, speaker, time, idea_unit)
            position += 1
            continue

        centroids = {tid: np.array(t["centroid"]) for tid, t in topics.items()}
        scores = _compute_similarities(embedding, centroids)
        best_topic_id, best_score = scores[0]

        if best_score > _HIGH_CONFIDENCE_THRESHOLD:
            _assign_to_existing(topics, best_topic_id, embedding)
            _record_assignment(assignments, best_topic_id, speaker, time, idea_unit)
            position += 1

        elif best_score < _LOW_CONFIDENCE_THRESHOLD:
            tid, next_id = _create_placeholder_topic(topics, next_id, idea_unit, embedding)
            _record_assignment(assignments, tid, speaker, time, idea_unit)
            position += 1

        else:
            _save_assignment_state(state, topics, next_id, position, assignments, speaker, time, idea_unit, scores[:3])
            arbitration = _build_arbitration_request(idea_unit, assignments, scores[:3])
            return AssignResponse(status="arbitration_needed", arbitration_request=arbitration)

    topics_draft = _build_topics_draft(topics, assignments)
    state.topics_draft = topics_draft
    state.assignment_state = None
    return AssignResponse(
        status="success",
        topic_count=len(topics),
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


def _flatten_idea_units(turns: list[SpeakerTurn]) -> list[tuple[str, str, IdeaUnit]]:
    flat: list[tuple[str, str, IdeaUnit]] = []
    for turn in turns:
        for idea_unit in turn.idea_units:
            flat.append((turn.speaker, turn.time, idea_unit))
    return flat


def _compute_similarities(embedding: np.ndarray, centroids: dict[str, np.ndarray]) -> list[tuple[str, float]]:
    scores: list[tuple[str, float]] = []
    for topic_id, centroid in centroids.items():
        similarity = float(np.dot(embedding, centroid) / (np.linalg.norm(embedding) * np.linalg.norm(centroid)))
        scores.append((topic_id, similarity))
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


def _create_placeholder_topic(
    topics: dict, next_id: int, idea_unit: IdeaUnit, embedding: np.ndarray
) -> tuple[str, int]:
    topic_id = f"topic_{next_id:03d}"
    topics[topic_id] = {"centroid": embedding.tolist(), "idea_unit_count": 1}
    return topic_id, next_id + 1


def _assign_to_existing(topics: dict, topic_id: str, embedding: np.ndarray) -> None:
    topic = topics[topic_id]
    centroid = np.array(topic["centroid"])
    count = topic["idea_unit_count"]
    new_centroid = (centroid * count + embedding) / (count + 1)
    topic["centroid"] = new_centroid.tolist()
    topic["idea_unit_count"] = count + 1


def _record_assignment(assignments: dict, topic_id: str, speaker: str, time: str, idea_unit: IdeaUnit) -> None:
    if topic_id not in assignments:
        assignments[topic_id] = []
    assignments[topic_id].append({"speaker": speaker, "time": time, "idea_unit": idea_unit.model_dump()})


def _get_representative_texts(assignments: dict, topic_id: str) -> list[str]:
    if topic_id not in assignments:
        return []
    return [" ".join(entry["idea_unit"]["sentences"]) for entry in assignments[topic_id][:5]]


def _build_arbitration_request(
    idea_unit: IdeaUnit,
    assignments: dict,
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


def _save_assignment_state(
    state: ConversationState,
    topics: dict,
    next_id: int,
    position: int,
    assignments: dict,
    speaker: str,
    time: str,
    idea_unit: IdeaUnit,
    candidates: list[tuple[str, float]],
) -> None:
    state.assignment_state = {
        "topics": topics,
        "next_id": next_id,
        "assignments": assignments,
        "pending_arbitration": {
            "speaker": speaker,
            "time": time,
            "idea_unit": idea_unit.model_dump(),
            "candidates": [{"topic_id": tid, "score": s} for tid, s in candidates],
            "resume_position": position + 1,
            "position": position,
        },
    }


def _restore_topics(astate: dict) -> dict:
    topics = {}
    for tid, tdata in astate.get("topics", {}).items():
        topics[tid] = {"centroid": tdata["centroid"], "idea_unit_count": tdata["idea_unit_count"]}
    return topics


def _build_topics_draft(topics: dict, assignments: dict) -> dict:
    topics_output = []
    for topic_id in sorted(topics.keys()):
        topic_assignments = assignments.get(topic_id, [])

        statements_by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for entry in topic_assignments:
            key = (entry["speaker"], entry["time"])
            statements_by_key[key].append(entry["idea_unit"])

        statements = [
            {"speaker": speaker, "time": time, "idea_units": idea_units}
            for (speaker, time), idea_units in statements_by_key.items()
        ]

        all_texts = [" ".join(entry["idea_unit"]["sentences"]) for entry in topic_assignments]

        topics_output.append({
            "topic_id": topic_id,
            "label": f"Topic {topic_id}",
            "summary": "",
            "representative_texts": all_texts[:10],
            "categories": list({entry["idea_unit"]["category"] for entry in topic_assignments}),
            "statements": statements,
        })

    return {"topics": topics_output}


def _build_topics_for_labeling(topics_draft: dict) -> list[TopicForLabeling]:
    return [
        TopicForLabeling(
            topic_id=t["topic_id"],
            representative_texts=t["representative_texts"],
            categories=t["categories"],
        )
        for t in topics_draft["topics"]
    ]
