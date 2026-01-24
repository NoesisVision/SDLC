import {
  ClaudeEvent,
  RawLineEvent,
  TextEvent,
  ThinkingEvent,
  ToolUseEvent,
  ResultEvent,
  SystemInitEvent,
  AssistantMessageEvent
} from '../types/events';

/**
 * Parses Claude Code CLI stream-json output into structured events
 */
export class StreamParser {
  private buffer: string = '';

  /**
   * Parse a chunk of output into events
   */
  parse(chunk: string): ClaudeEvent[] {
    const events: ClaudeEvent[] = [];

    // Add to buffer
    this.buffer += chunk;

    // Split by newlines
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    this.buffer = lines.pop() || '';

    // Parse each complete line
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        const parsedEvents = this.parseEvent(parsed);
        if (parsedEvents) {
          if (Array.isArray(parsedEvents)) {
            events.push(...parsedEvents);
          } else {
            events.push(parsedEvents);
          }
        }
      } catch (error) {
        // Not valid JSON, emit as raw
        events.push({
          type: 'raw',
          timestamp: new Date(),
          line
        } as RawLineEvent);
      }
    }

    return events;
  }

  /**
   * Parse a single JSON object into a typed event
   */
  private parseEvent(obj: any): ClaudeEvent | ClaudeEvent[] | null {
    const timestamp = obj.timestamp ? new Date(obj.timestamp) : new Date();

    switch (obj.type) {
      case 'system':
        return {
          type: 'system',
          subtype: obj.subtype,
          timestamp,
          sessionId: obj.session_id,
          cwd: obj.cwd,
          tools: obj.tools || [],
          mcp_servers: obj.mcp_servers || [],
          model: obj.model,
          permissionMode: obj.permissionMode,
          slash_commands: obj.slash_commands || [],
          agents: obj.agents || [],
          skills: obj.skills || [],
          plugins: obj.plugins || []
        } as SystemInitEvent;

      case 'assistant':
        return this.parseAssistantMessage(obj, timestamp);

      case 'result':
        return {
          type: 'result',
          subtype: obj.subtype,
          timestamp,
          isError: obj.is_error,
          result: obj.result,
          error: obj.error,
          durationMs: obj.duration_ms,
          durationApiMs: obj.duration_api_ms,
          numTurns: obj.num_turns,
          totalCostUsd: obj.total_cost_usd,
          usage: obj.usage
        } as ResultEvent;

      default:
        return {
          type: 'raw',
          timestamp,
          line: JSON.stringify(obj)
        } as RawLineEvent;
    }
  }

  private parseAssistantMessage(obj: any, timestamp: Date): ClaudeEvent[] {
    const events: ClaudeEvent[] = [];
    const message = obj.message;

    // Parse content blocks
    for (const block of message.content || []) {
      if (block.type === 'text') {
        events.push({
          type: 'text',
          timestamp,
          content: block.text
        } as TextEvent);
      } else if (block.type === 'thinking') {
        events.push({
          type: 'thinking',
          timestamp,
          content: block.thinking
        } as ThinkingEvent);
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool_use',
          timestamp,
          toolName: block.name,
          toolUseId: block.id,
          input: block.input
        } as ToolUseEvent);
      }
    }

    // Also emit full assistant message
    events.push({
      type: 'assistant',
      timestamp,
      messageId: message.id,
      model: message.model,
      content: message.content,
      stopReason: message.stop_reason,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens
      }
    } as AssistantMessageEvent);

    return events;
  }
}
