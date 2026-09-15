import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractGraph } from "./extractGraph";

describe("extractGraph", () => {
  it("extracts function declarations and call-site blocks with ref threads", () => {
    const code = `
      function greet(name) {
        return format(name);
      }
      function format(s) {
        return s;
      }
      function main() {
        greet("hi");
      }
    `;
    const result = extractGraph(code, "sample.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const labels = result.graph.nodes.map((n) => n.label);
    assert.ok(labels.includes("greet"));
    assert.ok(labels.includes("format"));
    assert.ok(labels.includes("main"));
    assert.ok(result.graph.nodes.some((n) => n.kind === "call" && n.label === "greet()"));
    assert.ok(result.graph.nodes.some((n) => n.kind === "call" && n.label === "format()"));
    const ref = result.graph.edges.find(
      (e) => e.kind === "ref" && e.source.includes("call:greet")
    );
    assert.ok(ref);
    const greetDecl = result.graph.nodes.find((n) => n.kind === "function" && n.label === "greet");
    assert.equal(ref?.target, greetDecl?.id);
    const greetCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "greet()");
    assert.equal(greetCall?.callKind, "call");
    // return format(name) → format() out into greet's return handle
    const formatCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "format()");
    const ret = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === formatCall?.id &&
        e.target === greetDecl?.id &&
        e.targetHandle === "return"
    );
    assert.ok(ret);
    assert.equal(ret?.sourceHandle, "out");
  });

  it("chains name → trim() this → toUpperCase() this → function return", () => {
    const code = `
      function format(name) {
        return name.trim().toUpperCase();
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const format = result.graph.nodes.find((n) => n.kind === "function" && n.label === "format");
    const trimCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "trim()");
    const upperCall = result.graph.nodes.find(
      (n) => n.kind === "call" && n.label === "toUpperCase()"
    );
    assert.ok(format && trimCall && upperCall);
    assert.equal(trimCall?.hasThis, true);
    assert.equal(upperCall?.hasThis, true);
    assert.equal(trimCall?.receiver, "name");

    const nameToTrim = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === format?.id &&
        e.target === trimCall?.id &&
        e.label === "name"
    );
    assert.ok(nameToTrim);
    assert.equal(nameToTrim?.sourceHandle, "param:0");
    assert.equal(nameToTrim?.targetHandle, "this");

    const trimToUpper = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === trimCall?.id &&
        e.target === upperCall?.id
    );
    assert.ok(trimToUpper);
    assert.equal(trimToUpper?.sourceHandle, "out");
    assert.equal(trimToUpper?.targetHandle, "this");

    const upperToReturn = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === upperCall?.id &&
        e.target === format?.id &&
        e.targetHandle === "return"
    );
    assert.ok(upperToReturn);
    assert.equal(upperToReturn?.sourceHandle, "out");
  });

  it("wires param handles from decl left to call left by order", () => {
    const code = `
      function greet(name, title) {
        return format(name);
      }
      function format(s) { return s; }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const call = result.graph.nodes.find((n) => n.kind === "call" && n.label === "format()");
    assert.ok(call);
    assert.deepEqual(call?.params, ["s"]);
    const thread = result.graph.edges.find(
      (e) => e.kind === "thread" && e.target === call?.id && e.label === "name"
    );
    assert.ok(thread);
    assert.equal(thread?.sourceHandle, "param:0");
    assert.equal(thread?.targetHandle, "param:0");
  });

  it("bindings leave through out handle into return", () => {
    const code = `
      function greet(name) {
        const label = format(name);
        return label;
      }
      function format(s) { return s; }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const binding = result.graph.nodes.find((n) => n.kind === "binding" && n.label === "label");
    const ret = result.graph.edges.find(
      (e) => e.kind === "thread" && e.source === binding?.id && e.label === "return"
    );
    assert.ok(ret);
    assert.equal(ret?.sourceHandle, "out");
    assert.equal(ret?.targetHandle, "return");
  });

  it("places nested function decls under outer scope", () => {
    const code = `
      function outer() {
        function inner() { return 1; }
        return inner();
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const outer = result.graph.nodes.find((n) => n.label === "outer");
    const inner = result.graph.nodes.find((n) => n.label === "inner");
    assert.ok(outer && inner);
    assert.equal(inner?.scopeId, outer?.id);
    assert.equal(inner?.expandable, true);
  });

  it("extracts class methods", () => {
    const code = `
      class Counter {
        bump() { return this.value; }
        render() { this.bump(); }
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.graph.nodes.some((n) => n.kind === "class" && n.label === "Counter"));
    const cls = result.graph.nodes.find((n) => n.kind === "class" && n.label === "Counter");
    assert.equal(cls?.expandable, true);
    assert.ok(result.graph.nodes.some((n) => n.kind === "method" && n.label === "bump"));
    const bump = result.graph.nodes.find((n) => n.kind === "method" && n.label === "bump");
    assert.equal(bump?.scopeId, cls?.id);
    const wellIn = result.graph.edges.find(
      (e) =>
        e.kind === "flow" &&
        e.source === cls?.id &&
        e.sourceHandle === "flow-well-in"
    );
    assert.ok(wellIn, "expected class well entry into first member");
    const bumpCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "bump()");
    assert.ok(bumpCall);
    assert.equal(bumpCall?.hasThis, true);
  });

  it("extracts extends and stack order", () => {
    const code = `
      class Actor {}
      class Greeter extends Actor {
        constructor(p) {}
        say() {}
        shout() {}
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const cls = result.graph.nodes.find((n) => n.kind === "class" && n.label === "Greeter");
    assert.equal(cls?.extends, "Actor");
    const actor = result.graph.nodes.find((n) => n.kind === "class" && n.label === "Actor");
    assert.ok(actor);
    assert.equal(cls?.refId, actor?.id);
    const extendsEdge = result.graph.edges.find(
      (e) =>
        e.kind === "ref" &&
        e.source === cls?.id &&
        e.target === actor?.id &&
        e.label === "extends"
    );
    assert.ok(extendsEdge);
    const methods = result.graph.nodes
      .filter((n) => n.kind === "method" && n.parentId === cls?.id)
      .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
    assert.deepEqual(
      methods.map((m) => m.label),
      ["constructor", "say", "shout"]
    );
    assert.equal(methods[0]?.memberKind, "constructor");
  });

  it("extracts arrow functions and imports", () => {
    const code = `
      import { readFile } from "fs";
      const load = (path) => readFile(path);
      load("./x");
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const arrow = result.graph.nodes.find((n) => n.kind === "arrow");
    assert.ok(arrow);
    assert.equal(arrow?.label, "() => {}");
    assert.equal(arrow?.bindingName, "load");
    const binding = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "load"
    );
    assert.ok(binding);
    assert.equal(binding?.valueType, "function");
    assert.ok(
      result.graph.edges.some(
        (e) =>
          e.kind === "thread" &&
          e.source === arrow?.id &&
          e.target === binding?.id
      )
    );
    assert.ok(result.graph.nodes.some((n) => n.kind === "import" && n.label === "readFile"));
    assert.ok(
      result.graph.nodes.some(
        (n) => n.kind === "call" && n.refId?.includes("import:readFile")
      )
    );
    const loadCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "load()");
    assert.equal(loadCall?.refId, arrow?.id);
  });

  it("keeps import/export rails out of worker flow with export handles", () => {
    const code = `
      import { readFile } from "fs";
      function greet() {}
      export { greet };
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const mod = result.graph.nodes.find((n) => n.kind === "module");
    assert.equal(mod?.expandable, true);
    const greet = result.graph.nodes.find((n) => n.label === "greet" && n.kind === "function");
    const exp = result.graph.nodes.find((n) => n.kind === "export" && n.label === "greet");
    assert.ok(exp);
    const ret = result.graph.edges.find(
      (e) =>
        e.kind === "returns" &&
        e.source === greet?.id &&
        e.target === exp?.id &&
        e.sourceHandle === "out" &&
        e.targetHandle === "in"
    );
    assert.ok(ret);
    // Module well: worker flow enters at flow-well-in and exits at flow-well-out.
    assert.ok(
      result.graph.edges.some(
        (e) =>
          e.kind === "flow" &&
          e.source === mod?.id &&
          e.sourceHandle === "flow-well-in"
      )
    );
    assert.ok(
      result.graph.edges.some(
        (e) =>
          e.kind === "flow" &&
          e.target === mod?.id &&
          e.targetHandle === "flow-well-out"
      )
    );
    assert.equal(
      result.graph.edges.some(
        (e) =>
          e.kind === "flow" &&
          (e.source.startsWith("import:") ||
            e.target.startsWith("import:") ||
            e.source.startsWith("export:") ||
            e.target.startsWith("export:"))
      ),
      false
    );
  });

  it("builds inline expression blocks for template returns", () => {
    const code = `
      function emphasize(text) {
        return \`**\${text}**\`;
      }
      function greet(name) {
        const out = emphasize(name);
        return \`Hello, \${out}\`;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const emphasize = result.graph.nodes.find(
      (n) => n.kind === "function" && n.label === "emphasize"
    );
    const greet = result.graph.nodes.find((n) => n.kind === "function" && n.label === "greet");
    const empExpr = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.scopeId === emphasize?.id
    );
    const greetExpr = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.scopeId === greet?.id
    );
    assert.ok(empExpr);
    assert.ok(greetExpr);
    assert.match(empExpr!.label, /\*\*/);
    assert.match(greetExpr!.label, /Hello/);
    assert.deepEqual(empExpr!.params, ["text"]);
    assert.deepEqual(greetExpr!.params, ["out"]);

    const textIn = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === emphasize?.id &&
        e.target === empExpr?.id &&
        e.targetHandle === "in:0"
    );
    assert.ok(textIn);
    assert.equal(textIn?.sourceHandle, "param:0");

    const empRet = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === empExpr?.id &&
        e.target === emphasize?.id &&
        e.targetHandle === "return"
    );
    assert.ok(empRet);
    assert.equal(empRet?.sourceHandle, "out");

    const outBinding = result.graph.nodes.find((n) => n.kind === "binding" && n.label === "out");
    const outIn = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === outBinding?.id &&
        e.target === greetExpr?.id &&
        e.targetHandle === "in:0"
    );
    assert.ok(outIn);

    const greetRet = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === greetExpr?.id &&
        e.target === greet?.id &&
        e.targetHandle === "return"
    );
    assert.ok(greetRet);
  });

  it("builds expression blocks for binary operators", () => {
    const code = `
      function add(a, b) {
        return a + b;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const add = result.graph.nodes.find((n) => n.label === "add");
    const expr = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.scopeId === add?.id
    );
    assert.ok(expr);
    assert.equal(expr?.label, "a + b");
    assert.deepEqual(expr?.params, ["a", "b"]);
  });

  it("builds expression blocks for literal returns", () => {
    const code = `
      function ready() {
        return true;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ready = result.graph.nodes.find((n) => n.label === "ready");
    const expr = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.scopeId === ready?.id
    );
    assert.ok(expr);
    assert.equal(expr?.label, "true");
    assert.deepEqual(expr?.params, []);
    const ret = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === expr?.id &&
        e.target === ready?.id &&
        e.targetHandle === "return"
    );
    assert.ok(ret);
  });

  it("builds property binding slots for this member assignments", () => {
    const code = `
      class Greeter {
        constructor(prefix) {
          this.prefix = prefix;
        }
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ctor = result.graph.nodes.find(
      (n) => n.kind === "method" && n.memberKind === "constructor"
    );
    const prop = result.graph.nodes.find(
      (n) =>
        n.kind === "binding" &&
        n.bindingKind === "prop" &&
        n.scopeId === ctor?.id
    );
    assert.ok(prop);
    assert.equal(prop?.label, "prefix");
    assert.equal(prop?.receiver, "this");
    assert.equal(prop?.hasThis, true);
    assert.equal(
      result.graph.nodes.some(
        (n) => n.kind === "expression" && n.scopeId === ctor?.id
      ),
      false
    );
    const fromParam = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === ctor?.id &&
        e.target === prop?.id &&
        e.sourceHandle === "param:0" &&
        e.targetHandle === "in"
    );
    assert.ok(fromParam);
  });

  it("marks this.method() calls with receiver this", () => {
    const code = `
      class Greeter {
        say() {}
        shout() {
          return this.say();
        }
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const call = result.graph.nodes.find((n) => n.kind === "call" && n.label === "say()");
    assert.ok(call);
    assert.equal(call?.receiver, "this");
    assert.equal(call?.hasThis, true);
  });

  it("chains worker-flow edges in source order within a scope", () => {
    const code = `
      function greet(name) {
        const label = format(name);
        return label;
      }
      function format(s) { return s; }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const greet = result.graph.nodes.find((n) => n.label === "greet");
    const formatCall = result.graph.nodes.find(
      (n) => n.kind === "call" && n.label === "format()" && n.scopeId === greet?.id
    );
    const label = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "label" && n.scopeId === greet?.id
    );
    assert.ok(formatCall && label && greet);
    const flow = result.graph.edges.filter((e) => e.kind === "flow");
    assert.ok(flow.length >= 1);
    const step = flow.find(
      (e) =>
        (e.source === formatCall?.id && e.target === label?.id) ||
        (e.source === label?.id && e.target === formatCall?.id)
    );
    assert.ok(step);
    assert.equal(step?.sourceHandle, "flow-out");
    assert.equal(step?.targetHandle, "flow-in");

    const enter = flow.find(
      (e) => e.source === greet?.id && e.sourceHandle === "flow-well-in"
    );
    const exit = flow.find(
      (e) => e.target === greet?.id && e.targetHandle === "flow-well-out"
    );
    assert.ok(enter);
    assert.ok(exit);
    assert.equal(enter?.targetHandle, "flow-in");
    assert.equal(exit?.sourceHandle, "flow-out");
  });

  it("does not invent globals for member calls on parameters", () => {
    const code = `
      function format(name) {
        return name.trim().toUpperCase();
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const externals = result.graph.nodes.filter((n) => n.kind === "external");
    assert.equal(
      externals.length,
      0,
      `unexpected externals: ${externals.map((e) => e.label).join(", ")}`
    );
    const trimCall = result.graph.nodes.find((n) => n.label === "trim()");
    const upperCall = result.graph.nodes.find((n) => n.label === "toUpperCase()");
    assert.ok(trimCall && upperCall);
    assert.equal(trimCall?.refId, undefined);
    assert.equal(upperCall?.refId, undefined);
    assert.equal(trimCall?.hasThis, true);
    assert.equal(upperCall?.hasThis, true);
  });

  it("orders new Greeter before binding and threads literal args", () => {
    const code = `
      class Greeter {
        constructor(prefix) {}
      }
      function main() {
        const g = new Greeter("hi");
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const main = result.graph.nodes.find((n) => n.label === "main");
    const lit = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.label === '"hi"' && n.scopeId === main?.id
    );
    const neo = result.graph.nodes.find(
      (n) => n.kind === "call" && n.label === "new Greeter()" && n.scopeId === main?.id
    );
    const binding = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "g" && n.scopeId === main?.id
    );
    assert.ok(lit && neo && binding);
    assert.equal(neo?.callKind, "new");
    assert.equal(neo?.instanceOf, "Greeter");
    assert.equal(binding?.valueType, "instance");
    assert.equal(binding?.instanceOf, "Greeter");
    const litToNew = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === lit?.id &&
        e.target === neo?.id &&
        e.targetHandle === "param:0"
    );
    assert.ok(litToNew);
    const newToG = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === neo?.id &&
        e.target === binding?.id &&
        e.targetHandle === "in"
    );
    assert.ok(newToG);
    const flowNewToG = result.graph.edges.find(
      (e) =>
        e.kind === "flow" && e.source === neo?.id && e.target === binding?.id
    );
    assert.ok(flowNewToG, "expected new Greeter() → g in worker flow");
    const flowGToNew = result.graph.edges.find(
      (e) =>
        e.kind === "flow" && e.source === binding?.id && e.target === neo?.id
    );
    assert.equal(flowGToNew, undefined);
    const flowLitToNew = result.graph.edges.find(
      (e) => e.kind === "flow" && e.source === lit?.id && e.target === neo?.id
    );
    assert.ok(flowLitToNew, "expected \"hi\" → new Greeter() in worker flow");
  });

  it("orders chained method calls trim before toUpperCase in worker flow", () => {
    const code = `
      function format(name) {
        return name.trim().toUpperCase();
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const format = result.graph.nodes.find((n) => n.label === "format");
    const trimCall = result.graph.nodes.find(
      (n) => n.kind === "call" && n.label === "trim()" && n.scopeId === format?.id
    );
    const upperCall = result.graph.nodes.find(
      (n) => n.kind === "call" && n.label === "toUpperCase()" && n.scopeId === format?.id
    );
    assert.ok(trimCall && upperCall);
    const flow = result.graph.edges.find(
      (e) =>
        e.kind === "flow" && e.source === trimCall?.id && e.target === upperCall?.id
    );
    assert.ok(flow, "expected trim() → toUpperCase() worker flow");
  });

  it("returns parse errors", () => {
    const result = extractGraph("function ( {");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.message.length > 0);
  });

  it("creates export rails for export function / class / const", () => {
    const code = `
      export function Foo() {}
      export class Bar {}
      export const x = 1, y = 2;
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const foo = result.graph.nodes.find((n) => n.kind === "function" && n.label === "Foo");
    const bar = result.graph.nodes.find((n) => n.kind === "class" && n.label === "Bar");
    const expFoo = result.graph.nodes.find((n) => n.kind === "export" && n.label === "Foo");
    const expBar = result.graph.nodes.find((n) => n.kind === "export" && n.label === "Bar");
    const expX = result.graph.nodes.find((n) => n.kind === "export" && n.label === "x");
    const expY = result.graph.nodes.find((n) => n.kind === "export" && n.label === "y");
    assert.ok(foo && bar && expFoo && expBar && expX && expY);
    assert.ok(
      result.graph.edges.some(
        (e) => e.kind === "returns" && e.source === foo?.id && e.target === expFoo?.id
      )
    );
    assert.ok(
      result.graph.edges.some(
        (e) => e.kind === "returns" && e.source === bar?.id && e.target === expBar?.id
      )
    );
  });

  it("creates destructuring parent binding with child slots", () => {
    const code = `
      function main(user) {
        const { a, b } = user;
        const [x, y] = a;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const patterns = result.graph.nodes.filter((n) => n.kind === "binding" && n.pattern);
    assert.ok(patterns.length >= 2);
    const obj = patterns.find((n) => n.label.includes("a"));
    assert.ok(obj);
    assert.deepEqual(obj?.params, ["a", "b"]);
    const slots = result.graph.nodes.filter((n) => n.slotOf === obj?.id);
    assert.equal(slots.length, 2);
    assert.ok(slots.every((s) => s.kind === "binding"));
    const fromUser = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.target === obj?.id &&
        e.targetHandle === "in"
    );
    assert.ok(fromUser);
  });

  it("extracts class fields as prop bindings", () => {
    const code = `
      class Counter {
        count = 0;
        static shared = 1;
        #secret = 2;
        bump() {}
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const cls = result.graph.nodes.find((n) => n.kind === "class" && n.label === "Counter");
    const count = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "count" && n.scopeId === cls?.id
    );
    const shared = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "shared" && n.static
    );
    const secret = result.graph.nodes.find(
      (n) => n.kind === "binding" && n.label === "#secret"
    );
    assert.ok(count && shared && secret);
    assert.equal(count?.bindingKind, "prop");
    assert.equal(count?.parentId, cls?.id);
  });

  it("marks optional calls with hasOptional", () => {
    const code = `
      function main(api) {
        api?.fetch();
        maybe?.();
      }
      function maybe() {}
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const fetchCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "fetch()");
    const maybeCall = result.graph.nodes.find((n) => n.kind === "call" && n.label === "maybe()");
    assert.ok(fetchCall);
    assert.equal(fetchCall?.hasOptional, true);
    assert.ok(maybeCall);
    assert.equal(maybeCall?.hasOptional, true);
  });

  it("threads spread args into param:rest and sets hasRestParam", () => {
    const code = `
      function greet(a, b) {}
      function main(items) {
        greet(...items);
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const call = result.graph.nodes.find((n) => n.kind === "call" && n.label === "greet()");
    assert.ok(call);
    assert.equal(call?.hasRestParam, true);
    const rest = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.target === call?.id &&
        e.targetHandle === "param:rest"
    );
    assert.ok(rest);
  });

  it("builds expression blocks for await and marks async functions", () => {
    const code = `
      async function load(url) {
        return await fetch(url);
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const load = result.graph.nodes.find((n) => n.kind === "function" && n.label === "load");
    assert.equal(load?.async, true);
    const awaitExpr = result.graph.nodes.find(
      (n) => n.kind === "expression" && n.label.includes("await")
    );
    assert.ok(awaitExpr);
    const ret = result.graph.edges.find(
      (e) =>
        e.kind === "thread" &&
        e.source === awaitExpr?.id &&
        e.target === load?.id &&
        e.targetHandle === "return"
    );
    assert.ok(ret);
  });

  it("creates expandable if branch nodes scoping body bindings", () => {
    const code = `
      function main(flag) {
        if (flag) {
          const x = 1;
        } else {
          const y = 2;
        }
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const branch = result.graph.nodes.find((n) => n.kind === "branch" && n.branchKind === "if");
    assert.ok(branch);
    assert.equal(branch?.expandable, true);
    const x = result.graph.nodes.find((n) => n.kind === "binding" && n.label === "x");
    const y = result.graph.nodes.find((n) => n.kind === "binding" && n.label === "y");
    assert.equal(x?.scopeId, branch?.id);
    assert.equal(y?.scopeId, branch?.id);
  });

  it("extracts JSX elements with tag and prop params", () => {
    const code = `
      function Box(props) { return null; }
      function App() {
        return <Box title="hi">{1 + 1}</Box>;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const jsx = result.graph.nodes.find((n) => n.kind === "jsx");
    assert.ok(jsx);
    assert.equal(jsx?.jsxTag, "Box");
    assert.ok(jsx?.params.includes("title"));
    const box = result.graph.nodes.find((n) => n.kind === "function" && n.label === "Box");
    assert.equal(jsx?.refId, box?.id);
  });

  it("extracts dynamic import() as call with importSource", () => {
    const code = `
      async function load() {
        const mod = await import("./mod.js");
        return mod;
      }
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const imp = result.graph.nodes.find((n) => n.kind === "call" && n.label === "import()");
    assert.ok(imp);
    assert.equal(imp?.importSource, "./mod.js");
  });

  it("extracts export * and side-effect imports", () => {
    const code = `
      import "./side.js";
      export * from "./lib.js";
    `;
    const result = extractGraph(code);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const side = result.graph.nodes.find(
      (n) => n.kind === "import" && n.importSource === "./side.js"
    );
    assert.ok(side);
    const star = result.graph.nodes.find(
      (n) => n.kind === "export" && n.importSource === "./lib.js"
    );
    assert.ok(star);
    assert.match(star!.label, /\*/);
  });
});
