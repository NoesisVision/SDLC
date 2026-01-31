import { Writable } from 'stream';
import { Question, QuestionAnswer } from '../types/question';
import { ToolUseEvent } from '../types/events';

/**
 * Handles question detection and answering
 */
export class QuestionHandler {
  private pendingQuestions = new Map<string, Question>();

  /**
   * Extract a question from AskUserQuestion tool use
   */
  extractQuestion(event: ToolUseEvent): Question | null {
    if (event.toolName !== 'AskUserQuestion') {
      return null;
    }

    const input = event.input;
    const questions = input.questions as any[];

    if (!questions || questions.length === 0) {
      return null;
    }

    // Take first question (they're presented one at a time)
    const q = questions[0];

    const question: Question = {
      questionId: event.toolUseId,
      header: q.header,
      question: q.question,
      options: q.options.map((opt: any) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value || opt.label
      })),
      multiSelect: q.multiSelect || false
    };

    this.pendingQuestions.set(question.questionId, question);
    return question;
  }

  /**
   * Send an answer to a question via stdin
   */
  async sendAnswer(stdin: Writable, answer: QuestionAnswer): Promise<void> {
    const question = this.pendingQuestions.get(answer.questionId);
    if (!question) {
      throw new Error(`Question ${answer.questionId} not found`);
    }

    // Format answer as tool result
    const toolResult = {
      tool_use_id: answer.questionId,
      type: 'tool_result',
      content: answer.selectedOptions.join(', ')
    };

    // Send as JSON line
    return new Promise((resolve, reject) => {
      stdin.write(JSON.stringify(toolResult) + '\n', (error) => {
        if (error) {
          reject(error);
        } else {
          this.pendingQuestions.delete(answer.questionId);
          resolve();
        }
      });
    });
  }
}
