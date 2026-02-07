"""
FalkorDB graph schema definitions using Cypher queries.

This module contains Cypher query templates for creating nodes and relationships
in the conversation analysis knowledge graph. All queries use MERGE for idempotency.
"""

# Node Creation Queries

CREATE_CONVERSATION_NODE = """
MERGE (c:Conversation {id: $conversation_id})
SET c.created_at = $created_at
RETURN c
"""

CREATE_PERSON_NODE = """
MERGE (p:Person {name: $name})
RETURN p
"""

CREATE_SENTENCE_NODE = """
MERGE (s:Sentence {id: $sentence_id})
SET s.text = $text,
    s.timestamp = $timestamp,
    s.sequence_index = $sequence_index
RETURN s
"""

CREATE_TOPIC_NODE = """
MERGE (t:Topic {id: $topic_id})
SET t.name = $name
RETURN t
"""

CREATE_ISSUE_NODE = """
MERGE (i:Issue {id: $issue_id})
SET i.sentence_id = $sentence_id
RETURN i
"""

CREATE_POSITION_NODE = """
MERGE (p:Position {id: $position_id})
SET p.sentence_id = $sentence_id
RETURN p
"""

CREATE_ARGUMENT_NODE = """
MERGE (a:Argument {id: $argument_id})
SET a.sentence_id = $sentence_id
RETURN a
"""

CREATE_DOMAIN_TERM_NODE = """
MERGE (d:DomainTerm {term: $term})
SET d.standardized_term = $standardized_term
RETURN d
"""

# Relationship Creation Queries

CREATE_CONVERSATION_CONTAINS_SENTENCE = """
MATCH (c:Conversation {id: $conversation_id})
MATCH (s:Sentence {id: $sentence_id})
MERGE (c)-[:CONTAINS]->(s)
"""

CREATE_CONVERSATION_ATTENDED_BY_PERSON = """
MATCH (c:Conversation {id: $conversation_id})
MATCH (p:Person {name: $person_name})
MERGE (c)-[:ATTENDED_BY]->(p)
"""

CREATE_PERSON_SPOKE_SENTENCE = """
MATCH (p:Person {name: $person_name})
MATCH (s:Sentence {id: $sentence_id})
MERGE (p)-[:SPOKE]->(s)
"""

CREATE_TOPIC_HAS_ISSUE = """
MATCH (t:Topic {id: $topic_id})
MATCH (i:Issue {id: $issue_id})
MERGE (t)-[:HAS_ISSUE]->(i)
"""

CREATE_TOPIC_HAS_POSITION = """
MATCH (t:Topic {id: $topic_id})
MATCH (p:Position {id: $position_id})
MERGE (t)-[:HAS_POSITION]->(p)
"""

CREATE_TOPIC_HAS_ARGUMENT = """
MATCH (t:Topic {id: $topic_id})
MATCH (a:Argument {id: $argument_id})
MERGE (t)-[:HAS_ARGUMENT]->(a)
"""

CREATE_TOPIC_RELATES_TO_DOMAIN_TERM = """
MATCH (t:Topic {id: $topic_id})
MATCH (d:DomainTerm {term: $term})
MERGE (t)-[:RELATES_TO]->(d)
"""

CREATE_ISSUE_DEFINED_IN_SENTENCE = """
MATCH (i:Issue {id: $issue_id})
MATCH (s:Sentence {id: $sentence_id})
MERGE (i)-[:DEFINED_IN]->(s)
"""

CREATE_POSITION_STATED_IN_SENTENCE = """
MATCH (p:Position {id: $position_id})
MATCH (s:Sentence {id: $sentence_id})
MERGE (p)-[:STATED_IN]->(s)
"""

CREATE_ARGUMENT_EVIDENCED_BY_SENTENCE = """
MATCH (a:Argument {id: $argument_id})
MATCH (s:Sentence {id: $sentence_id})
MERGE (a)-[:EVIDENCED_BY]->(s)
"""

CREATE_TOPIC_PARENT_OF_TOPIC = """
MATCH (parent:Topic {id: $parent_id})
MATCH (child:Topic {id: $child_id})
MERGE (parent)-[:PARENT_OF]->(child)
"""

# Query Templates for Analysis

QUERY_CONVERSATION_SUMMARY = """
MATCH (c:Conversation {id: $conversation_id})
OPTIONAL MATCH (c)-[:CONTAINS]->(s:Sentence)
OPTIONAL MATCH (c)-[:ATTENDED_BY]->(p:Person)
OPTIONAL MATCH (t:Topic)-[:RELATES_TO]->(d:DomainTerm)
RETURN c.id AS conversation_id,
       count(DISTINCT s) AS total_sentences,
       count(DISTINCT p) AS total_participants,
       count(DISTINCT t) AS total_topics,
       count(DISTINCT d) AS total_domain_terms
"""

QUERY_TOPICS_FOR_CONVERSATION = """
MATCH (c:Conversation {id: $conversation_id})-[:CONTAINS]->(s:Sentence)
MATCH (t:Topic)
WHERE t.id IN $topic_ids
OPTIONAL MATCH (t)-[:RELATES_TO]->(d:DomainTerm)
RETURN t.id AS topic_id,
       t.name AS topic_name,
       collect(DISTINCT d.term) AS domain_terms
ORDER BY t.name
"""

QUERY_SENTENCES_BY_SPEAKER = """
MATCH (c:Conversation {id: $conversation_id})-[:CONTAINS]->(s:Sentence)
MATCH (p:Person)-[:SPOKE]->(s)
WHERE p.name = $speaker_name
RETURN s.id AS sentence_id,
       s.text AS text,
       s.timestamp AS timestamp,
       s.sequence_index AS sequence_index
ORDER BY s.sequence_index
"""

QUERY_IBIS_CATEGORIES_BY_TOPIC = """
MATCH (t:Topic {id: $topic_id})
OPTIONAL MATCH (t)-[:HAS_ISSUE]->(i:Issue)-[:DEFINED_IN]->(si:Sentence)
OPTIONAL MATCH (t)-[:HAS_POSITION]->(p:Position)-[:STATED_IN]->(sp:Sentence)
OPTIONAL MATCH (t)-[:HAS_ARGUMENT]->(a:Argument)-[:EVIDENCED_BY]->(sa:Sentence)
RETURN collect(DISTINCT {type: 'Issue', sentence: si.text}) AS issues,
       collect(DISTINCT {type: 'Position', sentence: sp.text}) AS positions,
       collect(DISTINCT {type: 'Argument', sentence: sa.text}) AS arguments
"""
