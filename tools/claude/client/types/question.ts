/**
 * Option for a question
 */
export interface QuestionOption {
  label: string;
  description?: string;
  value?: string;
}

/**
 * Question structure from AskUserQuestion tool
 */
export interface Question {
  questionId: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Answer to a question
 */
export interface QuestionAnswer {
  questionId: string;
  selectedOptions: string[]; // labels or values of selected options
}
