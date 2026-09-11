/**
 * Presentation lenses over a full StructureGraph.
 * Never mutates IR — only derives metrics and visual cues (demote / focus / hide).
 */
import type { EdgeKind, GraphNode, StructureGraph } from "../shared/graph";
import type { EdgeDisplayMode, ViewMode } from "./icons";

/** Edge kinds that count toward architectural fan-in/out (incidental noise signal). */
const COUPLING_KINDS: ReadonlySet<EdgeKind> = new Set(["ref", "thread", "calls"]);

export type PresetId = "trace" | "coupling" | "dataflow" | "interface" | "custom";

export type PresentationState = {
  preset: PresetId;
  /** Ego focus root; null = no focus lens. */
  focusId: string | null;
  focusHops: 1 | 2;
  /** When true and focusId set, demote nodes outside the neighborhood. */
  focusEnabled: boolean;
  /** Demote high fan-in / external hubs visually. */
  demoteHubs: boolean;
  /** Hide demoted hubs from the canvas (IR unchanged); restore via chip. */
  hideHubs: boolean;
  /** User-forced hub suppressions (subset of hub ids or any id). */
  suppressedIds: Set<string>;
  /** User pins that never demote/hide as hubs. */
  keepIds: Set<string>;
  /** Fan-in threshold for hub classification (coupling edges). */
  hubFanInThreshold: number;
};

export type NodeMetrics = {
  fanIn: number;
  fanOut: number;
  degree: number;
};

export type GraphMetrics = {
  byId: Map<string, NodeMetrics>;
  /** Auto-classified hubs (degree heuristic + externals), before keep/suppress. */
  hubIds: Set<string>;
};

export type NodeCue = {
  hub: boolean;
  demoted: boolean;
  inFocus: boolean;
  /** Hidden from canvas (hub hide or suppress) — not deleted from IR. */
  hidden: boolean;
};

export const DEFAULT_PRESENTATION: PresentationState = {
  preset: "custom",
  focusId: null,
  focusHops: 1,
  focusEnabled: false,
  demoteHubs: true,
  hideHubs: false,
  suppressedIds: new Set(),
  keepIds: new Set(),
  hubFanInThreshold: 4,
};

export type ArchitecturePreset = {
  id: Exclude<PresetId, "custom">;
  label: string;
  title: string;
  viewMode: ViewMode;
  edgeVis: Record<EdgeKind, EdgeDisplayMode>;
  demoteHubs: boolean;
  focusEnabled: boolean;
  /** When true, collapse all expandable scopes on apply. */
  collapseInteriors: boolean;
};

export const ARCHITECTURE_PRESETS: ArchitecturePreset[] = [
  {
    id: "trace",
    label: "Trace",
    title: "Trace execution — flow + value threads",
    viewMode: "execution",
    edgeVis: {
      flow: "lines",
      thread: "lines",
      ref: "hidden",
      returns: "lines",
      calls: "hidden",
      param: "hidden",
    },
    demoteHubs: false,
    focusEnabled: true,
    collapseInteriors: false,
  },
  {
    id: "coupling",
    label: "Coupling",
    title: "Refactor coupling — refs + calls; hubs demoted",
    viewMode: "inheritance",
    edgeVis: {
      flow: "hidden",
      thread: "hidden",
      ref: "lines",
      returns: "hidden",
      calls: "lines",
      param: "hidden",
    },
    demoteHubs: true,
    focusEnabled: true,
    collapseInteriors: false,
  },
  {
    id: "dataflow",
    label: "Data",
    title: "Data flow — threads, params, returns",
    viewMode: "variable",
    edgeVis: {
      flow: "hidden",
      thread: "lines",
      ref: "hidden",
      returns: "lines",
      calls: "hidden",
      param: "lines",
    },
    demoteHubs: true,
    focusEnabled: true,
    collapseInteriors: false,
  },
  {
    id: "interface",
    label: "Interface",
    title: "Interface surface — collapse interiors; imports/exports/refs",
    viewMode: "execution",
    edgeVis: {
      flow: "hidden",
      thread: "hidden",
      ref: "lines",
      returns: "lines",
      calls: "hidden",
      param: "hidden",
    },
    demoteHubs: true,
    focusEnabled: false,
    collapseInteriors: true,
  },
];

/** Leaf utility imports that add fan without architectural signal. */
export function isNoiseImport(n: GraphNode): boolean {
  if (n.kind !== "import" || !n.importSource) return false;
  const src = n.importSource.replace(/^node:/, "");
  return (
    src === "fs" ||
    src === "path" ||
    src === "util" ||
    src === "assert" ||
    src === "os" ||
    src === "url" ||
    src === "crypto"
  );
}

/** Degree metrics from the full IR (non-destructive). */
export function computeGraphMetrics(
  graph: StructureGraph,
  hubFanInThreshold = 4
): GraphMetrics {
  const byId = new Map<string, NodeMetrics>();
  const ensure = (id: string): NodeMetrics => {
    let m = byId.get(id);
    if (!m) {
      m = { fanIn: 0, fanOut: 0, degree: 0 };
      byId.set(id, m);
    }
    return m;
  };

  for (const n of graph.nodes) ensure(n.id);

  for (const e of graph.edges) {
    if (!COUPLING_KINDS.has(e.kind)) continue;
    const s = ensure(e.source);
    const t = ensure(e.target);
    s.fanOut += 1;
    t.fanIn += 1;
  }

  for (const m of byId.values()) {
    m.degree = m.fanIn + m.fanOut;
  }

  const hubIds = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === "module") continue;
    const m = byId.get(n.id)!;
    if (n.kind === "external" || isNoiseImport(n)) {
      hubIds.add(n.id);
      continue;
    }
    if (m.fanIn >= hubFanInThreshold) hubIds.add(n.id);
  }

  return { byId, hubIds };
}

/** Undirected N-hop neighborhood over structural edges. */
export function focusNeighborhood(
  graph: StructureGraph,
  focusId: string,
  hops: number
): Set<string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  for (const e of graph.edges) {
    link(e.source, e.target);
  }

  const out = new Set<string>([focusId]);
  let frontier = new Set<string>([focusId]);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!out.has(n)) {
          out.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return out;
}

/**
 * Project presentation cues for every IR node.
 * Hidden cues suppress canvas membership; demoted cues only change opacity/weight.
 */
export function projectPresentation(
  graph: StructureGraph,
  presentation: PresentationState,
  metrics: GraphMetrics
): {
  cues: Map<string, NodeCue>;
  focusSet: Set<string> | null;
  activeHubIds: Set<string>;
} {
  const focusSet =
    presentation.focusEnabled && presentation.focusId
      ? focusNeighborhood(graph, presentation.focusId, presentation.focusHops)
      : null;

  const activeHubIds = new Set<string>();
  for (const id of metrics.hubIds) {
    if (presentation.keepIds.has(id)) continue;
    activeHubIds.add(id);
  }
  for (const id of presentation.suppressedIds) {
    activeHubIds.add(id);
  }

  const cues = new Map<string, NodeCue>();
  for (const n of graph.nodes) {
    const isHub = activeHubIds.has(n.id);
    const suppressed = presentation.suppressedIds.has(n.id);
    const hideAsHub = presentation.hideHubs && isHub && !presentation.keepIds.has(n.id);
    const inFocus = focusSet ? focusSet.has(n.id) : true;
    const demotedByFocus = Boolean(focusSet && !inFocus);
    const demotedByHub =
      presentation.demoteHubs && isHub && !presentation.keepIds.has(n.id) && !hideAsHub;

    cues.set(n.id, {
      hub: isHub,
      demoted: demotedByFocus || demotedByHub,
      inFocus,
      hidden: suppressed || hideAsHub,
    });
  }

  return { cues, focusSet, activeHubIds };
}

export function applyPresetToPresentation(
  preset: ArchitecturePreset,
  prev: PresentationState
): PresentationState {
  return {
    ...prev,
    preset: preset.id,
    demoteHubs: preset.demoteHubs,
    focusEnabled: preset.focusEnabled,
  };
}
