// Usage: npx vite-node scripts/convert-tariffs.ts <private tariffs.json> <out ratebook.json>
// Converts the private transcription into the RateBook stored in Supabase. Output is private; do not commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { convertTariffs } from '../src/engine/convert';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: convert-tariffs <tariffs.json> <out.json>');
  process.exit(1);
}
const book = convertTariffs(JSON.parse(readFileSync(src, 'utf8')));
writeFileSync(out, JSON.stringify(book));
console.log(`ok: ${book.banks.length} banks, ${book.banks.reduce((n, b) => n + b.programmes.length, 0)} programmes`);
