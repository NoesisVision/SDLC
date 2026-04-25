"""Smoke test — simulates the full analyze-conversation workflow.

Chains all scripts in the order defined by SKILL.md to verify that the complete
pipeline produces valid output files. Content quality is not tested here — only
structural correctness and file presence.
"""

import uuid
from pathlib import Path

from check_conversation_id import (
    extract_conversation_id,
    prepend_conversation_id,
)
from init_conversation import init_conversation
from load_transcript_chunk import load_transcript_chunk
from models_core import (
    Conversation,
    IdeaUnit,
    IdeaUnitCategory,
    PotentialTopic,
    PotentialTopics,
    Turn,
)
from models_extraction import ChunkResult, IdeaUnitTopicAssignment
from models_transcript import RawTranscript
from sample_data import SAMPLE_TRANSCRIPT
from save_chunk_result import save_chunk_result
from save_potential_topics import save_potential_topics
from structure_transcript import structure_transcript
from working_dir import get_working_dir


class TestFullPipeline:
    """Simulates what the agent does when running /noesis:analyze-conversation."""

    def test_complete_workflow_produces_valid_output(self, tmp_path: Path) -> None:
        # -- Arrange: create a transcript file (no conversation_id yet) --
        transcript_path = tmp_path / "design_review.md"
        transcript_path.write_text(SAMPLE_TRANSCRIPT, encoding="utf-8")

        # -- Step 1.1: Create working directory --
        working_dir = get_working_dir(transcript_path)
        working_dir.mkdir(exist_ok=True)
        assert working_dir.is_dir()
        assert working_dir.name == "design_review_work"

        # -- Step 1.2: Check/generate conversation ID --
        conversation_id = extract_conversation_id(transcript_path)
        assert conversation_id is None  # no ID in file yet

        conversation_id = str(uuid.uuid4())
        prepend_conversation_id(conversation_id, transcript_path)

        extracted = extract_conversation_id(transcript_path)
        assert extracted == conversation_id

        # -- Step 1.3: Structure transcript --
        result = structure_transcript(transcript_path, conversation_id)
        assert result["status"] == "Ok"

        structured_path = Path(result["output_path"])
        assert structured_path.exists()
        assert structured_path.parent == working_dir

        transcript_data = RawTranscript.model_validate_json(structured_path.read_bytes())
        assert transcript_data.conversation_id == conversation_id
        assert len(transcript_data.turns) > 0

        # -- Step 1.4: Initialize conversation.json --
        init_conversation(working_dir, conversation_id, "2026-04-10 14:00:00", "Auth module redesign")

        conv_path = working_dir / "conversation.json"
        assert conv_path.exists()
        conv = Conversation.model_validate_json(conv_path.read_bytes())
        assert conv.conversation_id == conversation_id
        assert conv.turns == []

        # -- Step 2.1: Save potential topics (simulates find-topics subagent result) --
        save_potential_topics(working_dir, [
            PotentialTopic(id="topic-auth", title="Authentication", summary="Auth module", path=["Authentication"]),
        ])

        pt_path = working_dir / "possible_topics.json"
        assert pt_path.exists()

        # -- Step 2.2: Load first chunk (simulates extract-topics subagent) --
        chunk_data = load_transcript_chunk(working_dir, structured_path, token_limit=10000)
        assert chunk_data["status"] == "Ok"
        assert len(chunk_data["turns"]) > 0

        # -- Step 2.3: Save chunk result (simulates extract-topics subagent saving) --
        turns = [
            Turn(
                index=raw_turn["index"],
                speaker=raw_turn["speaker"],
                time=raw_turn["time"],
                idea_units=[
                    IdeaUnit(index=0, sentences=raw_turn["sentences"], categories=[IdeaUnitCategory.Information]),
                ],
            )
            for raw_turn in chunk_data["turns"]
        ]
        assignments = [
            IdeaUnitTopicAssignment(turn_index=t.index, idea_unit_index=0, topic_id="topic-auth")
            for t in turns
        ]
        chunk_result = ChunkResult(turns=turns, assignments=assignments, new_topics=[])
        save_chunk_result(working_dir, chunk_result)

        # -- Verify final state --
        final_conv = Conversation.model_validate_json(conv_path.read_bytes())
        assert len(final_conv.turns) == len(transcript_data.turns)
        assert len(final_conv.topics) == 1
        assert final_conv.topics[0].id == "topic-auth"
        assert len(final_conv.topics[0].idea_units) == len(transcript_data.turns)

        final_pt = PotentialTopics.model_validate_json(pt_path.read_bytes())
        assert len(final_pt.topics) >= 1

        # -- Verify all expected files present --
        expected_files = {"conversation.json", "possible_topics.json", "design_review.json"}
        actual_files = {f.name for f in working_dir.iterdir() if f.is_file()}
        assert expected_files.issubset(actual_files)
