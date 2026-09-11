import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractGraph } from "./extractGraph";
import { tryTitleEdit } from "./titleEdit";

describe("title edit", () => {
  it("exposes nameLoc on function declarations", () => {
    const result = extractGraph(`function greet(name) { return name; }`, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const greet = result.graph.nodes.find((n) => n.kind === "function" && n.label === "greet");
    assert.ok(greet?.nameLoc);
    assert.equal(greet!.nameLoc!.startLine, 1);
  });

  it("renames a function when the result is valid JS", () => {
    const code = `function greet(name) {\n  return name;\n}\ngreet("hi");\n`;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const greet = result.graph.nodes.find((n) => n.kind === "function" && n.label === "greet");
    assert.ok(greet?.nameLoc);

    const edited = tryTitleEdit(code, greet!.nameLoc!, "welcome", "t.js");
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.match(edited.code, /function welcome/);
    assert.ok(edited.graph.nodes.some((n) => n.kind === "function" && n.label === "welcome"));
  });

  it("rejects renames that produce invalid JS", () => {
    const code = `function greet(name) {\n  return name;\n}\n`;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const greet = result.graph.nodes.find((n) => n.kind === "function" && n.label === "greet");
    assert.ok(greet?.nameLoc);

    const edited = tryTitleEdit(code, greet!.nameLoc!, "123bad", "t.js");
    assert.equal(edited.ok, false);
  });

  it("can edit a call callee name when valid", () => {
    const code = `function greet() {}\ngreet();\n`;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const call = result.graph.nodes.find((n) => n.kind === "call" && n.label === "greet()");
    assert.ok(call?.nameLoc);

    const edited = tryTitleEdit(code, call!.nameLoc!, "greet", "t.js");
    assert.equal(edited.ok, true);

    const bad = tryTitleEdit(code, call!.nameLoc!, "@@@", "t.js");
    assert.equal(bad.ok, false);
  });
});
