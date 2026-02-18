/**
 * Parse a JSONL (JSON Lines) file content into an array of objects
 *
 * @param content - The JSONL content as a string
 * @returns Array of parsed JSON objects
 */
export function parseJsonl<T = any>(content: string): T[] {
  const lines = content.split('\n').filter(line => line.trim());
  const results: T[] = [];

  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch (error) {
      // Skip malformed lines
      console.warn('Failed to parse JSONL line:', line, error);
    }
  }

  return results;
}

/**
 * Convert an array of objects to JSONL format
 *
 * @param objects - Array of objects to convert
 * @returns JSONL formatted string
 */
export function toJsonl(objects: any[]): string {
  return objects.map(obj => JSON.stringify(obj)).join('\n') + '\n';
}

/**
 * Parse a streaming JSONL buffer incrementally
 */
export class JsonlStreamParser<T = any> {
  private buffer: string = '';

  /**
   * Add a chunk of data and extract complete JSON objects
   */
  parse(chunk: string): T[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    const results: T[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        results.push(JSON.parse(line));
      } catch (error) {
        console.warn('Failed to parse JSONL line:', line, error);
      }
    }

    return results;
  }

  /**
   * Get any remaining buffered content
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
  }
}
