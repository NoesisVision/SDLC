#!/usr/bin/env python3
"""
Noesis Local MCP Server

A Model Context Protocol server for local Noesis operations.
This server provides tools for interacting with the local Noesis environment.
"""

import json
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional

from mcp.server.fastmcp import Context, FastMCP
from mcp.types import SamplingMessage, TextContent
from pydantic import BaseModel, Field
from redislite.falkordb_client import FalkorDB


@dataclass
class GraphContext:
    """Type-safe context for shared graph database resources."""

    db: FalkorDB
    graph: Any  # FalkorDB graph object
    db_path: Path
    graph_name: str = "noesis"


class DomainTerm(BaseModel):
    """Domain term with its definition."""

    term: str = Field(description="Domain-specific term found in the conversation")
    definition: str = Field(description="Definition or explanation of the term")


class Topic(BaseModel):
    """Conversation topic with summary."""

    title: str = Field(description="Title or name of the topic")
    summary: str = Field(description="Short summary of what was discussed about this topic")


class AnalyzeConversationFileResponse(BaseModel):
    """Response from conversation file analysis."""

    summary: str = Field(description="Short summary of the overall conversation")
    domain_terms: Optional[List[DomainTerm]] = Field(
        default=None,
        description="List of domain-specific terms with their definitions (if any identified)",
    )
    topics: List[Topic] = Field(description="List of topics discussed in the conversation")


CONVERSATION_ANALYSIS_PROMPT = """You are an expert conversation analyst. Your task is to perform an in-depth analysis of the provided conversation transcript.

Analyze the conversation and provide a structured response with the following components:

1. **Summary**: A concise summary (2-4 sentences) of the overall conversation, capturing the main purpose and outcome.

2. **Domain Terms**: Identify domain-specific terminology used in the conversation. Only include terms that:
   - Are specific to a particular field, technology, or domain
   - Have enough context in the conversation to provide a meaningful definition
   - Would benefit from explanation
   If no clear domain terms are identified, you may omit this section.

3. **Topics**: Break down the conversation into distinct topics that were discussed. For each topic:
   - Provide a clear, descriptive title
   - Write a brief summary (1-3 sentences) of what was discussed

Return your analysis in the following JSON format:

```json
{
  "summary": "Your overall conversation summary here",
  "domain_terms": [
    {
      "term": "term name",
      "definition": "definition based on conversation context"
    }
  ],
  "topics": [
    {
      "title": "Topic title",
      "summary": "Brief summary of this topic"
    }
  ]
}
```

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks, no additional explanations
- The "domain_terms" field can be null or an empty array if no domain terms are identified
- The "topics" array must contain at least one topic
- Be concise but informative

Here is the conversation to analyze:

{conversation}"""


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[GraphContext]:
    """
    Manage FalkorDB lifecycle for the MCP server.

    Initializes the database on startup and ensures proper cleanup on shutdown.
    The database file is created in the working directory inherited from the
    parent process (Claude/Gemini CLI).
    """
    # Determine database location
    cwd = Path(os.getcwd())
    noesis_dir = cwd / ".noesis"
    db_file = noesis_dir / "graph.db"

    # Ensure .noesis directory exists
    try:
        noesis_dir.mkdir(exist_ok=True)
    except PermissionError as e:
        print(f"Error: Cannot create .noesis directory: {e}", file=sys.stderr)
        raise RuntimeError(f"Permission denied for creating .noesis directory: {e}")
    except Exception as e:
        print(f"Error: Failed to create .noesis directory: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to create .noesis directory: {e}")

    # Initialize FalkorDB
    db = None
    graph = None

    try:
        # Create database connection with persistence
        db = FalkorDB(str(db_file))

        # Select/create the "noesis" graph
        graph = db.select_graph("noesis")

        print(f"FalkorDB initialized at {db_file}", file=sys.stderr)

        # Yield the context to make it available to tools
        yield GraphContext(db=db, graph=graph, db_path=db_file, graph_name="noesis")

    except FileNotFoundError as e:
        print(f"Error: Cannot access database path: {e}", file=sys.stderr)
        raise RuntimeError(f"Cannot access database path: {db_file}")
    except PermissionError as e:
        print(f"Error: Permission denied for database: {e}", file=sys.stderr)
        raise RuntimeError(f"Permission denied for database: {db_file}")
    except Exception as e:
        print(f"Error: Failed to initialize FalkorDB: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to initialize FalkorDB: {e}")
    finally:
        # Cleanup: FalkorDB connections are managed by redislite
        # The connection will close automatically when db goes out of scope
        # Database file persists on disk
        if db is not None:
            print("FalkorDB shutting down", file=sys.stderr)


# Initialize FastMCP server with lifespan
mcp = FastMCP("noesis-local", lifespan=app_lifespan)


@mcp.tool()
def ping() -> str:
    """
    A simple ping-pong tool to test the MCP server connectivity.

    Returns:
        str: Returns "pong" to confirm the server is responding.
    """
    return "pong"


@mcp.tool()
async def analyze_conversation_file(
    file_path: str,
    ctx: Context,
) -> AnalyzeConversationFileResponse:
    """
    Analyze a conversation transcript from a file using LLM.

    Performs in-depth conversation analysis including:
    - Overall summary of the conversation
    - Domain-specific terms with definitions (if identifiable)
    - Topics discussed with summaries

    Args:
        file_path: Absolute or relative path to the conversation file
        ctx: MCP context for LLM access

    Returns:
        Structured analysis with summary, domain terms, and topics

    Raises:
        FileNotFoundError: If the file doesn't exist
        PermissionError: If the file cannot be read
        ValueError: If the LLM response is invalid
        RuntimeError: If analysis fails
    """
    file_path = Path(file_path)

    # Read the file with error handling
    try:
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        if not file_path.is_file():
            raise ValueError(f"Path is not a file: {file_path}")

        conversation_text = file_path.read_text(encoding="utf-8")

        if not conversation_text.strip():
            raise ValueError(f"File is empty: {file_path}")

    except PermissionError as e:
        raise PermissionError(f"Permission denied reading file {file_path}: {e}")
    except UnicodeDecodeError as e:
        raise ValueError(f"File encoding error (expected UTF-8): {e}")
    except Exception as e:
        raise RuntimeError(f"Failed to read file {file_path}: {e}")

    # Create the analysis prompt
    prompt = CONVERSATION_ANALYSIS_PROMPT.replace("{conversation}", conversation_text)

    # Call LLM via MCP Sampling (using high reasoning model)
    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = await ctx.session.create_message(
                messages=[
                    SamplingMessage(
                        role="user",
                        content=TextContent(type="text", text=prompt),
                    )
                ],
                max_tokens=8000,
                temperature=0.1,
            )

            # Extract text from response
            response_text = result.content.text.strip()

            # Remove markdown code blocks if present
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            elif response_text.startswith("```"):
                response_text = response_text[3:]

            if response_text.endswith("```"):
                response_text = response_text[:-3]

            response_text = response_text.strip()

            # Parse JSON response
            try:
                parsed_data = json.loads(response_text)
            except json.JSONDecodeError as e:
                raise ValueError(
                    f"Failed to parse JSON response: {e}\nResponse: {response_text[:200]}"
                )

            # Validate structure
            if not isinstance(parsed_data, dict):
                raise ValueError(f"Expected dict, got {type(parsed_data)}")

            if "summary" not in parsed_data:
                raise ValueError("Response missing required field: summary")

            if "topics" not in parsed_data:
                raise ValueError("Response missing required field: topics")

            if not isinstance(parsed_data["topics"], list) or len(parsed_data["topics"]) == 0:
                raise ValueError("Response must contain at least one topic")

            # Parse into Pydantic model for validation
            response = AnalyzeConversationFileResponse(**parsed_data)

            return response

        except (json.JSONDecodeError, ValueError) as e:
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to analyze conversation after {max_retries} attempts: {e}")

            # Add clearer instructions for next retry
            prompt += "\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no explanations."

    # Should not reach here
    raise RuntimeError("Analysis failed unexpectedly")


if __name__ == "__main__":
    # Run the server using stdio transport
    mcp.run(transport="stdio")
