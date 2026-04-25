export interface DecisionListItem {
  id: string;
  date: string;
  title: string;
  status: string;
}

export interface DecisionsPageData {
  decisions: DecisionListItem[];
}

export interface DecisionAlternativeData {
  option_index: number;
  text: string;
  rationale: string;
}

export interface DecisionDetailData {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  date: string;
  context_text: string;
  decision_text: string;
  decision_rationale: string;
  alternatives: DecisionAlternativeData[];
}
