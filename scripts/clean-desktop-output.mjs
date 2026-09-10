import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(projectRoot, 'release');
const expectedOutputDirectory = path.join(projectRoot, 'release');

if (outputDirectory !== expectedOutputDirectory) {
  throw new Error(`Refusing to clean an unexpected packaging directory: ${outputDirectory}`);
}

await rm(outputDirectory, {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 250,
});
