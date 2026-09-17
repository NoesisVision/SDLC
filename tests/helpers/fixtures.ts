import { resolve } from "path";

const FIXTURES_ROOT = resolve(import.meta.dir, "..", "fixtures");

/** Absolute path of a file or directory under `tests/fixtures/`. */
export function fixturePath(...segments: string[]): string {
  return resolve(FIXTURES_ROOT, ...segments);
}
