import "reflect-metadata";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { SerenaController } from "./serena.controller.js";
import { SerenaService, type SerenaState } from "./serena.service.js";
import { DATA_DIR } from "../config/config.module.js";

describe("SerenaController", () => {
  let app: INestApplication;
  const mockState: SerenaState = {
    status: "connected",
    tools: ["find_symbol", "get_symbols_overview"],
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SerenaController],
      providers: [
        {
          provide: SerenaService,
          useValue: { getState: () => mockState },
        },
        { provide: DATA_DIR, useValue: "/tmp" },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
  });

  test("GET /api/serena/status returns state", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/api/serena/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockState);
  });
});
