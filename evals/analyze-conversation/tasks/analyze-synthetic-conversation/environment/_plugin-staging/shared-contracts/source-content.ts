import { z } from "zod";
import { IdeaUnitRefSchema, type IdeaUnitRef } from "./conversation.js";
import {
  DocumentFragmentRefSchema,
  type DocumentFragmentRef,
} from "./document.js";

export const SourceContentRefSchema = z.union([
  IdeaUnitRefSchema,
  DocumentFragmentRefSchema,
]);
export type SourceContentRef = IdeaUnitRef | DocumentFragmentRef;
