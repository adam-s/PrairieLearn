#!/usr/bin/env node

// usage:
// $ tsx gen-element-schemas.mts [check]

import fs from 'fs';
import path from 'path';

import prettier from 'prettier';

import { serializeElementSchemas } from '../apps/prairielearn/src/ee/lib/element-schemas/index.js';

const check = process.argv[2] === 'check';

const generatedFiles: Record<string, unknown> = {};
const serialized = serializeElementSchemas();

function elementSchemaPath(elementName: string, schemaName = elementName) {
  return path.resolve(
    import.meta.dirname,
    `../apps/prairielearn/elements/${elementName}/${schemaName}.schema.json`,
  );
}

for (const [elementName, schema] of Object.entries(serialized.schemas)) {
  generatedFiles[elementSchemaPath(elementName)] = schema;
}

for (const [elementName, childSchemas] of Object.entries(serialized.childSchemas)) {
  for (const [childName, schema] of Object.entries(childSchemas)) {
    generatedFiles[elementSchemaPath(elementName, childName)] = schema;
  }
}

async function stringify(filePath: string, value: unknown): Promise<string> {
  const config = await prettier.resolveConfig(filePath);
  return await prettier.format(`${JSON.stringify(value, null, 2)}\n`, {
    ...config,
    parser: 'json',
  });
}

console.log(check ? 'Checking element schemas...' : 'Writing element schemas...');

for (const [filePath, value] of Object.entries(generatedFiles)) {
  const contents = await stringify(filePath, value);

  if (check) {
    try {
      const existingContents = fs.readFileSync(filePath, 'utf8');
      if (existingContents !== contents) {
        console.error(
          `Mismatch in ${filePath} (Do you need to run \`make update-element-schemas\`?)`,
        );
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error reading element schema file ${filePath}:`, error);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(filePath, contents);
  }
}
