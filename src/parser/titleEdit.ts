import type { ParseErrorPayload, SourceLoc, StructureGraph } from "../shared/graph";
import { extractGraph } from "./extractGraph";

/** Map 1-based line / 0-based column to a string offset (Babel / VS Code style). */
export function positionToOffset(code: string, line: number, column: number): number {
  let ln = 1;
  let col = 0;
  for (let i = 0; i < code.length; i++) {
    if (ln === line && col === column) return i;
    const ch = code[i];
    if (ch === "\n") {
      ln += 1;
      col = 0;
    } else if (ch === "\r") {
      // Treat \r\n as one newline; lone \r as newline.
      if (code[i + 1] === "\n") continue;
      ln += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  if (ln === line && col === column) return code.length;
  throw new Error(`Position ${line}:${column} is outside the document`);
}

export function replaceAtLoc(code: string, loc: SourceLoc, newText: string): string {
  const start = positionToOffset(code, loc.startLine, loc.startCol);
  const end = positionToOffset(code, loc.endLine, loc.endCol);
  if (start > end) throw new Error("Invalid nameLoc range");
  return code.slice(0, start) + newText + code.slice(end);
}

export type TitleEditResult =
  | { ok: true; code: string; graph: StructureGraph }
  | { ok: false; error: ParseErrorPayload };

/**
 * Preview a title edit: splice `newText` at `nameLoc` and re-parse.
 * Does not mutate the file — caller applies only when `ok`.
 */
export function tryTitleEdit(
  code: string,
  nameLoc: SourceLoc,
  newText: string,
  fileName?: string
): TitleEditResult {
  let next: string;
  try {
    next = replaceAtLoc(code, nameLoc, newText);
  } catch (err) {
    return {
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
  const result = extractGraph(next, fileName);
  if (!result.ok) return result;
  return { ok: true, code: next, graph: result.graph };
}
