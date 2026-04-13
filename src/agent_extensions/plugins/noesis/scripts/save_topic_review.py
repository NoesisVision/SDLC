# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Save topic review result to conversation.json and possible_topics.json."""

import json
import sys
from pathlib import Path

from models_core import Conversation, IdeaUnitRef, PotentialTopics, Topic
from models_extraction import TopicReviewResult


def save_topic_review(working_dir: Path, review: TopicReviewResult) -> None:
    """Apply topic review changes to conversation.json and possible_topics.json.

    Args:
        working_dir: Path to the working directory.
        review: Review result with reassignments, summaries, and new topics.
    """
    conversation = _load_conversation(working_dir)
    topic = _find_topic(conversation, review.topic_id)

    _update_summaries(topic, review)
    _apply_reassignments(conversation, topic, review)
    _mark_reviewed(topic)

    _write_conversation(working_dir, conversation)

    if review.new_topics:
        _append_new_topics(working_dir, review)


def _load_conversation(working_dir: Path) -> Conversation:
    path = working_dir / "conversation.json"
    return Conversation.model_validate_json(path.read_bytes())


def _find_topic(conversation: Conversation, topic_id: str) -> Topic:
    for topic in conversation.topics:
        if topic.id == topic_id:
            return topic
    raise ValueError(f"Topic not found: {topic_id}")


def _update_summaries(topic: Topic, review: TopicReviewResult) -> None:
    topic.short_summary = review.short_summary
    topic.long_summary = review.long_summary


def _apply_reassignments(
    conversation: Conversation,
    source_topic: Topic,
    review: TopicReviewResult,
) -> None:
    topic_map = _build_topic_map(conversation)
    reassigned_keys = {
        (r.turn_index, r.idea_unit_index) for r in review.reassignments
    }

    source_topic.idea_units = [
        ref for ref in source_topic.idea_units
        if (ref.turn_index, ref.idea_unit_index) not in reassigned_keys
    ]

    for reassignment in review.reassignments:
        target = topic_map.get(reassignment.new_topic_id)
        if target is None:
            target = _create_topic_from_review(reassignment.new_topic_id, review)
            conversation.topics.append(target)
            topic_map[target.id] = target

        target.idea_units.append(IdeaUnitRef(
            conversation_id=conversation.conversation_id,
            turn_index=reassignment.turn_index,
            idea_unit_index=reassignment.idea_unit_index,
        ))


def _build_topic_map(conversation: Conversation) -> dict[str, Topic]:
    return {topic.id: topic for topic in conversation.topics}


def _create_topic_from_review(topic_id: str, review: TopicReviewResult) -> Topic:
    for new_topic in review.new_topics:
        if new_topic.id == topic_id:
            return Topic(
                id=topic_id,
                title=new_topic.title,
                short_summary=new_topic.short_summary,
                long_summary="",
                idea_units=[],
                subtopics=[],
            )
    return Topic(
        id=topic_id,
        title="",
        short_summary="",
        long_summary="",
        idea_units=[],
        subtopics=[],
    )


def _mark_reviewed(topic: Topic) -> None:
    topic.reviewed = True


def _write_conversation(working_dir: Path, conversation: Conversation) -> None:
    path = working_dir / "conversation.json"
    path.write_text(conversation.model_dump_json(indent=2), encoding="utf-8")


def _append_new_topics(working_dir: Path, review: TopicReviewResult) -> None:
    path = working_dir / "possible_topics.json"
    potential_topics = PotentialTopics.model_validate_json(path.read_bytes())

    existing_ids = {t.id for t in potential_topics.topics}
    for new_topic in review.new_topics:
        if new_topic.id not in existing_ids:
            potential_topics.topics.append(new_topic)

    path.write_text(potential_topics.model_dump_json(indent=2), encoding="utf-8")


def _main() -> None:
    if len(sys.argv) != 3:
        print(json.dumps({
            "status": "Error",
            "message": "Usage: save_topic_review.py <working_dir> <input_file>",
        }))
        sys.exit(1)

    working_dir = Path(sys.argv[1])
    if not working_dir.is_dir():
        print(json.dumps({"status": "Error", "message": f"Directory not found: {working_dir}"}))
        sys.exit(1)

    raw_input = Path(sys.argv[2]).read_text(encoding="utf-8")
    review = TopicReviewResult.model_validate_json(raw_input)

    save_topic_review(working_dir, review)

    input_path = Path(sys.argv[2])
    if input_path.exists():
        input_path.unlink()

    print(json.dumps({
        "status": "Ok",
        "topic_id": review.topic_id,
        "reassignments": len(review.reassignments),
        "new_topics": len(review.new_topics),
    }))


if __name__ == "__main__":
    _main()
