import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "../../../../shared-contracts/design-doc-new.js";
import { ensureNoesisLayout } from "../../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DesignDocsRepositoryNew } from "./design-docs-new.repository.js";

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  design_doc_id: string;
}

export interface PrepareDesignDocPathInput {
  id?: string;
  name: string;
}

export interface PrepareDesignDocPathOk {
  status: "Ok";
  id: string;
  canonical_path: string;
}

export interface PrepareDesignDocPathAlreadyImplemented {
  status: "AlreadyImplemented";
  design_doc_id: string;
  name: string;
}

export type PrepareDesignDocPathResult =
  | PrepareDesignDocPathOk
  | PrepareDesignDocPathAlreadyImplemented;

@Injectable()
export class DesignDocsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DesignDocsRepositoryNew,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ design_doc_id: string } | null> {
    const all = await this.repository.listAll();
    const target = all.find((row) => row.source_path === absPath);
    if (target === undefined) return null;
    await this.repository.delete(target.id);
    return { design_doc_id: target.id };
  }

  async editTopFields(
    designDocId: string,
    fields: { name?: string; description?: string },
    confirmedByUser: boolean,
  ): Promise<{ updated: Array<"name" | "description"> }> {
    const path = await this.requireFilePath(designDocId);
    const file = this.repository.readFile(path);
    if (file.implemented) {
      throw new Error(
        `DesignDoc ${designDocId} is marked implemented and cannot be modified.`,
      );
    }
    const updated: Array<"name" | "description"> = [];
    let next: DesignDocFileNew = file;
    if (fields.name !== undefined && file.name !== fields.name) {
      if (file.name_locked && !confirmedByUser) {
        throw new Error(
          `DesignDoc ${file.id}: field "name" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, name: fields.name };
      updated.push("name");
    }
    if (
      fields.description !== undefined &&
      file.description !== fields.description
    ) {
      if (file.description_locked && !confirmedByUser) {
        throw new Error(
          `DesignDoc ${file.id}: field "description" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, description: fields.description };
      updated.push("description");
    }
    if (updated.length === 0) return { updated: [] };
    this.persistFile(next);
    return { updated };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha && stored.source_path === absPath) {
      return { status: "unchanged", design_doc_id: file.id };
    }
    await this.repository.upsert(file, sha, absPath);
    return { status: "indexed", design_doc_id: file.id };
  }

  async listActors(): Promise<
    Array<{ name: string; description: string; description_locked: boolean }>
  > {
    return this.repository.listActors();
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles();
  }

  async markImplemented(designDocId: string): Promise<{ design_doc_id: string }> {
    const path = await this.requireFilePath(designDocId);
    const file = this.repository.readFile(path);
    if (file.implemented) return { design_doc_id: file.id };
    const next: DesignDocFileNew = { ...file, implemented: true };
    this.repository.writeFile(path, next);
    if (await this.repository.exists(designDocId)) {
      await this.repository.writeImplementedFlag(designDocId, true);
    }
    return { design_doc_id: file.id };
  }

  /**
   * Save an in-memory design-doc file to its canonical location. Used by skills /
   * tests that already hold the parsed object.
   */
  persistFile(file: DesignDocFileNew): string {
    ensureNoesisLayout(this.projectDir);
    const newPath = this.canonicalPath(file.id, file.name);
    const previous = this.repository.findFileById(this.projectDir, file.id);
    if (previous !== null && previous !== newPath) {
      this.repository.deleteFile(previous);
    }
    this.repository.writeFile(newPath, file);
    return newPath;
  }

  /**
   * DocumentsServiceNew calls this with the working-dir path to the design-doc JSON.
   * The service reads + validates + writes to the canonical path, removing the prior
   * canonical file when the rename changes the filename. Returns the final canonical path.
   */
  persistFromWorkingFile(workingDirPath: string): string {
    if (!existsSync(workingDirPath)) {
      throw new Error(`Design doc working file not found: ${workingDirPath}`);
    }
    const file = DesignDocFileNewSchema.parse(
      JSON.parse(readFileSync(workingDirPath, "utf-8")),
    );
    return this.persistFile(file);
  }

  async prepareDesignDocPath(
    input: PrepareDesignDocPathInput,
  ): Promise<PrepareDesignDocPathResult> {
    if (input.id !== undefined) {
      const implemented = await this.repository.readImplementedFlag(input.id);
      if (implemented === true) {
        return {
          status: "AlreadyImplemented",
          design_doc_id: input.id,
          name: input.name,
        };
      }
    }
    const id = input.id ?? crypto.randomUUID();
    ensureNoesisLayout(this.projectDir);
    return {
      status: "Ok",
      id,
      canonical_path: this.canonicalPath(id, input.name),
    };
  }

  private canonicalPath(id: string, name: string): string {
    return this.repository.canonicalPath(this.projectDir, id, name);
  }

  private async requireFilePath(designDocId: string): Promise<string> {
    const path = this.repository.findFileById(this.projectDir, designDocId);
    if (path === null) {
      throw new Error(`DesignDoc ${designDocId} has no source file on disk.`);
    }
    return path;
  }
}
