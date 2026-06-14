import * as fs from "node:fs";
import * as path from "node:path";

export type JsonRecord = Record<string, unknown>;

export function appendJsonl(file: string, entry: JsonRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() }) + "\n");
}

export function parseJsonlLine(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

export function readJsonl(file: string): JsonRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(parseJsonlLine)
    .filter((entry): entry is JsonRecord => entry !== null);
}

export function tailJsonl(file: string, limit: number): JsonRecord[] {
  const rows = readJsonl(file);
  return rows.slice(Math.max(0, rows.length - limit));
}

export function countJsonl(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).length;
}

export function appendEvent(file: string, type: string, data: JsonRecord = {}): void {
  appendJsonl(file, { type, ...data });
}

