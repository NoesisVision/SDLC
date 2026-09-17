import { sep } from "path";
import {
  findSourceFiles,
  scanSourceFiles,
  type LanguageScanner,
  type ScannedFile,
  type SourceFileSet,
} from "../language-scanner.js";
import { extractPackage, parseStereotypedTypes } from "./java-source.js";

/*
 * The Java scanner: the package is the namespace, a type is a building block
 * when it carries a stereotype annotation of the Noesis Java annotations
 * module, its non-private methods are behaviors. Build outputs (beside the
 * module's build file) and test sources are left out.
 */

const JAVA_SOURCES: SourceFileSet = {
  extension: ".java",
  buildOutput: {
    dirs: new Set(["target", "build", "out"]),
    buildFiles: new Set(["pom.xml", "build.gradle", "build.gradle.kts"]),
  },
  /** Files that declare a package or a module rather than types. */
  ignoredFiles: new Set(["package-info.java", "module-info.java"]),
};

const TEST_SOURCE_ROOT = `${sep}src${sep}test${sep}`;

export const javaScanner: LanguageScanner = {
  language: "java",
  scan: scanJavaFiles,
};

export async function scanJavaFiles(projectDir: string): Promise<ScannedFile[]> {
  return scanSourceFiles(projectDir, await findJavaFiles(projectDir), "java", (content) => ({
    namespace: extractPackage(content) ?? "",
    types: parseStereotypedTypes(content),
  }));
}

/** Every main-source `.java` file under the directory, sorted. */
export async function findJavaFiles(dir: string): Promise<string[]> {
  const files = await findSourceFiles(dir, JAVA_SOURCES);
  return files.filter((f) => !f.includes(TEST_SOURCE_ROOT));
}
