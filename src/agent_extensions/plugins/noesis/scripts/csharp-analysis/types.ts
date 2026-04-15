import { z } from "zod";

// --- LSP Symbol Kinds ---

export const LSP_KIND = {
  NAMESPACE: 3,
  CLASS: 5,
  METHOD: 6,
  PROPERTY: 7,
  FIELD: 8,
  CONSTRUCTOR: 9,
  ENUM: 10,
  INTERFACE: 11,
  STRUCT: 23,
} as const;

export const TYPE_KINDS = [
  LSP_KIND.CLASS,
  LSP_KIND.STRUCT,
  LSP_KIND.INTERFACE,
  LSP_KIND.ENUM,
] as const;

export const MEMBER_KINDS = [
  LSP_KIND.METHOD,
  LSP_KIND.PROPERTY,
  LSP_KIND.FIELD,
] as const;

// --- Input Config ---

export const SerenaConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});
export type SerenaConfig = z.infer<typeof SerenaConfigSchema>;

export const InputConfigSchema = z.object({
  serena: SerenaConfigSchema,
  attributes: z.array(z.string()).min(1),
});
export type InputConfig = z.infer<typeof InputConfigSchema>;

// --- Serena Response Types ---

export const SymbolLocationSchema = z.object({
  line: z.number(),
  character: z.number(),
});

export const SymbolRangeSchema = z.object({
  start: SymbolLocationSchema,
  end: SymbolLocationSchema,
});

export const SerenaSymbolSchema: z.ZodType<SerenaSymbol> = z.object({
  name: z.string(),
  name_path: z.string(),
  kind: z.number(),
  relative_path: z.string(),
  range: SymbolRangeSchema.optional(),
  info: z.string().optional(),
  body: z.string().optional(),
  children: z.lazy(() => z.array(SerenaSymbolSchema)).optional(),
}).passthrough();

export type SerenaSymbol = {
  name: string;
  name_path: string;
  kind: number;
  relative_path: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  info?: string;
  body?: string;
  children?: SerenaSymbol[];
};

export const SerenaReferenceSchema = z.object({
  referencing_symbol: SerenaSymbolSchema,
  snippet: z.string().optional(),
}).passthrough();
export type SerenaReference = z.infer<typeof SerenaReferenceSchema>;

export const SerenaOverviewSymbolSchema = z.object({
  name: z.string(),
  name_path: z.string(),
  kind: z.number(),
  relative_path: z.string(),
}).passthrough();
export type SerenaOverviewSymbol = z.infer<typeof SerenaOverviewSymbolSchema>;

// --- Output Types ---

export const ParameterInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type ParameterInfo = z.infer<typeof ParameterInfoSchema>;

export const MethodInfoSchema = z.object({
  name: z.string(),
  returnType: z.string(),
  parameters: z.array(ParameterInfoSchema),
});
export type MethodInfo = z.infer<typeof MethodInfoSchema>;

export const PropertyInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type PropertyInfo = z.infer<typeof PropertyInfoSchema>;

export const FieldInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type FieldInfo = z.infer<typeof FieldInfoSchema>;

export type TypeKind = "class" | "struct" | "interface" | "enum";

export const TypeInfoSchema = z.object({
  name: z.string(),
  fullyQualifiedName: z.string(),
  namespace: z.string(),
  kind: z.enum(["class", "struct", "interface", "enum"]),
  filePath: z.string(),
  attributes: z.array(z.string()),
  methods: z.array(MethodInfoSchema),
  properties: z.array(PropertyInfoSchema),
  fields: z.array(FieldInfoSchema),
});
export type TypeInfo = z.infer<typeof TypeInfoSchema>;

export const AnalysisResultSchema = z.object({
  types: z.array(TypeInfoSchema),
  errors: z.array(z.object({
    attribute: z.string(),
    message: z.string(),
  })),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// --- Helpers ---

export function lspKindToTypeKind(kind: number): TypeKind | null {
  switch (kind) {
    case LSP_KIND.CLASS: return "class";
    case LSP_KIND.STRUCT: return "struct";
    case LSP_KIND.INTERFACE: return "interface";
    case LSP_KIND.ENUM: return "enum";
    default: return null;
  }
}
