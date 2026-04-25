import type {
  TopicConversationIdeaUnit,
  TopicDocumentFragment,
} from "../topics/topics-data.js";

export interface DecisionListItem {
  id: string;
  date: string;
  title: string;
  status: string;
}

export interface DecisionsPageData {
  decisions: DecisionListItem[];
}

export interface DecisionConversationRef {
  conversation_id: string;
  title: string;
  date: string;
}

export interface DecisionDocumentRef {
  document_id: string;
  title: string;
  date: string;
}

export interface DecisionAlternativeData {
  option_index: number;
  text: string;
  rationale: string;
  conversations: DecisionConversationRef[];
  documents: DecisionDocumentRef[];
}

export interface DecisionDetailData {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  date: string;
  context_text: string;
  context_conversations: DecisionConversationRef[];
  context_documents: DecisionDocumentRef[];
  decision_text: string;
  decision_rationale: string;
  decision_conversations: DecisionConversationRef[];
  decision_documents: DecisionDocumentRef[];
  alternatives: DecisionAlternativeData[];
}

export type DecisionSlotPath =
  | "context"
  | "decision"
  | `alternative-${number}`;

export interface DecisionConversationDetailData {
  decision_id: string;
  decision_title: string;
  slot_label: string;
  conversation_id: string;
  conversation_title: string;
  conversation_date: string;
  idea_units: TopicConversationIdeaUnit[];
}

export interface DecisionDocumentDetailData {
  decision_id: string;
  decision_title: string;
  slot_label: string;
  document_id: string;
  document_title: string;
  document_date: string;
  fragments: TopicDocumentFragment[];
}
