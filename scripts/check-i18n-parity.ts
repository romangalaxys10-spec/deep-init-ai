/* Verify EN/RU/HE i18n dictionaries share the exact same key set. */
import { readFileSync } from "fs";

const src = readFileSync("src/lib/i18n.ts", "utf8");
const extract = (name: string): Set<string> => {
  const start = src.indexOf(`const ${name}: Record<string, string> = {`);
  const end = src.indexOf("\n};", start);
  const body = src.slice(start, end);
  return new Set([...body.matchAll(/"([a-z0-9.]+)":/g)].map((m) => m[1]));
};

const en = extract("en");
const ru = extract("ru");
const he = extract("he");
const diff = (a: Set<string>, b: Set<string>, an: string, bn: string) =>
  [...a].filter((k) => !b.has(k)).map((k) => `${an} only: ${k}`);
const d = [
  ...diff(en, ru, "en", "ru"),
  ...diff(ru, en, "ru", "en"),
  ...diff(en, he, "en", "he"),
  ...diff(he, en, "he", "en"),
];
console.log(d.length ? d.join("\n") : `i18n key parity: EN/RU/HE all match (${en.size} keys)`);
process.exit(d.length ? 1 : 0);
