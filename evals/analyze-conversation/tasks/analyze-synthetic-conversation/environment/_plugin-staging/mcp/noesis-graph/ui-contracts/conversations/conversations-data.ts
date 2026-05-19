export interface ConversationListItem {
  id: string;
  title: string;
  date: string;
}

export interface ConversationsPageData {
  conversations: ConversationListItem[];
}

export interface ConversationTopicRef {
  topic_id: string;
  title: string;
}

export interface ConversationDecisionRef {
  decision_id: string;
  title: string;
  status: string;
}

export interface ConversationDetailData {
  id: string;
  title: string;
  date: string;
  topics: ConversationTopicRef[];
  decisions: ConversationDecisionRef[];
}
