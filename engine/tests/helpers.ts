import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const fixturesDir = path.resolve(__dirname, 'fixtures');

export function loadFixture(filename: string): Buffer {
  // El filesystem en macOS / OneDrive a veces guarda los nombres en NFD
  // (Ñ → N + U+0303). Buscamos comparando ambas formas.
  const entries = fs.readdirSync(fixturesDir);
  const target = filename.normalize('NFC');
  const match = entries.find((e) => e.normalize('NFC') === target);
  if (!match) {
    throw new Error(
      `Fixture no encontrado: ${filename}\nDisponibles: ${entries.join(', ')}`,
    );
  }
  return fs.readFileSync(path.join(fixturesDir, match));
}

export function approxEqual(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
