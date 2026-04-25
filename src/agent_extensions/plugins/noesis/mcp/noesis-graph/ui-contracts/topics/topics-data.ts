export interface TopicConversationRef {
  conversation_id: string;
  title: string;
  date: string;
}

export interface TopicDocumentRef {
  document_id: string;
  title: string;
  date: string;
}

export interface TopicNode {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  conversations: TopicConversationRef[];
  documents: TopicDocumentRef[];
  subtopics: TopicNode[];
}

export interface TopicsPageData {
  topics: TopicNode[];
}

export interface TopicConversationIdeaUnit {
  turn_index: number;
  idea_unit_index: number;
  time: string;
  speaker: string;
  sentences: string[];
  categories: string[];
}

export interface TopicConversationDetail {
  topic_id: string;
  topic_title: string;
  conversation_id: string;
  conversation_title: string;
  conversation_date: string;
  idea_units: TopicConversationIdeaUnit[];
}

export interface TopicDocumentFragment {
  start_offset: number;
  end_offset: number;
  text: string;
}

export interface TopicDocumentDetail {
  topic_id: string;
  topic_title: string;
  document_id: string;
  document_title: string;
  document_date: string;
  fragments: TopicDocumentFragment[];
}
