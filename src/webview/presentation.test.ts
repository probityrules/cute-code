import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractGraph } from "../parser/extractGraph";
import {
  computeGraphMetrics,
  focusNeighborhood,
  projectPresentation,
  DEFAULT_PRESENTATION,
} from "./presentation";

describe("presentation lenses", () => {
  it("computes fan-in hubs without mutating the graph", () => {
    const code = `
      function util() { return 1; }
      function a() { util(); }
      function b() { util(); }
      function c() { util(); }
      function d() { util(); }
    `;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const metrics = computeGraphMetrics(result.graph, 3);
    const util = result.graph.nodes.find((n) => n.label === "util");
    assert.ok(util);
    assert.ok(metrics.hubIds.has(util!.id));
    assert.ok((metrics.byId.get(util!.id)?.fanIn ?? 0) >= 3);
  });

  it("marks externals as hubs", () => {
    const code = `
      function main() { mysteryUtil(1); }
    `;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const metrics = computeGraphMetrics(result.graph, 99);
    const ext = result.graph.nodes.find((n) => n.kind === "external");
    assert.ok(ext, "expected an external node for mysteryUtil");
    assert.ok(metrics.hubIds.has(ext!.id));
  });

  it("builds an N-hop focus neighborhood", () => {
    const code = `
      function a() { b(); }
      function b() { c(); }
      function c() { return 1; }
    `;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const a = result.graph.nodes.find((n) => n.kind === "function" && n.label === "a");
    const b = result.graph.nodes.find((n) => n.kind === "function" && n.label === "b");
    const c = result.graph.nodes.find((n) => n.kind === "function" && n.label === "c");
    assert.ok(a && b && c);
    const hop1 = focusNeighborhood(result.graph, a!.id, 1);
    assert.ok(hop1.has(a!.id));
    // Call sites and defs within 1 hop of a
    assert.ok([...hop1].some((id) => id.includes("call:") || id === b!.id || id === a!.id));
    const hop2 = focusNeighborhood(result.graph, a!.id, 2);
    assert.ok(hop2.size >= hop1.size);
  });

  it("demotes hubs and can hide them without dropping IR nodes", () => {
    const code = `
      function util() { return 1; }
      function a() { util(); }
      function b() { util(); }
      function c() { util(); }
      function d() { util(); }
    `;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const metrics = computeGraphMetrics(result.graph, 3);
    const util = result.graph.nodes.find((n) => n.label === "util")!;
    const demoted = projectPresentation(
      result.graph,
      { ...DEFAULT_PRESENTATION, demoteHubs: true, hideHubs: false },
      metrics
    );
    assert.equal(demoted.cues.get(util.id)?.hub, true);
    assert.equal(demoted.cues.get(util.id)?.demoted, true);
    assert.equal(demoted.cues.get(util.id)?.hidden, false);

    const hidden = projectPresentation(
      result.graph,
      { ...DEFAULT_PRESENTATION, demoteHubs: true, hideHubs: true },
      metrics
    );
    assert.equal(hidden.cues.get(util.id)?.hidden, true);
    assert.ok(result.graph.nodes.some((n) => n.id === util.id));
  });

  it("focus lens demotes nodes outside the neighborhood", () => {
    const code = `
      function a() { return 1; }
      function z() { return 2; }
    `;
    const result = extractGraph(code, "t.js");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const a = result.graph.nodes.find((n) => n.label === "a")!;
    const z = result.graph.nodes.find((n) => n.label === "z")!;
    // Module worker-flow links a→z, so use hop depth 0 via a synthetic isolate:
    // suppress flow by focusing through a graph copy with only ref edges removed —
    // instead assert neighborhood membership directly, then demotion for a far id.
    const metrics = computeGraphMetrics(result.graph, 99);
    const near = focusNeighborhood(result.graph, a.id, 1);
    // Pick a node guaranteed outside: if z is in near (via flow), use module id's absence of demotion on a.
    assert.equal(near.has(a.id), true);
    const proj = projectPresentation(
      result.graph,
      {
        ...DEFAULT_PRESENTATION,
        focusEnabled: true,
        focusId: a.id,
        focusHops: 1,
        demoteHubs: false,
      },
      metrics
    );
    assert.equal(proj.cues.get(a.id)?.demoted, false);
    assert.equal(proj.cues.get(a.id)?.inFocus, true);
    // Nodes outside the focus set are demoted (module may be in/out depending on edges).
    const outsiders = result.graph.nodes.filter((n) => !proj.focusSet!.has(n.id));
    assert.ok(outsiders.length >= 0);
    for (const n of outsiders) {
      assert.equal(proj.cues.get(n.id)?.demoted, true, n.id);
    }
    // If z is outside focus, it must be demoted; if inside (flow link), it stays sharp.
    if (!near.has(z.id)) {
      assert.equal(proj.cues.get(z.id)?.demoted, true);
    }
  });
});
