import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SerenaConfig, SerenaSymbol, SerenaReference, SerenaOverviewSymbol } from "./types.js";

export class SerenaClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({ name: "csharp-analysis", version: "1.0.0" });
  }

  async connect(config: SerenaConfig): Promise<void> {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string> | undefined,
    });
    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  async findSymbol(options: {
    namePathPattern: string;
    relativePath?: string;
    depth?: number;
    includeInfo?: boolean;
    includeBody?: boolean;
    includeKinds?: number[];
    substringMatching?: boolean;
    maxMatches?: number;
  }): Promise<SerenaSymbol[]> {
    const args: Record<string, unknown> = {
      name_path_pattern: options.namePathPattern,
    };
    if (options.relativePath !== undefined) args.relative_path = options.relativePath;
    if (options.depth !== undefined) args.depth = options.depth;
    if (options.includeInfo !== undefined) args.include_info = options.includeInfo;
    if (options.includeBody !== undefined) args.include_body = options.includeBody;
    if (options.includeKinds !== undefined) args.include_kinds = options.includeKinds;
    if (options.substringMatching !== undefined) args.substring_matching = options.substringMatching;
    if (options.maxMatches !== undefined) args.max_matches = options.maxMatches;

    return await this.callTool<SerenaSymbol[]>("find_symbol", args);
  }

  async findReferencingSymbols(options: {
    namePath: string;
    relativePath: string;
    includeKinds?: number[];
    excludeKinds?: number[];
  }): Promise<SerenaReference[]> {
    const args: Record<string, unknown> = {
      name_path: options.namePath,
      relative_path: options.relativePath,
    };
    if (options.includeKinds !== undefined) args.include_kinds = options.includeKinds;
    if (options.excludeKinds !== undefined) args.exclude_kinds = options.excludeKinds;

    return await this.callTool<SerenaReference[]>("find_referencing_symbols", args);
  }

  async getSymbolsOverview(options: {
    relativePath: string;
    depth?: number;
  }): Promise<SerenaOverviewSymbol[]> {
    const args: Record<string, unknown> = {
      relative_path: options.relativePath,
    };
    if (options.depth !== undefined) args.depth = options.depth;

    return await this.callTool<SerenaOverviewSymbol[]>("get_symbols_overview", args);
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args });

    if (result.isError) {
      const errorText = extractText(result.content);
      throw new Error(`Serena tool '${name}' failed: ${errorText}`);
    }

    const text = extractText(result.content);
    return JSON.parse(text) as T;
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) {
    return String(content);
  }
  const textBlocks = content.filter(
    (block: unknown) => typeof block === "object" && block !== null && "type" in block && (block as { type: string }).type === "text",
  );
  return textBlocks.map((block: unknown) => (block as { text: string }).text).join("\n");
}
