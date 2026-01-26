/**
 * API Schema Generator for tRPC Router
 *
 * Extracts Zod schemas from all tRPC procedures and generates
 * a JSON schema file for API contract comparison in CI.
 *
 * Usage: npx tsx scripts/generate-api-schema.ts
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import * as fs from 'fs';
import * as path from 'path';
import type { ZodTypeAny } from 'zod';

interface ProcedureDef {
  inputs?: ZodTypeAny[];
  output?: ZodTypeAny;
  type?: 'query' | 'mutation' | 'subscription';
}

interface ProcedureObj {
  _def: ProcedureDef;
}

interface SchemaEntry {
  type: string;
  input?: unknown;
  output?: unknown;
}

interface ApiSchema {
  version: string;
  procedures: Record<string, SchemaEntry>;
}

/**
 * Generate stable, sorted JSON for consistent diffing
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

async function main() {
  console.log('Generating API schema...');

  // Dynamic import to handle ESM/CJS issues
  const { appRouter } = await import('../src/trpc/routers/_app');

  const routerDef = (appRouter as { _def: { procedures: Record<string, ProcedureObj> } })._def;
  const flatProcedures = routerDef.procedures;

  const procedureNames = Object.keys(flatProcedures).sort();
  console.log(`Found ${procedureNames.length} procedures`);

  const procedures: Record<string, SchemaEntry> = {};

  for (const name of procedureNames) {
    const proc = flatProcedures[name];
    const procDef = proc._def;

    const entry: SchemaEntry = {
      type: procDef.type || 'unknown',
    };

    // Extract input schema (tRPC v11 uses inputs array)
    if (procDef.inputs && procDef.inputs.length > 0) {
      try {
        // Use the last input schema (the actual user input, not context)
        const inputSchema = procDef.inputs[procDef.inputs.length - 1];
        const jsonSchema = zodToJsonSchema(inputSchema, { target: 'jsonSchema7' });
        // Remove $schema field for cleaner output
        if (typeof jsonSchema === 'object' && jsonSchema !== null) {
          delete (jsonSchema as Record<string, unknown>)['$schema'];
        }
        entry.input = jsonSchema;
      } catch (e) {
        entry.input = { error: `Could not extract: ${String(e)}` };
      }
    }

    // Extract output schema if defined
    if (procDef.output) {
      try {
        const jsonSchema = zodToJsonSchema(procDef.output, { target: 'jsonSchema7' });
        if (typeof jsonSchema === 'object' && jsonSchema !== null) {
          delete (jsonSchema as Record<string, unknown>)['$schema'];
        }
        entry.output = jsonSchema;
      } catch (e) {
        entry.output = { error: `Could not extract: ${String(e)}` };
      }
    }

    procedures[name] = entry;
  }

  const schema: ApiSchema = {
    version: '1.0.0',
    procedures: sortObjectKeys(procedures) as Record<string, SchemaEntry>,
  };

  // Sort top-level for stable output
  const sortedSchema = sortObjectKeys(schema) as ApiSchema;

  const outputPath = path.join(__dirname, '..', 'api-schema.json');
  fs.writeFileSync(outputPath, JSON.stringify(sortedSchema, null, 2) + '\n');

  console.log(`API schema written to: ${outputPath}`);
}

main().catch((error) => {
  console.error('Failed to generate API schema:', error);
  process.exit(1);
});
