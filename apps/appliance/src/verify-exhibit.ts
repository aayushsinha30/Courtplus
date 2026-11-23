import { readFileSync } from 'node:fs';
import { verifyExhibit } from './vault.js';

try {
  const [file, id, manifest, publicKey, ...extra] = process.argv.slice(2);
  if (!file || !id || !manifest || !publicKey || extra.length) {
    throw new Error('Usage: node verify-exhibit.js FILE FILE_ID_OR_statement MANIFEST_JSON TRUSTED_PUBLIC_KEY_PEM');
  }
  const result = verifyExhibit(readFileSync(file), id, JSON.parse(readFileSync(manifest, 'utf8')), readFileSync(publicKey, 'utf8'));
  console.log(JSON.stringify({ valid: true, ...result }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
