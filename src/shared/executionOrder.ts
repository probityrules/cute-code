import type { GraphEdge, GraphNode, NodeKind } from "./graph";

/** End position — nested callees finish before their outer call. */
export function locKey(n: GraphNode): number {
  if (!n.loc) return Number.MAX_SAFE_INTEGER;
  return n.loc.endLine * 1e6 + n.loc.endCol;
}

/** Prefer value producers before consumers when end-locs tie (call before binding). */
function kindRank(kind: NodeKind): number {
  switch (kind) {
    case "expression":
      return 0;
    case "call":
      return 1;
    case "binding":
      return 2;
    case "class":
    case "function":
    case "arrow":
    case "method":
      return 3;
    default:
      return 4;
  }
}

function compareLocThenKind(a: GraphNode, b: GraphNode): number {
  return locKey(a) - locKey(b) || kindRank(a.kind) - kindRank(b.kind) || a.id.localeCompare(b.id);
}

/**
 * Order nodes for worker-flow / execution layout: honor thread edges
 * (producer before consumer), then end-loc + kind.
 */
export function orderByExecution(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  if (nodes.length <= 1) return [...nodes];

  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const succs = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    succs.set(n.id, new Set());
    indeg.set(n.id, 0);
  }

  for (const e of edges) {
    if (e.kind !== "thread") continue;
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    const outs = succs.get(e.source)!;
    if (outs.has(e.target)) continue;
    outs.add(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const ready = nodes
    .filter((n) => (indeg.get(n.id) ?? 0) === 0)
    .sort(compareLocThenKind);
  const ordered: GraphNode[] = [];
  const seen = new Set<string>();

  while (ready.length) {
    const n = ready.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    ordered.push(n);
    for (const t of succs.get(n.id) ?? []) {
      const next = (indeg.get(t) ?? 1) - 1;
      indeg.set(t, next);
      if (next === 0) {
        const node = byId.get(t);
        if (node) {
          ready.push(node);
          ready.sort(compareLocThenKind);
        }
      }
    }
  }

  for (const n of [...nodes].sort(compareLocThenKind)) {
    if (!seen.has(n.id)) ordered.push(n);
  }
  return ordered;
}
