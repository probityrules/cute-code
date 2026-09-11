/** Shared graph IR — stable contract for host ↔ webview (and future bidirectional edits). */

export type NodeKind =
  | "module"
  | "function"
  | "arrow"
  | "method"
  | "class"
  | "import"
  | "export"
  | "external"
  | "binding"
  | "call"
  /** Inline equation / template / operator expression */
  | "expression"
  | "branch"
  | "loop"
  | "try"
  | "throw"
  | "jsx"
  | "fragment";

export type EdgeKind = "calls" | "param" | "returns" | "thread" | "ref" | "flow";

export type MemberKind = "constructor" | "method" | "get" | "set";

export type BindingKind = "const" | "let" | "var" | "prop";

/**
 * Best-effort runtime value kind for binding icons (from initializer AST).
 * `unknown` when we can't tell statically.
 */
export type ValueType =
  | "function"
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "undefined"
  | "class"
  | "unknown";

export interface SourceLoc {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  params: string[];
  /** Optional return annotation shown on the block */
  returnsLabel?: string;
  loc?: SourceLoc;
  /**
   * Span of the editable title in source (identifier / expression / tag name).
   * When set, the block title can be renamed and written back via this range.
   * Full-node `loc` remains the reveal/select range.
   */
  nameLoc?: SourceLoc;
  /**
   * Structural parent for class stacks (class id) or nested decl containers.
   * Not used for expand visibility — see scopeId.
   */
  parentId?: string;
  /** Superclass / mixin label for class nodes */
  extends?: string;
  /** Order within a class stack (constructor + methods). */
  stackOrder?: number;
  /** Class member kind when kind === "method" */
  memberKind?: MemberKind;
  /**
   * Owning scope for expand visibility: module id, function/arrow/method/class id.
   * Bindings/calls/nested decls with scopeId=X appear when X is expanded (or X is module).
   */
  scopeId?: string;
  /** const | let | var for locals; prop for member assignment targets (this.x / obj.x) */
  bindingKind?: BindingKind;
  /** Inferred value kind for binding icons (from initializer when present). */
  valueType?: ValueType;
  /**
   * For anonymous function/arrow expressions stored in a binding: the binding's
   * identifier (used for call resolution; label stays "() => {}" / "function() {}").
   */
  bindingName?: string;
  /** For call nodes: id of the declaration/definition this call refers to */
  refId?: string;
  /** Function/arrow/method/class can expand to show body (or class members) */
  expandable?: boolean;
  /** Module specifier for import nodes (e.g. "./util" or "fs") */
  importSource?: string;
  /** Receiver object for member calls / property writes (e.g. name, this) */
  receiver?: string;
  /** Member call or this.prop write: show this affordance. */
  hasThis?: boolean;
  /** Optional chaining on call / member path */
  hasOptional?: boolean;
  /** async function / method / arrow */
  async?: boolean;
  /** generator function / method */
  generator?: boolean;
  /** static class field or method */
  static?: boolean;
  /** Parent destructuring binding (ObjectPattern / ArrayPattern) */
  pattern?: boolean;
  /** Child slot's parent binding id */
  slotOf?: string;
  /** branch node subtype */
  branchKind?: "if" | "switch";
  /** loop node subtype */
  loopKind?: "for" | "for-of" | "for-in" | "while" | "do";
  /** JSX opening tag name */
  jsxTag?: string;
  /** Call has a spread argument → param:rest handle */
  hasRestParam?: boolean;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  label?: string;
  /** React Flow handle id on the source node (e.g. param:0, out) */
  sourceHandle?: string;
  /** React Flow handle id on the target node (e.g. param:1, in, ref) */
  targetHandle?: string;
}

export interface StructureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  fileName?: string;
}

export interface ParseErrorPayload {
  message: string;
  line?: number;
  column?: number;
}

/** Host → webview */
export type HostToWebviewMessage =
  | { type: "setGraph"; graph: StructureGraph }
  | { type: "setError"; error: ParseErrorPayload }
  | { type: "setEmpty"; reason: string }
  | { type: "renameTitleResult"; ok: true; nodeId: string; graph: StructureGraph }
  | { type: "renameTitleResult"; ok: false; nodeId: string; message: string }
  ;

/** Webview → host */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "selectNode"; nodeId: string; loc?: SourceLoc }
  | { type: "openImport"; source: string }
  | {
      type: "renameTitle";
      nodeId: string;
      nameLoc: SourceLoc;
      newText: string;
    }
  ;
