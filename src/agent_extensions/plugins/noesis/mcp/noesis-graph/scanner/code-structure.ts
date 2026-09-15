import type { Language } from "./language-scanner.js";

/*
 * What the code itself declares, kept beside the domain model so a block can
 * be traced back to its source: a namespace (C#) or package (Java), and a type
 * in it. Language-neutral by shape; `language` says which scanner found it.
 */

export interface CodeNamespace {
  name: string;
  fullName: string;
  language: Language;
}

export interface CodeType {
  id: string;
  name: string;
  fullName: string;
  filePath: string;
  language: Language;
}
