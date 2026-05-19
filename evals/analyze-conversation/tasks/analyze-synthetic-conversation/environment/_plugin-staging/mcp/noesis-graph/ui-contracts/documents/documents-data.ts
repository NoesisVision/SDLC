export interface DocumentListItem {
  id: string;
  title: string;
  date: string;
}

export interface DocumentsPageData {
  documents: DocumentListItem[];
}

export interface DocumentTopicRef {
  topic_id: string;
  title: string;
}

export interface DocumentDecisionRef {
  decision_id: string;
  title: string;
  status: string;
}

export interface DocumentDetailData {
  id: string;
  title: string;
  date: string;
  topics: DocumentTopicRef[];
  decisions: DocumentDecisionRef[];
}
