import { join } from "path";
import {
  deleteFile,
  outputResult,
  parseArgs,
  readJson,
  requireDir,
  requireFile,
  writeJson,
} from "../io.js";
import {
  DocumentAnalysisSchema,
} from "../../shared-contracts/document-analysis.js";
import { DesignDocSchema } from "../../shared-contracts/design-doc.js";

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const analysisPath = join(args["working_dir"], "analysis.json");
  const analysis = await readJson(DocumentAnalysisSchema, analysisPath);
  const designDoc = await readJson(DesignDocSchema, args["input_file"]);

  const targetPath = join(args["working_dir"], "design_doc.json");
  await writeJson(targetPath, designDoc);

  analysis.design_doc_id = designDoc.id;
  analysis.design_doc_title = designDoc.name;
  analysis.design_doc_extracted = true;
  await writeJson(analysisPath, analysis);

  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    design_doc_id: designDoc.id,
    design_doc_name: designDoc.name,
    design_doc_path: targetPath,
  });
}

if (import.meta.main) {
  main();
}
