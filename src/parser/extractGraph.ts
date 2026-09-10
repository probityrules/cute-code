import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { VISITOR_KEYS } from "@babel/types";
import type {
  BindingKind,
  GraphEdge,
  GraphNode,
  MemberKind,
  ParseErrorPayload,
  SourceLoc,
  StructureGraph,
} from "../shared/graph";
import { locKey, orderByExecution } from "../shared/executionOrder";

const traverse = (
  typeof _traverse === "function"
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default
) as typeof _traverse;

const MODULE_ID = "module:root";

function locOf(node: t.Node): SourceLoc | undefined {
  if (!node.loc) return undefined;
  return {
    startLine: node.loc.start.line,
    startCol: node.loc.start.column,
    endLine: node.loc.end.line,
    endCol: node.loc.end.column,
  };
}

function paramNames(
  params: (t.Identifier | t.Pattern | t.RestElement | t.TSParameterProperty)[]
): string[] {
  return params.map((p) => {
    if (t.isIdentifier(p)) return p.name;
    if (t.isRestElement(p) && t.isIdentifier(p.argument)) return `...${p.argument.name}`;
    if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return p.left.name;
    if (t.isObjectPattern(p)) return "{…}";
    if (t.isArrayPattern(p)) return "[…]";
    return "?";
  });
}

function simpleReturnLabel(body: t.BlockStatement | t.Expression): string | undefined {
  if (t.isExpression(body)) {
    if (t.isIdentifier(body)) return body.name;
    if (t.isLiteral(body)) {
      return t.isStringLiteral(body)
        ? JSON.stringify(body.value)
        : String((body as t.NumericLiteral).value ?? "…");
    }
    if (t.isCallExpression(body) && t.isIdentifier(body.callee)) return `${body.callee.name}()`;
    return "expr";
  }
  const returns = body.body.filter((s): s is t.ReturnStatement => t.isReturnStatement(s));
  if (returns.length === 0) return undefined;
  const last = returns[returns.length - 1];
  if (!last.argument) return "undefined";
  if (t.isIdentifier(last.argument)) return last.argument.name;
  if (t.isCallExpression(last.argument) && t.isIdentifier(last.argument.callee)) {
    return `${last.argument.callee.name}()`;
  }
  if (t.isLiteral(last.argument)) {
    if (t.isStringLiteral(last.argument)) return JSON.stringify(last.argument.value);
    if (t.isNumericLiteral(last.argument) || t.isBooleanLiteral(last.argument)) {
      return String(last.argument.value);
    }
  }
  return "…";
}

function bindingKindOf(path: NodePath<t.VariableDeclarator>): BindingKind {
  const parent = path.parentPath;
  if (parent?.isVariableDeclaration()) {
    const k = parent.node.kind;
    if (k === "const" || k === "let" || k === "var") return k;
  }
  return "var";
}

/** Templates, operators, literals, concats — shown as inline equation/value blocks. */
function isInlineExpression(node: t.Expression): boolean {
  return (
    t.isTemplateLiteral(node) ||
    t.isTaggedTemplateExpression(node) ||
    t.isBinaryExpression(node) ||
    t.isLogicalExpression(node) ||
    t.isConditionalExpression(node) ||
    t.isUnaryExpression(node) ||
    t.isUpdateExpression(node) ||
    t.isSequenceExpression(node) ||
    t.isArrayExpression(node) ||
    t.isObjectExpression(node) ||
    t.isBooleanLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node)
  );
}

function sourceSlice(node: t.Node, code: string): string {
  if (typeof node.start === "number" && typeof node.end === "number") {
    return code.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  }
  return "…";
}

type ExprInput =
  | { kind: "id"; name: string }
  | { kind: "call"; node: t.CallExpression | t.NewExpression; label: string };

/** Free identifiers and nested call/new roots feeding an inline expression. */
function collectExprInputs(expr: t.Expression): ExprInput[] {
  const inputs: ExprInput[] = [];
  const seenIds = new Set<string>();
  const seenCalls = new Set<object>();

  function walk(node: t.Node | null | undefined, parent: t.Node | null) {
    if (!node) return;

    if (t.isIdentifier(node)) {
      if (
        parent &&
        t.isMemberExpression(parent) &&
        parent.property === node &&
        !parent.computed
      ) {
        return;
      }
      if (
        parent &&
        (t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassProperty(parent)) &&
        parent.key === node &&
        !("computed" in parent && parent.computed)
      ) {
        return;
      }
      if (!seenIds.has(node.name)) {
        seenIds.add(node.name);
        inputs.push({ kind: "id", name: node.name });
      }
      return;
    }

    if (t.isCallExpression(node) || t.isNewExpression(node)) {
      if (!seenCalls.has(node)) {
        seenCalls.add(node);
        let label = "()";
        if (t.isNewExpression(node) && t.isIdentifier(node.callee)) {
          label = `new ${node.callee.name}()`;
        } else if (t.isCallExpression(node)) {
          if (t.isIdentifier(node.callee)) label = `${node.callee.name}()`;
          else if (
            t.isMemberExpression(node.callee) &&
            t.isIdentifier(node.callee.property)
          ) {
            label = `${node.callee.property.name}()`;
          } else label = "call()";
        }
        inputs.push({ kind: "call", node, label });
      }
      return;
    }

    const keys = VISITOR_KEYS[node.type];
    if (!keys) return;
    for (const key of keys) {
      const val = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(val)) {
        for (const el of val) {
          if (el && typeof el === "object" && "type" in (el as object)) {
            walk(el as t.Node, node);
          }
        }
      } else if (val && typeof val === "object" && "type" in val) {
        walk(val as t.Node, node);
      }
    }
  }

  walk(expr, null);
  return inputs;
}

export type ExtractResult =
  | { ok: true; graph: StructureGraph }
  | { ok: false; error: ParseErrorPayload };

export function extractGraph(code: string, fileName?: string): ExtractResult {
  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "dynamicImport"],
      errorRecovery: false,
    });
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number } };
    return {
      ok: false,
      error: {
        message: e.message ?? String(err),
        line: e.loc?.line,
        column: e.loc?.column,
      },
    };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  /** name → declaration id (best-effort, last wins for same name) */
  const nameToId = new Map<string, string>();
  /** binding name → binding node id within scope (scopeId::name) */
  const bindingIds = new Map<string, string>();
  let edgeSeq = 0;
  let callSeq = 0;
  let exprSeq = 0;
  let propSeq = 0;

  nodes.push({
    id: MODULE_ID,
    kind: "module",
    label: fileName ? fileName.split(/[/\\]/).pop()! : "module",
    params: [],
    loc: locOf(ast.program),
    scopeId: MODULE_ID,
  });

  function addNode(node: GraphNode) {
    nodes.push(node);
  }

  function addEdge(
    kind: GraphEdge["kind"],
    source: string,
    target: string,
    label?: string,
    handles?: { sourceHandle?: string; targetHandle?: string }
  ) {
    edgeSeq += 1;
    edges.push({
      id: `e:${kind}:${edgeSeq}`,
      kind,
      source,
      target,
      label,
      sourceHandle: handles?.sourceHandle,
      targetHandle: handles?.targetHandle,
    });
  }

  function ensureExternal(name: string): string {
    const id = `external:${name}`;
    if (!nodes.some((n) => n.id === id)) {
      addNode({
        id,
        kind: "external",
        label: name,
        params: [],
        scopeId: MODULE_ID,
      });
    }
    return id;
  }

  function enclosingScopeId(path: NodePath): string {
    const fn = path.findParent(
      (p) =>
        p.isFunctionDeclaration() ||
        p.isFunctionExpression() ||
        p.isArrowFunctionExpression() ||
        p.isClassMethod() ||
        p.isClassPrivateMethod()
    );
    if (!fn) return MODULE_ID;

    if (fn.isFunctionDeclaration() && fn.node.id) {
      const id = `fn:${fn.node.id.name}:L${fn.node.loc?.start.line ?? 0}`;
      return nameToId.get(fn.node.id.name) === id
        ? id
        : nameToId.get(fn.node.id.name) ?? id;
    }
    if (
      (fn.isFunctionExpression() || fn.isArrowFunctionExpression()) &&
      fn.parentPath?.isVariableDeclarator() &&
      t.isIdentifier(fn.parentPath.node.id)
    ) {
      const name = fn.parentPath.node.id.name;
      const kind = fn.isArrowFunctionExpression() ? "arrow" : "function";
      const id = `${kind === "arrow" ? "arrow" : "fn"}:${name}:L${fn.parentPath.node.loc?.start.line ?? 0}`;
      return nameToId.get(name) ?? id;
    }
    if (fn.isClassMethod() || fn.isClassPrivateMethod()) {
      const cls = fn.findParent((p) => p.isClassDeclaration());
      let className = "?";
      if (cls?.isClassDeclaration() && cls.node.id) className = cls.node.id.name;
      let methodName = "method";
      const key = fn.node.key;
      if (fn.node.kind === "constructor") methodName = "constructor";
      else if (t.isIdentifier(key)) methodName = key.name;
      else if (t.isStringLiteral(key)) methodName = key.value;
      const mid = `method:${className}.${methodName}:L${fn.node.loc?.start.line ?? 0}`;
      return nameToId.get(`${className}.${methodName}`) ?? nameToId.get(methodName) ?? mid;
    }
    return MODULE_ID;
  }

  // Pass 1: declarations (functions, classes, methods, arrows)
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!path.node.id) return;
      // Skip if nested walk will also hit — we want all
      const name = path.node.id.name;
      const id = `fn:${name}:L${path.node.loc?.start.line ?? 0}`;
      const outerScope = enclosingScopeId(path);

      nameToId.set(name, id);
      addNode({
        id,
        kind: "function",
        label: name,
        params: paramNames(path.node.params),
        returnsLabel: simpleReturnLabel(path.node.body),
        loc: locOf(path.node),
        parentId: outerScope === MODULE_ID ? MODULE_ID : outerScope,
        scopeId: outerScope,
        expandable: true,
      });
    },

    ClassDeclaration(path) {
      if (!path.node.id) return;
      const name = path.node.id.name;
      const classId = `class:${name}:L${path.node.loc?.start.line ?? 0}`;
      const outerScope = path.parentPath ? enclosingScopeId(path.parentPath) : MODULE_ID;
      nameToId.set(name, classId);

      let extendsLabel: string | undefined;
      const superClass = path.node.superClass;
      if (superClass) {
        if (t.isIdentifier(superClass)) extendsLabel = superClass.name;
        else if (t.isMemberExpression(superClass) && t.isIdentifier(superClass.property)) {
          extendsLabel = superClass.property.name;
        } else {
          extendsLabel = "…";
        }
      }

      addNode({
        id: classId,
        kind: "class",
        label: name,
        params: [],
        extends: extendsLabel,
        loc: locOf(path.node),
        parentId: MODULE_ID,
        scopeId: outerScope,
        expandable: true,
      });

      let stackOrder = 0;
      for (const member of path.node.body.body) {
        if (!t.isClassMethod(member) && !t.isClassPrivateMethod(member)) continue;

        let methodName = "method";
        if (member.kind === "constructor") methodName = "constructor";
        else if (t.isIdentifier(member.key)) methodName = member.key.name;
        else if (t.isStringLiteral(member.key)) methodName = member.key.value;
        else if (t.isPrivateName(member.key) && t.isIdentifier(member.key.id)) {
          methodName = `#${member.key.id.name}`;
        }

        const memberKind: MemberKind =
          member.kind === "constructor"
            ? "constructor"
            : member.kind === "get"
              ? "get"
              : member.kind === "set"
                ? "set"
                : "method";

        const mid = `method:${name}.${methodName}:L${member.loc?.start.line ?? 0}`;
        nameToId.set(`${name}.${methodName}`, mid);
        nameToId.set(methodName, mid);
        addNode({
          id: mid,
          kind: "method",
          label: methodName,
          params: paramNames(member.params),
          returnsLabel: t.isBlockStatement(member.body)
            ? simpleReturnLabel(member.body)
            : undefined,
          loc: locOf(member),
          parentId: classId,
          scopeId: classId,
          stackOrder: stackOrder++,
          memberKind,
          expandable: true,
        });
      }
    },

    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id)) return;
      const init = path.node.init;
      const name = path.node.id.name;
      const outerScope = path.parentPath ? enclosingScopeId(path.parentPath) : MODULE_ID;
      const line = path.node.loc?.start.line ?? 0;

      if (init && (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))) {
        const kind = t.isArrowFunctionExpression(init) ? "arrow" : "function";
        const id = `${kind === "arrow" ? "arrow" : "fn"}:${name}:L${line}`;
        nameToId.set(name, id);
        addNode({
          id,
          kind,
          label: name,
          params: paramNames(init.params),
          returnsLabel: simpleReturnLabel(init.body),
          loc: locOf(path.node),
          parentId: outerScope === MODULE_ID ? MODULE_ID : outerScope,
          scopeId: outerScope,
          expandable: true,
        });
        return;
      }

      // Plain binding (const/let/var)
      const id = `binding:${name}:L${line}`;
      const bk = bindingKindOf(path);
      addNode({
        id,
        kind: "binding",
        label: name,
        params: [],
        bindingKind: bk,
        loc: locOf(path.node),
        scopeId: outerScope,
        parentId: outerScope === MODULE_ID ? undefined : outerScope,
      });
    },

    ImportDeclaration(path) {
      const source = path.node.source.value;
      for (const spec of path.node.specifiers) {
        let local = "";
        if (t.isImportDefaultSpecifier(spec) || t.isImportNamespaceSpecifier(spec)) {
          local = spec.local.name;
        } else if (t.isImportSpecifier(spec)) {
          local = spec.local.name;
        }
        if (!local) continue;
        const id = `import:${local}:L${path.node.loc?.start.line ?? 0}`;
        nameToId.set(local, id);
        addNode({
          id,
          kind: "import",
          label: local,
          params: [],
          loc: locOf(path.node),
          parentId: MODULE_ID,
          scopeId: MODULE_ID,
          returnsLabel: source,
          importSource: source,
        });
      }
    },

    ExportNamedDeclaration(path) {
      if (path.node.declaration) return;
      for (const spec of path.node.specifiers) {
        if (!t.isExportSpecifier(spec) || !t.isIdentifier(spec.exported)) continue;
        const name = spec.exported.name;
        const id = `export:${name}:L${spec.loc?.start.line ?? 0}`;
        addNode({
          id,
          kind: "export",
          label: name,
          params: [],
          loc: locOf(spec),
          parentId: MODULE_ID,
          scopeId: MODULE_ID,
        });
        const localName = t.isIdentifier(spec.local) ? spec.local.name : name;
        const target = nameToId.get(localName);
        if (target) {
          addEdge("returns", target, id, "export", {
            sourceHandle: "out",
            targetHandle: "in",
          });
        }
      }
    },

    ExportDefaultDeclaration(path) {
      const id = `export:default:L${path.node.loc?.start.line ?? 0}`;
      addNode({
        id,
        kind: "export",
        label: "default",
        params: [],
        loc: locOf(path.node),
        parentId: MODULE_ID,
        scopeId: MODULE_ID,
      });
      const decl = path.node.declaration;
      if (t.isIdentifier(decl)) {
        const target = nameToId.get(decl.name);
        if (target) {
          addEdge("returns", target, id, "default", {
            sourceHandle: "out",
            targetHandle: "in",
          });
        }
      } else if (t.isFunctionDeclaration(decl) && decl.id) {
        const target = nameToId.get(decl.id.name);
        if (target) {
          addEdge("returns", target, id, "default", {
            sourceHandle: "out",
            targetHandle: "in",
          });
        }
      }
    },
  });

  // Rebuild nameToId preferring function/method/import over bindings
  nameToId.clear();
  for (const n of nodes) {
    if (n.kind === "function" || n.kind === "arrow" || n.kind === "import" || n.kind === "external") {
      nameToId.set(n.label, n.id);
    }
    if (n.kind === "method") {
      const full = n.id.replace(/^method:/, "").replace(/:L\d+$/, "");
      nameToId.set(full, n.id);
      nameToId.set(n.label, n.id);
    }
    if (n.kind === "class") {
      nameToId.set(n.label, n.id);
    }
  }
  for (const n of nodes) {
    if (n.kind === "binding" && n.scopeId) {
      bindingIds.set(`${n.scopeId}::${n.label}`, n.id);
    }
  }

  // Class extends → superclass definition (same `ref` kind as call → def).
  for (const n of nodes) {
    if (n.kind !== "class" || !n.extends || n.extends === "…") continue;
    const superId = nameToId.get(n.extends);
    if (!superId || superId === n.id) continue;
    const superNode = nodes.find((x) => x.id === superId);
    if (superNode?.kind !== "class") continue;
    n.refId = superId;
    addEdge("ref", n.id, superId, "extends", {
      sourceHandle: "ref",
      targetHandle: "ref",
    });
  }

  function resolveCallee(
    callee: t.Expression
  ): { id?: string; label: string } | undefined {
    if (t.isIdentifier(callee)) {
      const known = nameToId.get(callee.name);
      if (known) return { id: known, label: callee.name };
      // Free function name with no local binding — keep as external.
      return { id: ensureExternal(callee.name), label: callee.name };
    }
    if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
      const prop = callee.property.name;
      // Member calls (name.trim, value.toUpperCase, this.say) are methods on a
      // receiver — only link when we know that method in-graph; never invent globals.
      if (t.isIdentifier(callee.object)) {
        const q = `${callee.object.name}.${prop}`;
        const known = nameToId.get(q);
        if (known) return { id: known, label: prop };
        return { label: prop };
      }
      if (t.isThisExpression(callee.object)) {
        const known = nameToId.get(prop);
        const node = known ? nodes.find((n) => n.id === known) : undefined;
        if (node?.kind === "method") return { id: known, label: prop };
        return { label: prop };
      }
      // Nested receiver: name.trim().toUpperCase() — property only, no global.
      return { label: prop };
    }
    if (t.isNewExpression(callee as unknown as t.NewExpression)) {
      return undefined;
    }
    return undefined;
  }

  function resolveCalleeFromNode(
    callee: t.Expression | t.V8IntrinsicIdentifier | t.Super
  ): { id?: string; label: string } | undefined {
    if (!t.isExpression(callee)) return undefined;
    return resolveCallee(callee);
  }

  // Pass 2: call sites as distinct blocks + threads from bindings / params
  const callIdByNode = new Map<object, string>();

  function threadIntoThis(
    callId: string,
    object: t.Expression,
    scopeId: string,
    scopeNode: GraphNode | undefined
  ) {
    if (t.isIdentifier(object)) {
      const objName = object.name;
      const bId =
        bindingIds.get(`${scopeId}::${objName}`) ??
        bindingIds.get(`${MODULE_ID}::${objName}`);
      if (bId) {
        addEdge("thread", bId, callId, objName, {
          sourceHandle: "out",
          targetHandle: "this",
        });
        return;
      }
      const paramIndex = scopeNode?.params.indexOf(objName) ?? -1;
      if (paramIndex >= 0 && scopeNode) {
        addEdge("thread", scopeId, callId, objName, {
          sourceHandle: `param:${paramIndex}`,
          targetHandle: "this",
        });
      }
      return;
    }
    if (t.isCallExpression(object) || t.isNewExpression(object)) {
      const innerId = callIdByNode.get(object);
      if (innerId) {
        addEdge("thread", innerId, callId, "this", {
          sourceHandle: "out",
          targetHandle: "this",
        });
      }
    }
  }

  function threadReturnValue(scopeId: string, arg: t.Expression | null | undefined) {
    if (!arg || scopeId === MODULE_ID) return;
    if (t.isIdentifier(arg)) {
      const bId =
        bindingIds.get(`${scopeId}::${arg.name}`) ??
        bindingIds.get(`${MODULE_ID}::${arg.name}`);
      if (bId) {
        addEdge("thread", bId, scopeId, "return", {
          sourceHandle: "out",
          targetHandle: "return",
        });
      }
      return;
    }
    if (t.isCallExpression(arg) || t.isNewExpression(arg)) {
      const callId = callIdByNode.get(arg);
      if (callId) {
        addEdge("thread", callId, scopeId, "return", {
          sourceHandle: "out",
          targetHandle: "return",
        });
      }
      return;
    }
    if (isInlineExpression(arg)) {
      const exprId = ensureExpression(arg, scopeId);
      if (exprId) {
        addEdge("thread", exprId, scopeId, "return", {
          sourceHandle: "out",
          targetHandle: "return",
        });
      }
    }
  }

  const exprIdByNode = new Map<object, string>();

  function threadIntoExprInput(
    exprId: string,
    inputIndex: number,
    input: ExprInput,
    scopeId: string,
    scopeNode: GraphNode | undefined
  ) {
    const targetHandle = `in:${inputIndex}`;
    if (input.kind === "call") {
      const callId = callIdByNode.get(input.node);
      if (callId) {
        addEdge("thread", callId, exprId, input.label, {
          sourceHandle: "out",
          targetHandle,
        });
      }
      return;
    }
    const bId =
      bindingIds.get(`${scopeId}::${input.name}`) ??
      bindingIds.get(`${MODULE_ID}::${input.name}`);
    if (bId) {
      addEdge("thread", bId, exprId, input.name, {
        sourceHandle: "out",
        targetHandle,
      });
      return;
    }
    const paramIndex = scopeNode?.params.indexOf(input.name) ?? -1;
    if (paramIndex >= 0 && scopeNode) {
      addEdge("thread", scopeId, exprId, input.name, {
        sourceHandle: `param:${paramIndex}`,
        targetHandle,
      });
    }
  }

  function ensureExpression(expr: t.Expression, scopeId: string): string | undefined {
    const existing = exprIdByNode.get(expr);
    if (existing) return existing;

    exprSeq += 1;
    const line = expr.loc?.start.line ?? 0;
    const col = expr.loc?.start.column ?? 0;
    const exprId = `expr:L${line}:C${col}:${exprSeq}`;
    exprIdByNode.set(expr, exprId);

    const inputs = collectExprInputs(expr);
    const scopeNode = nodes.find((n) => n.id === scopeId);

    addNode({
      id: exprId,
      kind: "expression",
      label: sourceSlice(expr, code),
      params: inputs.map((i) => (i.kind === "id" ? i.name : i.label)),
      loc: locOf(expr),
      scopeId,
      parentId: scopeId === MODULE_ID ? undefined : scopeId,
    });

    inputs.forEach((input, i) => {
      threadIntoExprInput(exprId, i, input, scopeId, scopeNode);
    });

    return exprId;
  }

  /** Feed a value expression into a binding/property `in` handle (like const init). */
  function threadCallArgument(
    callId: string,
    arg: t.CallExpression["arguments"][number],
    argIndex: number,
    scopeId: string
  ) {
    if (t.isSpreadElement(arg)) return;
    const targetHandle = `param:${argIndex}`;
    const scopeNode = nodes.find((n) => n.id === scopeId);

    if (t.isIdentifier(arg)) {
      const bId =
        bindingIds.get(`${scopeId}::${arg.name}`) ??
        bindingIds.get(`${MODULE_ID}::${arg.name}`);
      if (bId) {
        addEdge("thread", bId, callId, arg.name, {
          sourceHandle: "out",
          targetHandle,
        });
        return;
      }
      const paramIndex = scopeNode?.params.indexOf(arg.name) ?? -1;
      if (paramIndex >= 0 && scopeNode) {
        addEdge("thread", scopeId, callId, arg.name, {
          sourceHandle: `param:${paramIndex}`,
          targetHandle,
        });
      }
      return;
    }

    if (t.isCallExpression(arg) || t.isNewExpression(arg)) {
      const innerId = callIdByNode.get(arg);
      if (innerId) {
        addEdge("thread", innerId, callId, "arg", {
          sourceHandle: "out",
          targetHandle,
        });
      }
      return;
    }

    if (t.isExpression(arg) && isInlineExpression(arg)) {
      const exprId = ensureExpression(arg, scopeId);
      if (exprId) {
        addEdge("thread", exprId, callId, sourceSlice(arg, code), {
          sourceHandle: "out",
          targetHandle,
        });
      }
    }
  }

  /** Feed a value expression into a binding/property `in` handle (like const init). */
  function threadIntoBinding(targetId: string, expr: t.Expression, scopeId: string) {
    const scopeNode = nodes.find((n) => n.id === scopeId);
    if (t.isIdentifier(expr)) {
      const src =
        bindingIds.get(`${scopeId}::${expr.name}`) ??
        bindingIds.get(`${MODULE_ID}::${expr.name}`);
      if (src) {
        addEdge("thread", src, targetId, "assign", {
          sourceHandle: "out",
          targetHandle: "in",
        });
        return;
      }
      const paramIndex = scopeNode?.params.indexOf(expr.name) ?? -1;
      if (paramIndex >= 0 && scopeNode) {
        addEdge("thread", scopeId, targetId, expr.name, {
          sourceHandle: `param:${paramIndex}`,
          targetHandle: "in",
        });
      }
      return;
    }
    if (t.isCallExpression(expr) || t.isNewExpression(expr)) {
      const callId = callIdByNode.get(expr);
      if (callId) {
        addEdge("thread", callId, targetId, "assign", {
          sourceHandle: "out",
          targetHandle: "in",
        });
      }
      return;
    }
    if (isInlineExpression(expr)) {
      const exprId = ensureExpression(expr, scopeId);
      if (exprId) {
        addEdge("thread", exprId, targetId, "assign", {
          sourceHandle: "out",
          targetHandle: "in",
        });
      }
    }
  }

  traverse(ast, {
    CallExpression: {
      enter(path) {
        const scopeId = enclosingScopeId(path);
        const calleeExpr = path.node.callee;
        let memberCallee: t.MemberExpression | undefined;
        let methodName: string | undefined;
        if (
          t.isMemberExpression(calleeExpr) &&
          !calleeExpr.computed &&
          t.isIdentifier(calleeExpr.property)
        ) {
          memberCallee = calleeExpr;
          methodName = calleeExpr.property.name;
        }
        const isMethod = memberCallee != null;

        const resolved = resolveCalleeFromNode(path.node.callee);
        // Member calls still get a block even with no in-graph definition.
        if (!resolved && !isMethod) return;
        const callLabel = methodName
          ? `${methodName}()`
          : `${resolved!.label}()`;

        callSeq += 1;
        const line = path.node.loc?.start.line ?? 0;
        const col = path.node.loc?.start.column ?? 0;
        const callKey = methodName ?? resolved!.label;
        const callId = `call:${callKey}:L${line}:C${col}:${callSeq}`;
        callIdByNode.set(path.node, callId);

        const calleeNode = resolved?.id
          ? nodes.find((n) => n.id === resolved.id)
          : undefined;
        let callParams =
          calleeNode && calleeNode.params.length > 0
            ? [...calleeNode.params]
            : path.node.arguments.map((_, i) => `arg${i}`);
        // Constructor via class id → use constructor method params
        if (calleeNode?.kind === "class") {
          const ctor = nodes.find(
            (n) =>
              n.kind === "method" &&
              n.parentId === calleeNode.id &&
              n.memberKind === "constructor"
          );
          if (ctor) callParams = [...ctor.params];
        }

        let receiver: string | undefined;
        if (memberCallee && t.isThisExpression(memberCallee.object)) {
          receiver = "this";
        } else if (memberCallee && t.isIdentifier(memberCallee.object)) {
          receiver = memberCallee.object.name;
        }

        addNode({
          id: callId,
          kind: "call",
          label: callLabel,
          params: callParams,
          loc: locOf(path.node),
          scopeId,
          refId: resolved?.id,
          parentId: scopeId === MODULE_ID ? undefined : scopeId,
          receiver,
          hasThis: Boolean(isMethod),
        });

        // Call top → declaration bottom (only when we know the definition)
        if (resolved?.id) {
          addEdge("ref", callId, resolved.id, "def", {
            sourceHandle: "ref",
            targetHandle: "ref",
          });
          const def = nodes.find((n) => n.id === resolved.id);
          if (def?.kind === "import") {
            addEdge("thread", resolved.id, callId, def.label, {
              sourceHandle: "out",
              targetHandle: "in",
            });
          }
        }

        const scopeNode = nodes.find((n) => n.id === scopeId);

        // Identifier receivers can wire immediately; call-chain this waits for exit
        if (memberCallee && t.isIdentifier(memberCallee.object)) {
          threadIntoThis(callId, memberCallee.object, scopeId, scopeNode);
        }

        // const x = fn() → call output → binding
        if (
          path.parentPath?.isVariableDeclarator() &&
          t.isIdentifier(path.parentPath.node.id)
        ) {
          const bName = path.parentPath.node.id.name;
          const bId =
            bindingIds.get(`${scopeId}::${bName}`) ??
            bindingIds.get(`${MODULE_ID}::${bName}`);
          if (bId) {
            addEdge("thread", callId, bId, "assign", {
              sourceHandle: "out",
              targetHandle: "in",
            });
          }
        }
      },
      exit(path) {
        const callId = callIdByNode.get(path.node);
        if (!callId) return;
        const scopeId = enclosingScopeId(path);
        path.node.arguments.forEach((arg, argIndex) => {
          threadCallArgument(callId, arg, argIndex, scopeId);
        });
        const calleeExpr = path.node.callee;
        if (
          !t.isExpression(calleeExpr) ||
          !t.isMemberExpression(calleeExpr) ||
          calleeExpr.computed ||
          !t.isExpression(calleeExpr.object)
        ) {
          return;
        }
        // Nested call/new as receiver — available after children visited
        if (
          t.isCallExpression(calleeExpr.object) ||
          t.isNewExpression(calleeExpr.object)
        ) {
          const scopeNode = nodes.find((n) => n.id === scopeId);
          threadIntoThis(callId, calleeExpr.object, scopeId, scopeNode);
        }
      },
    },

    NewExpression: {
      enter(path) {
        const scopeId = enclosingScopeId(path);
        const callee = path.node.callee;
        let resolved: { id?: string; label: string } | undefined;
        if (t.isIdentifier(callee)) {
          const known = nameToId.get(callee.name);
          resolved = known
            ? { id: known, label: callee.name }
            : { id: ensureExternal(callee.name), label: callee.name };
        } else if (t.isExpression(callee)) {
          resolved = resolveCallee(callee);
        }
        if (!resolved) return;

        callSeq += 1;
        const line = path.node.loc?.start.line ?? 0;
        const col = path.node.loc?.start.column ?? 0;
        const callId = `call:new ${resolved.label}:L${line}:C${col}:${callSeq}`;
        callIdByNode.set(path.node, callId);

        const calleeNode = resolved.id
          ? nodes.find((n) => n.id === resolved.id)
          : undefined;
        let callParams =
          calleeNode && calleeNode.params.length > 0
            ? [...calleeNode.params]
            : path.node.arguments.map((_, i) => `arg${i}`);
        if (calleeNode?.kind === "class") {
          const ctor = nodes.find(
            (n) =>
              n.kind === "method" &&
              n.parentId === calleeNode.id &&
              n.memberKind === "constructor"
          );
          if (ctor) callParams = [...ctor.params];
        }

        addNode({
          id: callId,
          kind: "call",
          label: `new ${resolved.label}()`,
          params: callParams,
          loc: locOf(path.node),
          scopeId,
          refId: resolved.id,
          parentId: scopeId === MODULE_ID ? undefined : scopeId,
        });
        if (resolved.id) {
          addEdge("ref", callId, resolved.id, "def", {
            sourceHandle: "ref",
            targetHandle: "ref",
          });
        }

        if (
          path.parentPath?.isVariableDeclarator() &&
          t.isIdentifier(path.parentPath.node.id)
        ) {
          const bName = path.parentPath.node.id.name;
          const bId =
            bindingIds.get(`${scopeId}::${bName}`) ??
            bindingIds.get(`${MODULE_ID}::${bName}`);
          if (bId) {
            addEdge("thread", callId, bId, "assign", {
              sourceHandle: "out",
              targetHandle: "in",
            });
          }
        }
      },
      exit(path) {
        const callId = callIdByNode.get(path.node);
        if (!callId) return;
        const scopeId = enclosingScopeId(path);
        path.node.arguments.forEach((arg, argIndex) => {
          threadCallArgument(callId, arg, argIndex, scopeId);
        });
      },
    },

    VariableDeclarator: {
      exit(path) {
        if (!t.isIdentifier(path.node.id) || !path.node.init) return;
        if (
          t.isFunctionExpression(path.node.init) ||
          t.isArrowFunctionExpression(path.node.init)
        ) {
          return;
        }
        if (t.isCallExpression(path.node.init) || t.isNewExpression(path.node.init)) return;
        const scopeId = path.parentPath ? enclosingScopeId(path.parentPath) : MODULE_ID;
        const bId = bindingIds.get(`${scopeId}::${path.node.id.name}`);
        if (!bId) return;
        threadIntoBinding(bId, path.node.init, scopeId);
      },
    },

    /**
     * Member writes as binding-like property slots (this.x / obj.x),
     * with RHS threaded into `in` like const/let inits.
     */
    AssignmentExpression: {
      exit(path) {
        if (!path.parentPath?.isExpressionStatement()) return;
        const scopeId = enclosingScopeId(path);
        const left = path.node.left;
        const right = path.node.right;

        if (
          t.isMemberExpression(left) &&
          !left.computed &&
          t.isIdentifier(left.property)
        ) {
          const prop = left.property.name;
          let receiver: string | undefined;
          let hasThis = false;
          if (t.isThisExpression(left.object)) {
            receiver = "this";
            hasThis = true;
          } else if (t.isIdentifier(left.object)) {
            receiver = left.object.name;
          } else {
            // Complex LHS — keep as a single expression block.
            ensureExpression(path.node, scopeId);
            return;
          }

          propSeq += 1;
          const line = path.node.loc?.start.line ?? 0;
          const col = path.node.loc?.start.column ?? 0;
          const propId = `prop:${receiver}.${prop}:L${line}:C${col}:${propSeq}`;
          addNode({
            id: propId,
            kind: "binding",
            label: prop,
            params: [],
            bindingKind: "prop",
            loc: locOf(path.node),
            scopeId,
            parentId: scopeId === MODULE_ID ? undefined : scopeId,
            receiver,
            hasThis,
          });
          threadIntoBinding(propId, right, scopeId);
          return;
        }

        // Plain identifier reassignment: feed existing binding if we know it.
        if (t.isIdentifier(left)) {
          const bId =
            bindingIds.get(`${scopeId}::${left.name}`) ??
            bindingIds.get(`${MODULE_ID}::${left.name}`);
          if (bId) {
            threadIntoBinding(bId, right, scopeId);
            return;
          }
        }

        ensureExpression(path.node, scopeId);
      },
    },

    ReturnStatement: {
      exit(path) {
        const scopeId = enclosingScopeId(path);
        threadReturnValue(scopeId, path.node.argument ?? undefined);
      },
    },

    /** Expression-bodied arrows: treat body like an implicit return. */
    ArrowFunctionExpression: {
      exit(path) {
        if (t.isBlockStatement(path.node.body)) return;
        let scopeId: string | undefined;
        if (path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)) {
          scopeId = nameToId.get(path.parentPath.node.id.name);
        }
        if (!scopeId) {
          const arrow = nodes.find(
            (n) =>
              n.kind === "arrow" &&
              n.loc?.startLine === path.node.loc?.start.line &&
              n.loc?.startCol === path.node.loc?.start.column
          );
          scopeId = arrow?.id;
        }
        if (!scopeId) return;
        threadReturnValue(scopeId, path.node.body);
      },
    },
  });

  // Worker-flow: sequential processing order within each scope (and class method stacks).
  function chainFlow(ordered: GraphNode[]) {
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i]!;
      const b = ordered[i + 1]!;
      addEdge("flow", a.id, b.id, "flow", {
        sourceHandle: "flow-out",
        targetHandle: "flow-in",
      });
    }
  }

  const byScope = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind === "module" || n.kind === "external") continue;
    // Rails sit on the module frame border — not part of worker-flow order.
    if (n.kind === "import" || n.kind === "export") continue;
    // Class methods get their own chain below (stack order), not module body order.
    if (n.kind === "method" && n.parentId?.startsWith("class:")) continue;
    const scope = n.scopeId ?? MODULE_ID;
    const list = byScope.get(scope) ?? [];
    list.push(n);
    byScope.set(scope, list);
  }
  for (const [scope, list] of byScope) {
    const ordered = orderByExecution(list, edges);
    const scopeNode = nodes.find((n) => n.id === scope);
    const hasWell = !!scopeNode?.expandable;

    if (hasWell && ordered.length > 0) {
      // Inner window: well entry → members → well exit
      addEdge("flow", scope, ordered[0]!.id, "flow", {
        sourceHandle: "flow-well-in",
        targetHandle: "flow-in",
      });
      chainFlow(ordered);
      addEdge("flow", ordered[ordered.length - 1]!.id, scope, "flow", {
        sourceHandle: "flow-out",
        targetHandle: "flow-well-out",
      });
    } else {
      chainFlow(ordered);
    }
  }

  const methodsByClass = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind !== "method" || !n.parentId?.startsWith("class:")) continue;
    const list = methodsByClass.get(n.parentId) ?? [];
    list.push(n);
    methodsByClass.set(n.parentId, list);
  }
  for (const [classId, list] of methodsByClass) {
    const ordered = [...list].sort(
      (a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0) || locKey(a) - locKey(b)
    );
    const classNode = nodes.find((n) => n.id === classId);
    if (classNode?.expandable && ordered.length > 0) {
      addEdge("flow", classId, ordered[0]!.id, "flow", {
        sourceHandle: "flow-well-in",
        targetHandle: "flow-in",
      });
      chainFlow(ordered);
      addEdge("flow", ordered[ordered.length - 1]!.id, classId, "flow", {
        sourceHandle: "flow-out",
        targetHandle: "flow-well-out",
      });
    } else {
      chainFlow(ordered);
    }
  }

  return {
    ok: true,
    graph: {
      nodes,
      edges,
      fileName,
    },
  };
}
