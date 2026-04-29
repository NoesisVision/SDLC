import { existsSync, readFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import {
  DesignDocSchema,
  type DesignDoc,
} from "../../../shared-contracts/design-doc.js";
import {
  designDocJsonPath,
  ensureNoesisLayout,
  readSidecar,
  writeSidecar,
} from "../../../shared-contracts/source-files.js";

export interface SplitDesignDocOptions {
  projectDir: string;
  sourcePath?: string;
}

export interface SplitDesignDocResult {
  canonical_path: string;
  source_relocated: boolean;
  skipped: boolean;
}

export function splitDesignDoc(
  designDoc: DesignDoc,
  options: SplitDesignDocOptions,
): SplitDesignDocResult {
  ensureNoesisLayout(options.projectDir);
  const target = designDocJsonPath(options.projectDir, designDoc.id);
  const prev = loadIfExists(target);

  if (prev?.edited_by_user === true) {
    return { canonical_path: target, source_relocated: false, skipped: true };
  }

  const next: DesignDoc = { ...designDoc, edited_by_user: false };
  writeSidecar(target, next, DesignDocSchema);

  let relocated = false;
  if (options.sourcePath !== undefined) {
    const resolvedSource = resolve(options.sourcePath);
    if (resolvedSource !== target && existsSync(resolvedSource)) {
      try {
        unlinkSync(resolvedSource);
        relocated = true;
      } catch {
        // best-effort
      }
    }
  }

  return { canonical_path: target, source_relocated: relocated, skipped: false };
}

function loadIfExists(path: string): DesignDoc | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, DesignDocSchema);
  } catch {
    return null;
  }
}

export function readDesignDocBytesForSha(target: string): Buffer {
  return readFileSync(target);
}
