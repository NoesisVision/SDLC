import "reflect-metadata";
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
  mock,
} from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { and, given, then, when } from "@tests/bdd.js";
import { SerenaService } from "@noesis/mcp/noesis-graph/serena/serena.service.js";
import { PROJECT_DIR } from "@noesis/mcp/noesis-graph/config/config.module.js";

interface FakeClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  listTools: () => Promise<{ tools: Array<{ name: string }> }>;
  callTool: (req: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ content: unknown; isError?: boolean }>;
}

const fakeClient: FakeClient = {
  connect: async () => {},
  close: async () => {},
  listTools: async () => ({ tools: [] }),
  callTool: async () => ({ content: [] }),
};

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = (...args: Parameters<FakeClient["connect"]>) =>
      fakeClient.connect(...args);
    close = () => fakeClient.close();
    listTools = () => fakeClient.listTools();
    callTool = (req: Parameters<FakeClient["callTool"]>[0]) =>
      fakeClient.callTool(req);
  },
}));

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(_args: unknown) {}
  },
}));

describe("SerenaService — Serena MCP client lifecycle and tool calls", () => {
  let module: TestingModule;
  let service: SerenaService;

  beforeEach(async () => {
    fakeClient.connect = async () => {};
    fakeClient.close = async () => {};
    fakeClient.listTools = async () => ({
      tools: [{ name: "find_symbol" }, { name: "find_references" }],
    });
    fakeClient.callTool = async () => ({ content: [{ type: "text", text: "{}" }] });

    module = await Test.createTestingModule({
      providers: [
        SerenaService,
        { provide: PROJECT_DIR, useValue: "/tmp/some-project" },
      ],
    }).compile();
    service = module.get(SerenaService);
  });

  afterEach(async () => {
    await module.close();
  });

  test("a brand new service starts disconnected with no advertised tools", async () => {
    let state: ReturnType<SerenaService["getState"]>;

    await given("a freshly constructed SerenaService", () => {});
    await when("the caller reads its state", () => {
      state = service.getState();
    });
    await then("the status is 'disconnected' with no error or tool list", () => {
      expect(state).toEqual({ status: "disconnected" });
    });
  });

  test("the first tool call connects on demand and returns the parsed JSON payload", async () => {
    let connectCalls = 0;
    let result: { hello: string };

    await given("a Serena server that responds with JSON content", () => {
      fakeClient.connect = async () => {
        connectCalls += 1;
      };
      fakeClient.callTool = async () => ({
        content: [{ type: "text", text: '{"hello": "world"}' }],
      });
    });
    await when("the consumer issues its first callTool request", async () => {
      result = await service.callTool<{ hello: string }>("find_symbol", {
        name_path: "Foo",
      });
    });
    await then("the service connects exactly once before sending the request", () => {
      expect(connectCalls).toBe(1);
    });
    await and("the returned text is parsed as JSON for the caller", () => {
      expect(result).toEqual({ hello: "world" });
    });
    await and(
      "the state transitions to 'connected' and exposes the tool catalogue",
      () => {
        expect(service.getState()).toEqual({
          status: "connected",
          tools: ["find_symbol", "find_references"],
        });
      },
    );
  });

  test("a failed connection transitions the service to an error state", async () => {
    let thrown: Error | null = null;

    await given("an unreachable Serena process that fails to connect", () => {
      fakeClient.connect = async () => {
        throw new Error("uvx not found on PATH");
      };
    });
    await when("a caller tries to invoke any tool", async () => {
      try {
        await service.callTool("find_symbol", {});
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the call propagates the underlying connection error", () => {
      expect(thrown?.message).toMatch(/uvx not found/);
    });
    await and(
      "the state captures the error so observers can react to it",
      () => {
        const state = service.getState();
        expect(state.status).toBe("error");
        expect(state.error).toMatch(/uvx not found/);
      },
    );
  });

  test("a tool that reports failure surfaces the error message to the caller", async () => {
    let thrown: Error | null = null;

    await given(
      "a connected Serena server whose tool returns an error response",
      () => {
        fakeClient.callTool = async () => ({
          content: [{ type: "text", text: "symbol not found" }],
          isError: true,
        });
      },
    );
    await when("the consumer invokes that tool", async () => {
      try {
        await service.callTool("find_symbol", { name_path: "Bar" });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then(
      "the thrown error names the failing tool and includes its message",
      () => {
        expect(thrown?.message).toMatch(/find_symbol/);
        expect(thrown?.message).toMatch(/symbol not found/);
      },
    );
  });

  test("a tool that returns non-JSON payload raises a descriptive error", async () => {
    let thrown: Error | null = null;

    await given("a connected Serena server returning plain text", () => {
      fakeClient.callTool = async () => ({
        content: [{ type: "text", text: "hello world" }],
      });
    });
    await when("the consumer invokes a tool", async () => {
      try {
        await service.callTool("find_symbol", {});
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then(
      "the error mentions the offending tool and includes a snippet of the payload",
      () => {
        expect(thrown?.message).toMatch(/non-JSON/);
        expect(thrown?.message).toMatch(/find_symbol/);
        expect(thrown?.message).toMatch(/hello world/);
      },
    );
  });

  test("module destruction cleanly closes any active client connection", async () => {
    let closeCalls = 0;

    await given("a Serena service connected through one prior tool call", async () => {
      fakeClient.close = async () => {
        closeCalls += 1;
      };
      await service.callTool("find_symbol", {});
    });
    await when("the host module is destroyed", async () => {
      await service.onModuleDestroy();
    });
    await then("the underlying client is closed exactly once", () => {
      expect(closeCalls).toBe(1);
    });
  });
});
