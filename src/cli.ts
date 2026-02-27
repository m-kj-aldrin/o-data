#!/usr/bin/env node
import { generateSchema } from "./parser/index.js";

async function main() {
  const configPath = process.argv[2];
  try {
    await generateSchema(configPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

