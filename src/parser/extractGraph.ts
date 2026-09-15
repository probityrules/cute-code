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
  ValueType,
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

/** Flatten pattern / param trees into bound identifier names (for params display). */
function flattenBoundNames(node: t.Node | null | undefined): string[] {
  if (!node) return [];
  if (t.isIdentifier(node)) return [node.name];
  if (t.isRestElement(node)) {
    const inner = flattenBoundNames(node.argument);
    return inner.map((n) => (n.startsWith("...") ? n : `...${n}`));
  }
  if (t.isAssignmentPattern(node)) return flattenBoundNames(node.left);
  if (t.isTSParameterProperty(node)) return flattenBoundNames(node.parameter);
  if (t.isObjectPattern(node)) {
    const names: string[] = [];
    for (const prop of node.properties) {
      if (t.isRestElement(prop)) names.push(...flattenBoundNames(prop));
      else if (t.isObjectProperty(prop)) names.push(...flattenBoundNames(prop.value as t.Node));
    }
    return names;
  }
  if (t.isArrayPattern(node)) {
    const names: string[] = [];
    for (const el of node.elements) {
      if (el) names.push(...flattenBoundNames(el));
    }
    return names;
  }
  return [];
}

function paramNames(
  params: (t.Identifier | t.Pattern | t.RestElement | t.TSParameterProperty)[]
): string[] {
  const names: string[] = [];
  for (const p of params) {
    const flat = flattenBoundNames(p);
    if (flat.length > 0) names.push(...flat);
    else if (t.isObjectPattern(p)) names.push("{…}");
    else if (t.isArrayPattern(p)) names.push("[…]");
    else names.push("?");
  }
  return names;
}

type PatternSlot = { name: string; pathLabel: string };

/** Flatten ObjectPattern / ArrayPattern into named slots with dotted path labels. */
function flattenPatternSlots(
  pattern: t.LVal | t.Pattern,
  pathPrefix = ""
): PatternSlot[] {
  const slots: PatternSlot[] = [];

  function walk(node: t.Node | null | undefined, prefix: string) {
    if (!node) return;
    if (t.isIdentifier(node)) {
      slots.push({ name: node.name, pathLabel: prefix || node.name });
      return;
    }
    if (t.isAssignmentPattern(node)) {
      walk(node.left, prefix);
      return;
    }
    if (t.isRestElement(node)) {
      if (t.isIdentifier(node.argument)) {
        const n = node.argument.name;
        slots.push({ name: n, pathLabel: prefix ? `${prefix}...${n}` : `...${n}` });
      } else {
        walk(node.argument, prefix ? `${prefix}...` : "...");
      }
      return;
    }
    if (t.isObjectPattern(node)) {
      for (const prop of node.properties) {
        if (t.isRestElement(prop)) {
          walk(prop, prefix);
          continue;
        }
        if (!t.isObjectProperty(prop)) continue;
        let keyLabel = "?";
        if (!prop.computed && t.isIdentifier(prop.key)) keyLabel = prop.key.name;
        else if (t.isStringLiteral(prop.key)) keyLabel = prop.key.value;
        const next = prefix ? `${prefix}.${keyLabel}` : keyLabel;
        walk(prop.value as t.Node, next);
      }
      return;
    }
    if (t.isArrayPattern(node)) {
      node.elements.forEach((el, i) => {
        if (!el) return;
        const next = prefix ? `${prefix}.${i}` : String(i);
        walk(el, next);
      });
    }
  }

  walk(pattern, pathPrefix);
  return slots;
}

function patternLabel(id: t.LVal, code: string): string {
  const slice = sourceSlice(id, code);
  if (slice && slice !== "…") return slice;
  if (t.isObjectPattern(id)) return "{…}";
  if (t.isArrayPattern(id)) return "[…]";
  return "…";
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

/** Best-effort value kind from an initializer expression (for binding icons). */
function inferValueType(init: t.Expression | null | undefined): ValueType {
  if (!init) return "undefined";
  if (t.isStringLiteral(init) || t.isTemplateLiteral(init) || t.isTaggedTemplateExpression(init)) {
    return "string";
  }
  if (t.isNumericLiteral(init) || t.isBigIntLiteral(init)) return "number";
  if (t.isBooleanLiteral(init)) return "boolean";
  if (t.isNullLiteral(init)) return "null";
  if (t.isIdentifier(init) && init.name === "undefined") return "undefined";
  if (t.isArrayExpression(init)) return "array";
  if (t.isObjectExpression(init) || t.isRegExpLiteral(init)) return "object";
  if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) return "function";
  if (t.isClassExpression(init)) return "class";
  if (t.isNewExpression(init)) return "instance";
  return "unknown";
}

function instanceOfFromInit(init: t.Expression | null | undefined): string | undefined {
  if (!init || !t.isNewExpression(init)) return undefined;
  const callee = init.callee;
  if (t.isIdentifier(callee)) return callee.name;
  if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    !callee.computed &&
    t.isIdentifier(callee.property)
  ) {
    return callee.property.name;
  }
  return undefined;
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
    t.isBigIntLiteral(node) ||
    t.isAwaitExpression(node) ||
    t.isYieldExpression(node)
  );
}

function sourceSlice(node: t.Node, code: string): string {
  if (typeof node.start === "number" && typeof node.end === "number") {
    return code.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  }
  return "…";
}

function jsxNameOf(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  // Member: Foo.Bar
  const parts: string[] = [];
  let cur: t.JSXIdentifier | t.JSXMemberExpression = name;
  while (t.isJSXMemberExpression(cur)) {
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  if (t.isJSXIdentifier(cur)) parts.unshift(cur.name);
  return parts.join(".") || "JSX";
}

function jsxRootIdentifier(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName
): string | undefined {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    let cur: t.JSXIdentifier | t.JSXMemberExpression = name;
    while (t.isJSXMemberExpression(cur)) cur = cur.object;
    return t.isJSXIdentifier(cur) ? cur.name : undefined;
  }
  return undefined;
}

type ExprInput =
  | { kind: "id"; name: string }
  | { kind: "call"; node: t.CallExpression | t.NewExpression | t.OptionalCallExpression; label: string };

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
        (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
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

    if (t.isCallExpression(node) || t.isNewExpression(node) || t.isOptionalCallExpression(node)) {
      if (!seenCalls.has(node)) {
        seenCalls.add(node);
        let label = "()";
        if (t.isNewExpression(node) && t.isIdentifier(node.callee)) {
          label = `new ${node.callee.name}()`;
        } else if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
          const callee = node.callee;
          if (t.isIdentifier(callee)) label = `${callee.name}()`;
          else if (
            (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
            t.isIdentifier(callee.property)
          ) {
            label = `${callee.property.name}()`;
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

function isCallLike(
  node: t.Node
): node is t.CallExpression | t.NewExpression | t.OptionalCallExpression | t.ImportExpression {
  return (
    t.isCallExpression(node) ||
    t.isNewExpression(node) ||
    t.isOptionalCallExpression(node) ||
    t.isImportExpression(node)
  );
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
  /** AST node → expandable scope id (branch/loop/try/jsx/fragment) */
  const scopeIdByAst = new WeakMap<object, string>();
  /** Deferred export rails created after decls exist */
  const pendingExports: {
    name: string;
    line: number;
    localName: string;
    label?: string;
  }[] = [];
  /** Class field inits to thread in pass 2 */
  const pendingFieldInits: { propId: string; init: t.Expression; scopeId: string }[] = [];
  let edgeSeq = 0;
  let callSeq = 0;
  let exprSeq = 0;
  let propSeq = 0;
  let controlSeq = 0;
  let jsxSeq = 0;

  nodes.push({
    id: MODULE_ID,
    kind: "module",
    label: fileName ? fileName.split(/[/\\]/).pop()! : "module",
    params: [],
    loc: locOf(ast.program),
    scopeId: MODULE_ID,
    /** Always-open file chrome: flow enters/exits the module well. */
    expandable: true,
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

  function pathUnder(region: NodePath | null | undefined, path: NodePath): boolean {
    if (!region || !region.node) return false;
    if (path.node === region.node) return true;
    return Boolean(path.findParent((p) => p.node === region.node));
  }

  function functionScopeId(fn: NodePath): string | undefined {
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
    return undefined;
  }

  function enclosingScopeId(path: NodePath): string {
    const scope = path.findParent((p) => {
      if (
        p.isFunctionDeclaration() ||
        p.isFunctionExpression() ||
        p.isArrowFunctionExpression() ||
        p.isClassMethod() ||
        p.isClassPrivateMethod()
      ) {
        return true;
      }
      if (!scopeIdByAst.has(p.node)) return false;

      if (p.isIfStatement()) {
        return (
          pathUnder(p.get("consequent") as NodePath, path) ||
          pathUnder(p.get("alternate") as NodePath | null, path)
        );
      }
      if (p.isSwitchStatement()) {
        for (const c of p.get("cases") as NodePath[]) {
          if (pathUnder(c, path)) return true;
        }
        return false;
      }
      if (
        p.isForStatement() ||
        p.isForOfStatement() ||
        p.isForInStatement() ||
        p.isWhileStatement() ||
        p.isDoWhileStatement()
      ) {
        return pathUnder(p.get("body") as NodePath, path);
      }
      if (p.isTryStatement()) {
        return (
          pathUnder(p.get("block") as NodePath, path) ||
          pathUnder(p.get("handler") as NodePath | null, path) ||
          pathUnder(p.get("finalizer") as NodePath | null, path)
        );
      }
      if (p.isJSXElement() || p.isJSXFragment()) {
        return pathUnder(p, path) && path.node !== p.node;
      }
      return true;
    });

    if (!scope) return MODULE_ID;

    const controlId = scopeIdByAst.get(scope.node);
    if (controlId) return controlId;

    return functionScopeId(scope) ?? MODULE_ID;
  }

  function registerBinding(scopeId: string, label: string, id: string) {
    bindingIds.set(`${scopeId}::${label}`, id);
  }

  // Pass 1: declarations (functions, classes, methods, arrows, control, jsx, module)
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!path.node.id) return;
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
        nameLoc: locOf(path.node.id),
        parentId: outerScope === MODULE_ID ? MODULE_ID : outerScope,
        scopeId: outerScope,
        expandable: true,
        async: path.node.async || undefined,
        generator: path.node.generator || undefined,
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
        nameLoc: locOf(path.node.id),
        parentId: MODULE_ID,
        scopeId: outerScope,
        expandable: true,
      });

      let stackOrder = 0;
      for (const member of path.node.body.body) {
        if (t.isClassMethod(member) || t.isClassPrivateMethod(member)) {
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
          let methodNameLoc: SourceLoc | undefined;
          if (t.isIdentifier(member.key) && !member.computed) {
            methodNameLoc = locOf(member.key);
          } else if (t.isPrivateName(member.key)) {
            methodNameLoc = locOf(member.key);
          }
          addNode({
            id: mid,
            kind: "method",
            label: methodName,
            params: paramNames(member.params),
            returnsLabel: t.isBlockStatement(member.body)
              ? simpleReturnLabel(member.body)
              : undefined,
            loc: locOf(member),
            nameLoc: methodNameLoc,
            parentId: classId,
            scopeId: classId,
            stackOrder: stackOrder++,
            memberKind,
            expandable: true,
            async: member.async || undefined,
            generator: member.generator || undefined,
            static: member.static || undefined,
          });
          continue;
        }

        if (t.isClassProperty(member) || t.isClassPrivateProperty(member)) {
          let propName = "prop";
          let propNameLoc: SourceLoc | undefined;
          if (t.isClassPrivateProperty(member) && t.isPrivateName(member.key)) {
            propName = `#${member.key.id.name}`;
            propNameLoc = locOf(member.key);
          } else if (t.isIdentifier(member.key) && !member.computed) {
            propName = member.key.name;
            propNameLoc = locOf(member.key);
          } else if (t.isStringLiteral(member.key)) {
            propName = member.key.value;
          } else if (t.isPrivateName(member.key) && t.isIdentifier(member.key.id)) {
            propName = `#${member.key.id.name}`;
            propNameLoc = locOf(member.key);
          }

          const line = member.loc?.start.line ?? 0;
          const propId = `prop:${name}.${propName}:L${line}:${stackOrder}`;
          addNode({
            id: propId,
            kind: "binding",
            label: propName,
            params: [],
            bindingKind: "prop",
            loc: locOf(member),
            nameLoc: propNameLoc,
            parentId: classId,
            scopeId: classId,
            stackOrder: stackOrder++,
            static: member.static || undefined,
          });
          registerBinding(classId, propName, propId);
          if (member.value && t.isExpression(member.value)) {
            pendingFieldInits.push({ propId, init: member.value, scopeId: classId });
          }
        }
      }
    },

    VariableDeclarator(path) {
      const init = path.node.init;
      const outerScope = path.parentPath ? enclosingScopeId(path.parentPath) : MODULE_ID;
      const line = path.node.loc?.start.line ?? 0;
      const bk = bindingKindOf(path);

      if (t.isIdentifier(path.node.id)) {
        const name = path.node.id.name;

        if (init && (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))) {
          const isArrow = t.isArrowFunctionExpression(init);
          const kind = isArrow ? "arrow" : "function";
          const fnId = `${isArrow ? "arrow" : "fn"}:${name}:L${line}`;
          const bindingId = `binding:${name}:L${line}`;
          nameToId.set(name, fnId);
          addNode({
            id: fnId,
            kind,
            label: isArrow ? "() => {}" : "function() {}",
            params: paramNames(init.params),
            returnsLabel: simpleReturnLabel(init.body),
            loc: locOf(init),
            parentId: outerScope === MODULE_ID ? MODULE_ID : outerScope,
            scopeId: outerScope,
            expandable: true,
            bindingName: name,
            async: init.async || undefined,
            generator: t.isFunctionExpression(init) ? init.generator || undefined : undefined,
          });
          addNode({
            id: bindingId,
            kind: "binding",
            label: name,
            params: [],
            bindingKind: bk,
            valueType: "function",
            loc: locOf(path.node),
            nameLoc: locOf(path.node.id),
            scopeId: outerScope,
            parentId: outerScope === MODULE_ID ? undefined : outerScope,
          });
          registerBinding(outerScope, name, bindingId);
          addEdge("thread", fnId, bindingId, "assign", {
            sourceHandle: "out",
            targetHandle: "in",
          });
          return;
        }

        const id = `binding:${name}:L${line}`;
        addNode({
          id,
          kind: "binding",
          label: name,
          params: [],
          bindingKind: bk,
          valueType: inferValueType(init ?? undefined),
          instanceOf: instanceOfFromInit(init ?? undefined),
          loc: locOf(path.node),
          nameLoc: locOf(path.node.id),
          scopeId: outerScope,
          parentId: outerScope === MODULE_ID ? undefined : outerScope,
        });
        registerBinding(outerScope, name, id);
        return;
      }

      // Destructuring: parent pattern + child slots
      if (t.isObjectPattern(path.node.id) || t.isArrayPattern(path.node.id)) {
        const slots = flattenPatternSlots(path.node.id);
        const label = patternLabel(path.node.id, code);
        const parentId = `binding:pattern:L${line}:C${path.node.loc?.start.column ?? 0}`;
        addNode({
          id: parentId,
          kind: "binding",
          label,
          params: slots.map((s) => s.name),
          bindingKind: bk,
          loc: locOf(path.node),
          scopeId: outerScope,
          parentId: outerScope === MODULE_ID ? undefined : outerScope,
          pattern: true,
        });

        for (const slot of slots) {
          const slotId = `binding:${slot.name}:L${line}:slot`;
          addNode({
            id: slotId,
            kind: "binding",
            label: slot.pathLabel.includes(".") ? slot.pathLabel : slot.name,
            params: [],
            bindingKind: bk,
            loc: locOf(path.node),
            scopeId: outerScope,
            parentId: parentId,
            slotOf: parentId,
          });
          registerBinding(outerScope, slot.name, slotId);
        }
      }
    },

    ImportDeclaration(path) {
      const source = path.node.source.value;
      if (path.node.specifiers.length === 0) {
        const id = `import:side:${source}:L${path.node.loc?.start.line ?? 0}`;
        addNode({
          id,
          kind: "import",
          label: JSON.stringify(source),
          params: [],
          loc: locOf(path.node),
          parentId: MODULE_ID,
          scopeId: MODULE_ID,
          returnsLabel: source,
          importSource: source,
        });
        return;
      }
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
          nameLoc: locOf(spec.local),
          parentId: MODULE_ID,
          scopeId: MODULE_ID,
          returnsLabel: source,
          importSource: source,
        });
      }
    },

    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        const decl = path.node.declaration;
        const line = path.node.loc?.start.line ?? 0;
        if (t.isFunctionDeclaration(decl) && decl.id) {
          pendingExports.push({ name: decl.id.name, line, localName: decl.id.name });
        } else if (t.isClassDeclaration(decl) && decl.id) {
          pendingExports.push({ name: decl.id.name, line, localName: decl.id.name });
        } else if (t.isVariableDeclaration(decl)) {
          for (const d of decl.declarations) {
            if (t.isIdentifier(d.id)) {
              pendingExports.push({
                name: d.id.name,
                line: d.loc?.start.line ?? line,
                localName: d.id.name,
              });
            } else if (t.isObjectPattern(d.id) || t.isArrayPattern(d.id)) {
              for (const slot of flattenPatternSlots(d.id)) {
                pendingExports.push({
                  name: slot.name,
                  line: d.loc?.start.line ?? line,
                  localName: slot.name,
                });
              }
            }
          }
        }
        return;
      }
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
          nameLoc: locOf(spec.exported),
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
        pendingExports.push({
          name: "default",
          line: path.node.loc?.start.line ?? 0,
          localName: decl.name,
          label: "default",
        });
      } else if (t.isFunctionDeclaration(decl) && decl.id) {
        pendingExports.push({
          name: "default",
          line: path.node.loc?.start.line ?? 0,
          localName: decl.id.name,
          label: "default",
        });
      } else if (t.isClassDeclaration(decl) && decl.id) {
        pendingExports.push({
          name: "default",
          line: path.node.loc?.start.line ?? 0,
          localName: decl.id.name,
          label: "default",
        });
      } else if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) {
        // anonymous default — rail already created
      }
      // Keep immediate link attempt for identifier (same as before) when already known
      if (t.isIdentifier(decl)) {
        const target = nameToId.get(decl.name);
        if (target) {
          addEdge("returns", target, id, "default", {
            sourceHandle: "out",
            targetHandle: "in",
          });
        }
      }
    },

    ExportAllDeclaration(path) {
      const source = path.node.source.value;
      const line = path.node.loc?.start.line ?? 0;
      const id = `export:star:${source}:L${line}`;
      addNode({
        id,
        kind: "export",
        label: `* from ${JSON.stringify(source)}`,
        params: [],
        loc: locOf(path.node),
        parentId: MODULE_ID,
        scopeId: MODULE_ID,
        importSource: source,
      });
    },

    IfStatement(path) {
      // Only create one node per if (skip else-if chains creating nested — each if gets a node)
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `branch:if:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "branch",
        label: "if",
        params: ["cond"],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        branchKind: "if",
      });
    },

    SwitchStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `branch:switch:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "branch",
        label: "switch",
        params: ["cond"],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        branchKind: "switch",
      });
    },

    ForStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `loop:for:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "loop",
        label: "for",
        params: [],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        loopKind: "for",
      });
    },

    ForOfStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `loop:for-of:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "loop",
        label: "for-of",
        params: [],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        loopKind: "for-of",
      });
    },

    ForInStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `loop:for-in:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "loop",
        label: "for-in",
        params: [],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        loopKind: "for-in",
      });
    },

    WhileStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `loop:while:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "loop",
        label: "while",
        params: ["cond"],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        loopKind: "while",
      });
    },

    DoWhileStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `loop:do:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "loop",
        label: "do-while",
        params: ["cond"],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
        loopKind: "do",
      });
    },

    TryStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `try:L${line}:${controlSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      addNode({
        id,
        kind: "try",
        label: "try",
        params: [],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: true,
      });
      const handler = path.node.handler;
      if (handler?.param) {
        const names = flattenBoundNames(handler.param);
        const catchName = names[0] ?? "err";
        const catchId = `binding:${catchName}:L${handler.loc?.start.line ?? line}`;
        addNode({
          id: catchId,
          kind: "binding",
          label: catchName,
          params: [],
          bindingKind: "let",
          loc: locOf(handler.param),
          nameLoc: t.isIdentifier(handler.param) ? locOf(handler.param) : undefined,
          scopeId: id,
          parentId: id,
        });
        registerBinding(id, catchName, catchId);
      }
    },

    ThrowStatement(path) {
      controlSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const id = `throw:L${line}:${controlSeq}`;
      const scopeId = enclosingScopeId(path);
      addNode({
        id,
        kind: "throw",
        label: "throw",
        params: path.node.argument && t.isIdentifier(path.node.argument)
          ? [path.node.argument.name]
          : ["value"],
        loc: locOf(path.node),
        scopeId,
        parentId: scopeId === MODULE_ID ? undefined : scopeId,
      });
    },

    JSXElement(path) {
      // Only top-level elements relative to nested JSX — visit all; nested get jsx scope
      jsxSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const col = path.node.loc?.start.column ?? 0;
      const tag = jsxNameOf(path.node.openingElement.name);
      const id = `jsx:${tag}:L${line}:C${col}:${jsxSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);

      const propNames: string[] = [];
      let hasRest = false;
      for (const attr of path.node.openingElement.attributes) {
        if (t.isJSXSpreadAttribute(attr)) {
          hasRest = true;
          continue;
        }
        if (t.isJSXAttribute(attr)) {
          if (t.isJSXIdentifier(attr.name)) propNames.push(attr.name.name);
          else if (t.isJSXNamespacedName(attr.name)) {
            propNames.push(`${attr.name.namespace.name}:${attr.name.name.name}`);
          }
        }
      }
      if (hasRest) propNames.push("…");

      const hasKids = path.node.children.some(
        (c) =>
          t.isJSXElement(c) ||
          t.isJSXFragment(c) ||
          t.isJSXExpressionContainer(c) ||
          (t.isJSXText(c) && c.value.trim().length > 0)
      );

      const rootId = jsxRootIdentifier(path.node.openingElement.name);
      const refId =
        rootId && rootId[0] === rootId[0]?.toUpperCase() ? nameToId.get(rootId) : undefined;

      const jsxName = path.node.openingElement.name;
      // Only self-closing tags: renaming the open name alone would mismatch `</Tag>`.
      const jsxNameLoc =
        t.isJSXIdentifier(jsxName) && path.node.openingElement.selfClosing
          ? locOf(jsxName)
          : undefined;

      addNode({
        id,
        kind: "jsx",
        label: `<${tag}>`,
        params: propNames,
        loc: locOf(path.node),
        nameLoc: jsxNameLoc,
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: hasKids,
        jsxTag: tag,
        refId,
        hasRestParam: hasRest || undefined,
      });
      if (refId) {
        addEdge("ref", id, refId, "def", {
          sourceHandle: "ref",
          targetHandle: "ref",
        });
      }
    },

    JSXFragment(path) {
      jsxSeq += 1;
      const line = path.node.loc?.start.line ?? 0;
      const col = path.node.loc?.start.column ?? 0;
      const id = `fragment:L${line}:C${col}:${jsxSeq}`;
      const outer = enclosingScopeId(path);
      scopeIdByAst.set(path.node, id);
      const hasKids = path.node.children.some(
        (c) =>
          t.isJSXElement(c) ||
          t.isJSXFragment(c) ||
          t.isJSXExpressionContainer(c) ||
          (t.isJSXText(c) && c.value.trim().length > 0)
      );
      addNode({
        id,
        kind: "fragment",
        label: "< >",
        params: [],
        loc: locOf(path.node),
        scopeId: outer,
        parentId: outer === MODULE_ID ? undefined : outer,
        expandable: hasKids,
      });
    },
  });

  // Rebuild nameToId preferring function/method/import over bindings
  nameToId.clear();
  for (const n of nodes) {
    if (n.kind === "function" || n.kind === "arrow" || n.kind === "import" || n.kind === "external") {
      const resolveName = n.bindingName ?? n.label;
      // Skip anonymous display labels like "() => {}" unless bindingName is set.
      if (resolveName && resolveName !== "() => {}" && resolveName !== "function() {}") {
        nameToId.set(resolveName, n.id);
      }
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
    if (n.kind === "binding" && n.scopeId && !n.pattern && !n.slotOf) {
      bindingIds.set(`${n.scopeId}::${n.label}`, n.id);
    }
  }
  // Slot bindings already registered; ensure map has them
  for (const n of nodes) {
    if (n.kind === "binding" && n.slotOf && n.scopeId) {
      // label may be path; use last segment / name from id
      const nameFromId = n.id.match(/^binding:([^:]+):/);
      const bindName = nameFromId?.[1] ?? n.label.split(".").pop() ?? n.label;
      bindingIds.set(`${n.scopeId}::${bindName}`, n.id);
    }
  }

  // Deferred export rails + links (declaration exports + default)
  const existingExportIds = new Set(nodes.filter((n) => n.kind === "export").map((n) => n.id));
  for (const pe of pendingExports) {
    if (pe.label === "default") {
      const defaultId = `export:default:L${pe.line}`;
      const target =
        nameToId.get(pe.localName) ??
        bindingIds.get(`${MODULE_ID}::${pe.localName}`);
      if (target && existingExportIds.has(defaultId)) {
        const already = edges.some(
          (e) => e.kind === "returns" && e.source === target && e.target === defaultId
        );
        if (!already) {
          addEdge("returns", target, defaultId, "default", {
            sourceHandle: "out",
            targetHandle: "in",
          });
        }
      }
      continue;
    }
    const id = `export:${pe.name}:L${pe.line}`;
    if (!existingExportIds.has(id)) {
      addNode({
        id,
        kind: "export",
        label: pe.name,
        params: [],
        parentId: MODULE_ID,
        scopeId: MODULE_ID,
      });
      existingExportIds.add(id);
    }
    const target =
      nameToId.get(pe.localName) ?? bindingIds.get(`${MODULE_ID}::${pe.localName}`);
    if (target) {
      addEdge("returns", target, id, "export", {
        sourceHandle: "out",
        targetHandle: "in",
      });
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

  // Re-link JSX refs now that nameToId is rebuilt
  for (const n of nodes) {
    if (n.kind !== "jsx" || !n.jsxTag) continue;
    const root = n.jsxTag.split(".")[0]!;
    if (root[0] !== root[0]?.toUpperCase()) continue;
    const refId = nameToId.get(root);
    if (!refId || n.refId === refId) continue;
    n.refId = refId;
    addEdge("ref", n.id, refId, "def", {
      sourceHandle: "ref",
      targetHandle: "ref",
    });
  }

  function resolveCallee(
    callee: t.Expression
  ): { id?: string; label: string; optional?: boolean } | undefined {
    if (t.isIdentifier(callee)) {
      const known = nameToId.get(callee.name);
      if (known) return { id: known, label: callee.name };
      return { id: ensureExternal(callee.name), label: callee.name };
    }
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      !callee.computed &&
      t.isIdentifier(callee.property)
    ) {
      const prop = callee.property.name;
      const optional = t.isOptionalMemberExpression(callee) || Boolean(callee.optional);
      if (t.isIdentifier(callee.object)) {
        const q = `${callee.object.name}.${prop}`;
        const known = nameToId.get(q);
        if (known) return { id: known, label: prop, optional };
        return { label: prop, optional };
      }
      if (t.isThisExpression(callee.object)) {
        const known = nameToId.get(prop);
        const node = known ? nodes.find((n) => n.id === known) : undefined;
        if (node?.kind === "method") return { id: known, label: prop, optional };
        return { label: prop, optional };
      }
      return { label: prop, optional };
    }
    if (t.isNewExpression(callee as unknown as t.NewExpression)) {
      return undefined;
    }
    return undefined;
  }

  function resolveCalleeFromNode(
    callee: t.Expression | t.V8IntrinsicIdentifier | t.Super
  ): { id?: string; label: string; optional?: boolean } | undefined {
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
    if (isCallLike(object) && !t.isImportExpression(object)) {
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
    if (isCallLike(arg) && !t.isImportExpression(arg)) {
      const callId = callIdByNode.get(arg);
      if (callId) {
        addEdge("thread", callId, scopeId, "return", {
          sourceHandle: "out",
          targetHandle: "return",
        });
      }
      return;
    }
    if (t.isImportExpression(arg)) {
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
      nameLoc: locOf(expr),
      scopeId,
      parentId: scopeId === MODULE_ID ? undefined : scopeId,
    });

    inputs.forEach((input, i) => {
      threadIntoExprInput(exprId, i, input, scopeId, scopeNode);
    });

    return exprId;
  }

  function threadValueIntoHandle(
    targetId: string,
    arg: t.Expression | t.SpreadElement | t.ArgumentPlaceholder,
    targetHandle: string,
    scopeId: string,
    edgeLabel?: string
  ) {
    const scopeNode = nodes.find((n) => n.id === scopeId);
    const expr = t.isSpreadElement(arg) ? arg.argument : arg;
    if (!t.isExpression(expr)) return;

    if (t.isIdentifier(expr)) {
      const bId =
        bindingIds.get(`${scopeId}::${expr.name}`) ??
        bindingIds.get(`${MODULE_ID}::${expr.name}`);
      if (bId) {
        addEdge("thread", bId, targetId, edgeLabel ?? expr.name, {
          sourceHandle: "out",
          targetHandle,
        });
        return;
      }
      const paramIndex = scopeNode?.params.indexOf(expr.name) ?? -1;
      if (paramIndex >= 0 && scopeNode) {
        addEdge("thread", scopeId, targetId, edgeLabel ?? expr.name, {
          sourceHandle: `param:${paramIndex}`,
          targetHandle,
        });
      }
      return;
    }

    if (isCallLike(expr)) {
      const innerId = callIdByNode.get(expr);
      if (innerId) {
        addEdge("thread", innerId, targetId, edgeLabel ?? "arg", {
          sourceHandle: "out",
          targetHandle,
        });
      }
      return;
    }

    if (isInlineExpression(expr)) {
      const exprId = ensureExpression(expr, scopeId);
      if (exprId) {
        addEdge("thread", exprId, targetId, edgeLabel ?? sourceSlice(expr, code), {
          sourceHandle: "out",
          targetHandle,
        });
      }
    }
  }

  /** Feed a value expression into a call param handle. */
  function threadCallArgument(
    callId: string,
    arg: t.CallExpression["arguments"][number],
    argIndex: number,
    scopeId: string
  ) {
    if (t.isSpreadElement(arg)) {
      threadValueIntoHandle(callId, arg, "param:rest", scopeId, "…");
      return;
    }
    threadValueIntoHandle(callId, arg, `param:${argIndex}`, scopeId);
  }

  /** Feed a value expression into a binding/property `in` handle (like const init). */
  function threadIntoBinding(targetId: string, expr: t.Expression, scopeId: string) {
    threadValueIntoHandle(targetId, expr, "in", scopeId, "assign");
  }

  function createCallNode(
    path: NodePath<t.CallExpression | t.OptionalCallExpression>,
    opts: { optional?: boolean } = {}
  ) {
    const scopeId = enclosingScopeId(path);
    const calleeExpr = path.node.callee;
    let memberCallee: t.MemberExpression | t.OptionalMemberExpression | undefined;
    let methodName: string | undefined;
    if (
      (t.isMemberExpression(calleeExpr) || t.isOptionalMemberExpression(calleeExpr)) &&
      !calleeExpr.computed &&
      t.isIdentifier(calleeExpr.property)
    ) {
      memberCallee = calleeExpr;
      methodName = calleeExpr.property.name;
    }
    const isMethod = memberCallee != null;

    const resolved = resolveCalleeFromNode(
      path.node.callee as t.Expression | t.V8IntrinsicIdentifier | t.Super
    );
    if (!resolved && !isMethod) return;
    const callLabel = methodName ? `${methodName}()` : `${resolved!.label}()`;

    callSeq += 1;
    const line = path.node.loc?.start.line ?? 0;
    const col = path.node.loc?.start.column ?? 0;
    const callKey = methodName ?? resolved!.label;
    const callId = `call:${callKey}:L${line}:C${col}:${callSeq}`;
    callIdByNode.set(path.node, callId);

    const calleeNode = resolved?.id ? nodes.find((n) => n.id === resolved.id) : undefined;
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

    const hasRest = path.node.arguments.some((a) => t.isSpreadElement(a));

    let receiver: string | undefined;
    if (memberCallee && t.isThisExpression(memberCallee.object)) {
      receiver = "this";
    } else if (memberCallee && t.isIdentifier(memberCallee.object)) {
      receiver = memberCallee.object.name;
    }

    const optional =
      opts.optional ||
      t.isOptionalCallExpression(path.node) ||
      resolved?.optional ||
      (memberCallee && t.isOptionalMemberExpression(memberCallee)) ||
      false;

    let callNameLoc: SourceLoc | undefined;
    const callee = path.node.callee;
    if (t.isIdentifier(callee)) {
      callNameLoc = locOf(callee);
    } else if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      !callee.computed &&
      t.isIdentifier(callee.property)
    ) {
      callNameLoc = locOf(callee.property);
    }

    addNode({
      id: callId,
      kind: "call",
      label: callLabel,
      params: callParams,
      loc: locOf(path.node),
      nameLoc: callNameLoc,
      scopeId,
      refId: resolved?.id,
      callKind: "call",
      parentId: scopeId === MODULE_ID ? undefined : scopeId,
      receiver,
      hasThis: Boolean(isMethod),
      hasOptional: optional || undefined,
      hasRestParam: hasRest || undefined,
    });

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

    if (memberCallee && t.isIdentifier(memberCallee.object)) {
      threadIntoThis(callId, memberCallee.object, scopeId, scopeNode);
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
  }

  function finishCallArgs(
    path: NodePath<t.CallExpression | t.OptionalCallExpression | t.NewExpression>
  ) {
    const callId = callIdByNode.get(path.node);
    if (!callId) return;
    const scopeId = enclosingScopeId(path);
    path.node.arguments.forEach((arg, argIndex) => {
      threadCallArgument(callId, arg, argIndex, scopeId);
    });
  }

  traverse(ast, {
    CallExpression: {
      enter(path) {
        // Dynamic import(): CallExpression with Import callee (babel classic shape)
        if (t.isImport(path.node.callee)) {
          const scopeId = enclosingScopeId(path);
          callSeq += 1;
          const line = path.node.loc?.start.line ?? 0;
          const col = path.node.loc?.start.column ?? 0;
          const callId = `call:import:L${line}:C${col}:${callSeq}`;
          callIdByNode.set(path.node, callId);

          let importSource: string | undefined;
          const src = path.node.arguments[0];
          if (src && t.isStringLiteral(src)) importSource = src.value;

          addNode({
            id: callId,
            kind: "call",
            label: "import()",
            params: ["source"],
            loc: locOf(path.node),
            scopeId,
            callKind: "call",
            parentId: scopeId === MODULE_ID ? undefined : scopeId,
            importSource,
          });

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
          return;
        }
        createCallNode(path);
      },
      exit(path) {
        if (t.isImport(path.node.callee)) {
          const callId = callIdByNode.get(path.node);
          if (!callId) return;
          const scopeId = enclosingScopeId(path);
          const src = path.node.arguments[0];
          if (src) threadValueIntoHandle(callId, src, "param:0", scopeId, "source");
          return;
        }
        finishCallArgs(path);
        const callId = callIdByNode.get(path.node);
        if (!callId) return;
        const scopeId = enclosingScopeId(path);
        const calleeExpr = path.node.callee;
        if (
          !t.isExpression(calleeExpr) ||
          !(t.isMemberExpression(calleeExpr) || t.isOptionalMemberExpression(calleeExpr)) ||
          calleeExpr.computed ||
          !t.isExpression(calleeExpr.object)
        ) {
          return;
        }
        if (isCallLike(calleeExpr.object) && !t.isImportExpression(calleeExpr.object)) {
          const scopeNode = nodes.find((n) => n.id === scopeId);
          threadIntoThis(callId, calleeExpr.object, scopeId, scopeNode);
        }
      },
    },

    OptionalCallExpression: {
      enter(path) {
        createCallNode(path, { optional: true });
      },
      exit(path) {
        finishCallArgs(path);
        const callId = callIdByNode.get(path.node);
        if (!callId) return;
        const scopeId = enclosingScopeId(path);
        const calleeExpr = path.node.callee;
        if (
          !(t.isMemberExpression(calleeExpr) || t.isOptionalMemberExpression(calleeExpr)) ||
          calleeExpr.computed ||
          !t.isExpression(calleeExpr.object)
        ) {
          return;
        }
        if (isCallLike(calleeExpr.object) && !t.isImportExpression(calleeExpr.object)) {
          const scopeNode = nodes.find((n) => n.id === scopeId);
          threadIntoThis(callId, calleeExpr.object, scopeId, scopeNode);
        }
      },
    },

    ImportExpression: {
      enter(path) {
        const scopeId = enclosingScopeId(path);
        callSeq += 1;
        const line = path.node.loc?.start.line ?? 0;
        const col = path.node.loc?.start.column ?? 0;
        const callId = `call:import:L${line}:C${col}:${callSeq}`;
        callIdByNode.set(path.node, callId);

        let importSource: string | undefined;
        const src = path.node.source;
        if (t.isStringLiteral(src)) importSource = src.value;

        addNode({
          id: callId,
          kind: "call",
          label: "import()",
          params: ["source"],
          loc: locOf(path.node),
          scopeId,
          callKind: "call",
          parentId: scopeId === MODULE_ID ? undefined : scopeId,
          importSource,
        });

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
        threadValueIntoHandle(callId, path.node.source, "param:0", scopeId, "source");
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

        const hasRest = path.node.arguments.some((a) => t.isSpreadElement(a));

        const newNameLoc =
          t.isIdentifier(callee) ? locOf(callee) : undefined;
        addNode({
          id: callId,
          kind: "call",
          label: `new ${resolved.label}()`,
          params: callParams,
          loc: locOf(path.node),
          nameLoc: newNameLoc,
          scopeId,
          refId: resolved.id,
          callKind: "new",
          instanceOf: resolved.label,
          parentId: scopeId === MODULE_ID ? undefined : scopeId,
          hasRestParam: hasRest || undefined,
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
        finishCallArgs(path);
      },
    },

    VariableDeclarator: {
      exit(path) {
        if (!path.node.init) return;
        if (
          t.isFunctionExpression(path.node.init) ||
          t.isArrowFunctionExpression(path.node.init)
        ) {
          return;
        }
        if (isCallLike(path.node.init)) return;
        const scopeId = path.parentPath ? enclosingScopeId(path.parentPath) : MODULE_ID;

        if (t.isIdentifier(path.node.id)) {
          const bId = bindingIds.get(`${scopeId}::${path.node.id.name}`);
          if (!bId) return;
          threadIntoBinding(bId, path.node.init, scopeId);
          return;
        }

        if (t.isObjectPattern(path.node.id) || t.isArrayPattern(path.node.id)) {
          const line = path.node.loc?.start.line ?? 0;
          const col = path.node.loc?.start.column ?? 0;
          const parentId = `binding:pattern:L${line}:C${col}`;
          if (nodes.some((n) => n.id === parentId)) {
            threadIntoBinding(parentId, path.node.init, scopeId);
          }
        }
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

        if (t.isOptionalMemberExpression(left)) {
          // Exotic optional assignment — skip dedicated prop slot
          ensureExpression(path.node, scopeId);
          return;
        }

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
        // Prefer function scope for returns, not branch/jsx
        const fnScope = path.findParent(
          (p) =>
            p.isFunctionDeclaration() ||
            p.isFunctionExpression() ||
            p.isArrowFunctionExpression() ||
            p.isClassMethod() ||
            p.isClassPrivateMethod()
        );
        const retScope = fnScope ? functionScopeId(fnScope) ?? scopeId : scopeId;
        threadReturnValue(retScope, path.node.argument ?? undefined);
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

    JSXElement: {
      exit(path) {
        const jsxId = scopeIdByAst.get(path.node);
        if (!jsxId) return;
        const scopeId = enclosingScopeId(path);

        for (const attr of path.node.openingElement.attributes) {
          if (t.isJSXSpreadAttribute(attr)) {
            if (t.isExpression(attr.argument)) {
              threadValueIntoHandle(jsxId, attr.argument, "param:rest", scopeId, "…");
            }
            continue;
          }
          if (!t.isJSXAttribute(attr) || !attr.value) continue;
          let propName = "?";
          if (t.isJSXIdentifier(attr.name)) propName = attr.name.name;
          const paramIndex = nodes.find((n) => n.id === jsxId)?.params.indexOf(propName) ?? -1;
          const handle = paramIndex >= 0 ? `param:${paramIndex}` : `param:${propName}`;

          if (t.isStringLiteral(attr.value)) {
            const lit = attr.value;
            // Treat as inline literal expression
            const exprId = ensureExpression(lit as unknown as t.Expression, scopeId);
            if (exprId) {
              addEdge("thread", exprId, jsxId, propName, {
                sourceHandle: "out",
                targetHandle: handle,
              });
            }
          } else if (t.isJSXExpressionContainer(attr.value)) {
            const ex = attr.value.expression;
            if (t.isExpression(ex)) {
              threadValueIntoHandle(jsxId, ex, handle, scopeId, propName);
            }
          }
        }

        for (const child of path.node.children) {
          if (t.isJSXExpressionContainer(child) && t.isExpression(child.expression)) {
            const ex = child.expression;
            if (isCallLike(ex) || isInlineExpression(ex) || t.isIdentifier(ex)) {
              // Ensure nested expressions/calls exist; they use jsx as scope via enclosingScopeId
              if (isInlineExpression(ex) && !isCallLike(ex)) {
                ensureExpression(ex, jsxId);
              }
            }
          }
        }
      },
    },

    ThrowStatement: {
      exit(path) {
        const line = path.node.loc?.start.line ?? 0;
        const throwNode = nodes.find(
          (n) => n.kind === "throw" && n.loc?.startLine === line && n.id.includes(`L${line}`)
        );
        if (!throwNode || !path.node.argument) return;
        const scopeId = throwNode.scopeId ?? enclosingScopeId(path);
        if (t.isExpression(path.node.argument)) {
          threadValueIntoHandle(throwNode.id, path.node.argument, "in", scopeId, "throw");
        }
      },
    },
  });

  // Thread deferred class field inits
  for (const { propId, init, scopeId } of pendingFieldInits) {
    if (isCallLike(init)) {
      const callId = callIdByNode.get(init);
      if (callId) {
        addEdge("thread", callId, propId, "assign", {
          sourceHandle: "out",
          targetHandle: "in",
        });
      }
    } else {
      threadIntoBinding(propId, init, scopeId);
    }
  }

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
    // Class fields stack with methods
    if (
      n.kind === "binding" &&
      n.bindingKind === "prop" &&
      n.parentId?.startsWith("class:") &&
      n.scopeId === n.parentId
    ) {
      continue;
    }
    // Destructuring slots follow parent pattern in layout — skip from sibling flow
    if (n.kind === "binding" && n.slotOf) continue;
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
    if (n.parentId?.startsWith("class:") && n.scopeId === n.parentId) {
      if (n.kind === "method" || (n.kind === "binding" && n.bindingKind === "prop")) {
        const list = methodsByClass.get(n.parentId) ?? [];
        list.push(n);
        methodsByClass.set(n.parentId, list);
      }
    }
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
