import { basename, dirname, join } from "path";

export function getDocumentWorkingDir(documentPath: string): string {
  const dir = dirname(documentPath);
  const stem = basename(documentPath).replace(/\.[^.]+$/, "");
  return join(dir, `${stem}_design_work`);
}
