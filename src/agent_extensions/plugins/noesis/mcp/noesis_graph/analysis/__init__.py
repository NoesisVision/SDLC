"""Analysis layer for conversation knowledge graph.

Provides tools for building and querying a knowledge graph from conversation
transcripts: batching, idea unit storage, topic management, decisions,
cross-references, restructuring, and retrieval.
"""

import logging

from redislite.falkordb_client import Graph

logger = logging.getLogger(__name__)

_INDEX_DEFINITIONS = [
    "CREATE INDEX FOR (iu:IdeaUnit) ON (iu.idea_unit_id)",
    "CREATE INDEX FOR (t:Topic) ON (t.topic_id)",
    "CREATE INDEX FOR (d:Decision) ON (d.decision_id)",
]


def init_graph(graph: Graph) -> None:
    """Create indexes and bind graph to all analysis submodules."""
    _create_indexes(graph)

    from .batching import init_graph as init_batching
    from .context import init_graph as init_context
    from .finalization import init_graph as init_finalization
    from .restructuring import init_graph as init_restructuring
    from .retrieval import init_graph as init_retrieval
    from .storage import init_graph as init_storage

    init_batching(graph)
    init_context(graph)
    init_finalization(graph)
    init_restructuring(graph)
    init_retrieval(graph)
    init_storage(graph)


def _create_indexes(graph: Graph) -> None:
    for index_query in _INDEX_DEFINITIONS:
        try:
            graph.query(index_query)
        except Exception:
            logger.debug("Index already exists: %s", index_query)
