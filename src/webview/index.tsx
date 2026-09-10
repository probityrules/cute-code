import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  useStoreApi,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  BindingKind,
  EdgeKind,
  GraphEdge,
  GraphNode,
  HostToWebviewMessage,
  MemberKind,
  NodeKind,
  ParseErrorPayload,
  StructureGraph,
  WebviewToHostMessage,
} from "../shared/graph";
import { locKey, orderByExecution } from "../shared/executionOrder";
import {
  EDGE_TOGGLES,
  EdgeKindIcon,
  IconExpand,
  IconOpenFile,
  IconThis,
  KindIcon,
  VIEW_MODES,
  ViewModeIcon,
  edgeModeCycle,
  type EdgeDisplayMode,
  type ViewMode,
} from "./icons";
import "./styles.css";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const MODULE_ID = "module:root";
const EDGE_VIS_KEY = "cute-code.edgeVisibility";
const VIEW_MODE_KEY = "cute-code.viewMode";

type EdgeVisibility = Record<EdgeKind, EdgeDisplayMode>;

const DEFAULT_EDGE_VIS: EdgeVisibility = {
  flow: "lines",
  ref: "lines",
  thread: "lines",
  returns: "lines",
  calls: "lines",
  param: "lines",
};

function coerceEdgeMode(v: unknown): EdgeDisplayMode | undefined {
  if (v === "lines" || v === "labels" || v === "hidden") return v;
  if (v === true) return "lines";
  if (v === false) return "hidden";
  return undefined;
}

function loadEdgeVisibility(): EdgeVisibility {
  try {
    const raw = localStorage.getItem(EDGE_VIS_KEY);
    if (!raw) return { ...DEFAULT_EDGE_VIS };
    const parsed = JSON.parse(raw) as Partial<Record<EdgeKind, unknown>>;
    const next = { ...DEFAULT_EDGE_VIS };
    for (const t of EDGE_TOGGLES) {
      const m = coerceEdgeMode(parsed[t.kind]);
      if (m) {
        next[t.kind] = t.hasLabels === false && m === "labels" ? "lines" : m;
      }
    }
    return next;
  } catch {
    return { ...DEFAULT_EDGE_VIS };
  }
}

function saveEdgeVisibility(vis: EdgeVisibility) {
  try {
    localStorage.setItem(EDGE_VIS_KEY, JSON.stringify(vis));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === "execution" || raw === "variable" || raw === "inheritance") return raw;
  } catch {
    /* ignore */
  }
  return "execution";
}

function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function KindTitle({
  kind,
  label,
  memberKind,
  bindingKind,
  receiver,
  async: isAsync,
  generator,
  isStatic,
  hasOptional,
}: {
  kind: NodeKind;
  label: string;
  memberKind?: MemberKind;
  bindingKind?: BindingKind;
  /** When `"this"`, show a small this glyph before the title. */
  receiver?: string;
  async?: boolean;
  generator?: boolean;
  isStatic?: boolean;
  hasOptional?: boolean;
}) {
  return (
    <div className="struct-title-row">
      <KindIcon kind={kind} memberKind={memberKind} bindingKind={bindingKind} />
      {receiver === "this" && <IconThis />}
      <div className="struct-label">
        {label}
        {hasOptional && <span className="struct-optional-mark">?</span>}
      </div>
      {isStatic && <span className="struct-badge">static</span>}
      {isAsync && <span className="struct-badge">async</span>}
      {generator && <span className="struct-badge">*</span>}
    </div>
  );
}

type NodeActions = {
  toggleExpand: (nodeId: string) => void;
  openImport: (source: string) => void;
};

const NodeActionsContext = createContext<NodeActions>({
  toggleExpand: () => undefined,
  openImport: () => undefined,
});

function useNodeActions() {
  return useContext(NodeActionsContext);
}

const EdgeVisContext = createContext<EdgeVisibility>(DEFAULT_EDGE_VIS);

function useEdgeVis() {
  return useContext(EdgeVisContext);
}

function useEdgeMode(kind: EdgeKind): EdgeDisplayMode {
  return useEdgeVis()[kind] ?? "lines";
}

/** True when chrome for this kind is not fully off. */
function useShowEdge() {
  const vis = useEdgeVis();
  return (kind: EdgeKind) => vis[kind] !== "hidden";
}

/** Hide connection handles visually while keeping them mounted for React Flow. */
function handleCls(visible: boolean, ...parts: string[]) {
  return ["handle", ...parts, visible ? "" : "handle-ghost"].filter(Boolean).join(" ");
}

const KIND_CLASS: Record<NodeKind, string> = {
  module: "kind-module",
  function: "kind-function",
  arrow: "kind-arrow",
  method: "kind-method",
  class: "kind-class",
  import: "kind-import",
  export: "kind-export",
  external: "kind-external",
  binding: "kind-binding",
  call: "kind-call",
  expression: "kind-expression",
  branch: "kind-branch",
  loop: "kind-loop",
  try: "kind-try",
  throw: "kind-throw",
  jsx: "kind-jsx",
  fragment: "kind-fragment",
};

export const STACK_W = 200;
export const HEADER_H = 58;
export const MEMBER_H = 62;
export const MEMBER_GAP = 6;
export const STACK_PAD = 8;
const DETACH_X = STACK_W * 0.65;
const INSERT_PAD = 28;

const NODE_W = 168;
const NODE_H = 64;
/** Header strip height inside an expanded declaration (matches .decl-header). */
const DECL_HEADER_H = 62;
/** Padding around the inner well (margin on .expand-well). */
const WELL_MARGIN = 10;
/** Left rail inside the well for named param handles. */
const PARAM_RAIL = 58;
/** Module import rail column (block width + padding). */
const IMPORT_RAIL = 148;
/** Module export rail column. */
const EXPORT_RAIL = 148;
const RAIL_BLOCK_H = 48;
const RAIL_GAP = 10;
const EXPAND_PAD = WELL_MARGIN + 8;
/** Nested decls / body content start below header + well margin. */
const DECL_ROW_Y = DECL_HEADER_H + WELL_MARGIN + 8;
const BODY_Y0 = DECL_ROW_Y;

type NodeData = {
  label: string;
  kind: NodeKind;
  params: string[];
  returnsLabel?: string;
  loc?: StructureGraph["nodes"][0]["loc"];
  extends?: string;
  stackOrder?: number;
  memberKind?: MemberKind;
  stackClassId?: string;
  scopeId?: string;
  bindingKind?: BindingKind;
  refId?: string;
  /** Call/extends caption for ref-labels mode */
  refCaption?: string;
  /** Handle id → label for thread/returns labels mode */
  portLabels?: Record<string, string>;
  expandable?: boolean;
  expanded?: boolean;
  importSource?: string;
  receiver?: string;
  hasThis?: boolean;
  /** Stable id for action buttons (same as RF node id). */
  nodeId?: string;
  /** Pixel height of expanded frame (for well handle layout). */
  frameHeight?: number;
  /** Worker-flow step index for this block (labels mode). */
  flowStep?: number;
  /** Expanded well entry/exit step numbers. */
  flowWellInStep?: number;
  flowWellOutStep?: number;
  hasOptional?: boolean;
  async?: boolean;
  generator?: boolean;
  static?: boolean;
  pattern?: boolean;
  slotOf?: string;
  branchKind?: "if" | "switch";
  loopKind?: "for" | "for-of" | "for-in" | "while" | "do";
  jsxTag?: string;
  hasRestParam?: boolean;
};

function stackHeight(memberCount: number): number {
  return HEADER_H + memberCount * (MEMBER_H + MEMBER_GAP) + STACK_PAD;
}

function memberY(index: number): number {
  return HEADER_H + index * (MEMBER_H + MEMBER_GAP);
}

/** Evenly space handles along a side (percent of full node). */
function handleTop(index: number, count: number): string {
  if (count <= 0) return "50%";
  return `${((index + 1) / (count + 1)) * 100}%`;
}

/** Evenly space handles along the expanded inner well's left edge. */
function wellParamTop(index: number, count: number, frameHeight: number): number {
  const wellTop = DECL_HEADER_H + WELL_MARGIN;
  const wellH = Math.max(frameHeight - DECL_HEADER_H - WELL_MARGIN * 2, 48);
  return wellTop + ((index + 1) / (count + 1)) * wellH;
}

function CallParamHandles({
  params,
  visible = true,
  hasRest = false,
}: {
  params: string[];
  visible?: boolean;
  hasRest?: boolean;
}) {
  const count = params.length + (hasRest ? 1 : 0);
  if (!count) return null;
  return (
    <>
      {params.map((name, i) => (
        <Handle
          key={`param:${i}`}
          type="target"
          position={Position.Left}
          id={`param:${i}`}
          className={handleCls(visible, "handle-param")}
          style={{ top: handleTop(i, count) }}
          title={name}
        />
      ))}
      {hasRest && (
        <Handle
          type="target"
          position={Position.Left}
          id="param:rest"
          className={handleCls(visible, "handle-param")}
          style={{ top: handleTop(params.length, count) }}
          title="…"
        />
      )}
    </>
  );
}

/** Method-call `this` / receiver — top-left of the call block. */
function CallThisHandle({ label, visible = true }: { label?: string; visible?: boolean }) {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id="this"
      className={handleCls(visible, "handle-this")}
      style={{ left: 14, top: 0 }}
      title={label ? `this · ${label}` : "this"}
    />
  );
}

/**
 * Decl param sources — only when expanded.
 * Physically on the inner well's left rail; Position.Right so threads run right to usages.
 */
function WellParamHandles({
  params,
  frameHeight,
  visible = true,
}: {
  params: string[];
  frameHeight: number;
  visible?: boolean;
}) {
  if (!params.length || frameHeight <= 0) return null;
  return (
    <>
      {params.map((name, i) => (
        <Handle
          key={`well-param-${i}`}
          type="source"
          position={Position.Right}
          id={`param:${i}`}
          className={handleCls(visible, "handle-param", "handle-well-param")}
          style={{
            top: wellParamTop(i, params.length, frameHeight),
            left: WELL_MARGIN,
            right: "auto",
          }}
          title={name}
        />
      ))}
    </>
  );
}

/** Function return sink — right edge of the expanded inner well. */
function WellReturnHandle({
  frameHeight,
  visible = true,
}: {
  frameHeight: number;
  visible?: boolean;
}) {
  if (frameHeight <= 0) return null;
  const wellTop = DECL_HEADER_H + WELL_MARGIN;
  const wellH = Math.max(frameHeight - DECL_HEADER_H - WELL_MARGIN * 2, 48);
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="return"
        className={handleCls(visible, "handle-return", "handle-well-return")}
        style={{
          top: wellTop + wellH * 0.62,
          right: WELL_MARGIN,
          left: "auto",
        }}
        title="return"
      />
      {visible && (
        <span
          className="well-return-name"
          style={{ top: wellTop + wellH * 0.62 }}
          aria-hidden
        >
          return
        </span>
      )}
    </>
  );
}

function NodeCornerAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="node-action nodrag nopan"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

function StructureNodeView({ data, selected, id }: NodeProps) {
  const d = data as NodeData;
  const actions = useNodeActions();
  const show = useShowEdge();
  const threadMode = useEdgeMode("thread");
  const refMode = useEdgeMode("ref");
  const returnsMode = useEdgeMode("returns");
  const callsMode = useEdgeMode("calls");
  const paramMode = useEdgeMode("param");
  const expanded = d.expanded;
  const isFn = d.kind === "function" || d.kind === "arrow";
  const isJsx = d.kind === "jsx" || d.kind === "fragment";
  const isImport = d.kind === "import";
  const nodeId = d.nodeId ?? id;
  const frameHeight = d.frameHeight ?? 0;
  const paramVisible = paramMode === "lines" || threadMode === "lines";
  const mountWellParams =
    isFn &&
    d.params.length > 0 &&
    (show("param") || threadMode !== "hidden");
  const mountCallParams =
    isJsx &&
    (d.params.length > 0 || d.hasRestParam) &&
    (show("param") || threadMode !== "hidden");
  const inVisible = threadMode === "lines" || callsMode === "lines";
  const outVisible = threadMode === "lines" || returnsMode === "lines";

  return (
    <div
      className={`struct-node ${KIND_CLASS[d.kind]} ${selected ? "selected" : ""} ${expanded ? "expanded-decl" : ""} ${d.expandable ? "has-action" : ""} ${isImport ? "has-action" : ""}`}
      style={expanded ? { width: "100%", height: "100%" } : undefined}
    >
      <FlowHandles step={d.flowStep} />
      {d.expandable && (
        <NodeCornerAction
          title={expanded ? "Condense" : "Expand"}
          onClick={() => actions.toggleExpand(nodeId)}
        >
          <IconExpand condensed={!expanded} />
        </NodeCornerAction>
      )}
      {isImport && d.importSource && (
        <NodeCornerAction
          title={`Open ${d.importSource}`}
          onClick={() => actions.openImport(d.importSource!)}
        >
          <IconOpenFile />
        </NodeCornerAction>
      )}
      {isFn && expanded && mountWellParams && (
        <WellParamHandles
          params={d.params}
          frameHeight={frameHeight}
          visible={paramVisible}
        />
      )}
      {mountCallParams && (
        <CallParamHandles
          params={d.params.filter((p) => p !== "…")}
          visible={paramVisible}
          hasRest={!!d.hasRestParam}
        />
      )}
      {isFn && expanded && threadMode !== "hidden" && (
        <WellReturnHandle frameHeight={frameHeight} visible={threadMode === "lines"} />
      )}
      {isFn && expanded && (threadMode === "labels" || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "return", "return")}
          className="port-label-return"
          style={{
            top: Math.max(frameHeight - WELL_MARGIN - 24, DECL_HEADER_H + 40),
            right: -4,
            transform: "translate(100%, -50%)",
          }}
        />
      )}
      {!isFn && !isImport && !isJsx && (
        <Handle
          type="target"
          position={Position.Left}
          className={handleCls(inVisible)}
          id="in"
        />
      )}
      {!isFn && !isImport && !isJsx && threadMode === "labels" && (
        <PortLabel
          text={portName(d, "in", "in")}
          className="port-label-in"
          style={{ left: -4, top: "50%" }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(outVisible, "handle-out")}
        id="out"
        title="output"
      />
      {(threadMode === "labels" || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "out", returnsMode === "labels" ? "export" : "out")}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      {!isImport && (
        <Handle
          type="target"
          position={Position.Bottom}
          className={handleCls(refMode === "lines", "handle-ref")}
          id="ref"
        />
      )}
      {isJsx && (
        <Handle
          type="source"
          position={Position.Top}
          className={handleCls(refMode === "lines", "handle-ref")}
          id="ref"
        />
      )}
      <div className="decl-header">
        <KindTitle
          kind={d.kind}
          label={d.label}
          async={d.async}
          generator={d.generator}
        />
        {d.branchKind && (
          <div className="struct-returns">{d.branchKind}</div>
        )}
        {d.loopKind && <div className="struct-returns">{d.loopKind}</div>}
        {!expanded && d.params.length > 0 && !isJsx && (
          <div className="struct-params">
            {d.params.map((p, i) => (
              <span key={i} className="param-chip">
                {p}
              </span>
            ))}
          </div>
        )}
        {!expanded && d.returnsLabel && (
          <div className="struct-returns">→ {d.returnsLabel}</div>
        )}
      </div>
      {expanded && (
        <div className="expand-well" aria-hidden={false}>
          <WellFlowHandles inStep={d.flowWellInStep} outStep={d.flowWellOutStep} />
          {mountWellParams &&
            paramVisible &&
            d.params.map((name, i) => (
              <span
                key={i}
                className="well-param-name"
                style={{
                  top:
                    wellParamTop(i, d.params.length, frameHeight) -
                    DECL_HEADER_H -
                    WELL_MARGIN,
                }}
              >
                {name}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function ClassHeaderView({ data, selected, id }: NodeProps) {
  const d = data as NodeData;
  const actions = useNodeActions();
  const threadMode = useEdgeMode("thread");
  const returnsMode = useEdgeMode("returns");
  const callsMode = useEdgeMode("calls");
  const refMode = useEdgeMode("ref");
  const expanded = !!d.expanded;
  const nodeId = d.nodeId ?? id;
  const extendsText =
    d.refCaption ?? (d.extends ? `extends ${d.extends}` : "no superclass");
  const inVisible = threadMode === "lines" || callsMode === "lines";
  const outVisible = threadMode === "lines" || returnsMode === "lines";
  return (
    <div
      className={`struct-node class-header ${KIND_CLASS.class} ${selected ? "selected" : ""} ${expanded ? "expanded-decl" : ""} ${d.expandable ? "has-action" : ""}`}
      style={expanded ? { width: "100%", height: "100%" } : undefined}
    >
      <FlowHandles step={d.flowStep} />
      {d.expandable && (
        <NodeCornerAction
          title={expanded ? "Condense" : "Expand"}
          onClick={() => actions.toggleExpand(nodeId)}
        >
          <IconExpand condensed={!expanded} />
        </NodeCornerAction>
      )}
      <Handle
        type="target"
        position={Position.Left}
        className={handleCls(inVisible)}
        id="in"
      />
      {threadMode === "labels" && (
        <PortLabel
          text={portName(d, "in", "in")}
          className="port-label-in"
          style={{ left: -4, top: "50%" }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(outVisible)}
        id="out"
      />
      {(threadMode === "labels" || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "out", "out")}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      <Handle
        type="source"
        position={Position.Top}
        className={handleCls(refMode === "lines", "handle-ref")}
        id="ref"
        title={d.extends ? `extends ${d.extends}` : "definition link"}
        style={d.extends ? { left: "28%" } : undefined}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        className={handleCls(refMode === "lines", "handle-ref")}
        id="ref"
        title="definition"
        style={d.extends ? { left: "72%" } : undefined}
      />
      <div className="decl-header">
        <KindTitle kind="class" label={d.label} />
        {refMode === "labels" && (
          <div className={`struct-ref-caption ${d.extends ? "" : "muted"}`}>
            {extendsText}
          </div>
        )}
        {refMode === "lines" && (
          <div className={`struct-extends ${d.extends ? "" : "muted"}`}>{extendsText}</div>
        )}
      </div>
      {expanded && (
        <div className="expand-well" aria-hidden={false}>
          <WellFlowHandles inStep={d.flowWellInStep} outStep={d.flowWellOutStep} />
        </div>
      )}
    </div>
  );
}

function MethodBlockView({ data, selected, id }: NodeProps) {
  const d = data as NodeData;
  const actions = useNodeActions();
  const show = useShowEdge();
  const threadMode = useEdgeMode("thread");
  const returnsMode = useEdgeMode("returns");
  const refMode = useEdgeMode("ref");
  const paramMode = useEdgeMode("param");
  const kindLabel = d.memberKind ?? "method";
  const nodeId = d.nodeId ?? id;
  const expanded = !!d.expanded;
  const frameHeight = d.frameHeight ?? 0;
  const paramVisible = paramMode === "lines" || threadMode === "lines";
  const mountParams = d.params.length > 0 && (show("param") || threadMode !== "hidden");
  const outVisible = threadMode === "lines" || returnsMode === "lines";
  const showThreadLabels = threadMode === "labels";
  return (
    <div
      className={`struct-node method-block ${KIND_CLASS.method} ${selected ? "selected" : ""} member-${kindLabel} ${d.expandable ? "has-action" : ""} ${expanded ? "expanded-decl" : ""}`}
      style={expanded ? { width: "100%", height: "100%" } : undefined}
    >
      <FlowHandles step={d.flowStep} />
      {d.expandable && (
        <NodeCornerAction
          title={expanded ? "Condense" : "Expand"}
          onClick={() => actions.toggleExpand(nodeId)}
        >
          <IconExpand condensed={!expanded} />
        </NodeCornerAction>
      )}
      {expanded && mountParams && (
        <WellParamHandles
          params={d.params}
          frameHeight={frameHeight}
          visible={paramVisible}
        />
      )}
      {expanded && threadMode !== "hidden" && (
        <WellReturnHandle frameHeight={frameHeight} visible={threadMode === "lines"} />
      )}
      {expanded && (showThreadLabels || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "return", "return")}
          className="port-label-return"
          style={{
            top: Math.max(frameHeight - WELL_MARGIN - 24, DECL_HEADER_H + 40),
            right: -4,
            transform: "translate(100%, -50%)",
          }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(outVisible, "handle-out")}
        id="out"
        title="output"
      />
      {(showThreadLabels || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "out", "out")}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      <Handle
        type="target"
        position={Position.Bottom}
        className={handleCls(refMode === "lines", "handle-ref")}
        id="ref"
      />
      <div className="decl-header">
        <KindTitle
          kind="method"
          label={d.label}
          memberKind={d.memberKind}
          async={d.async}
          generator={d.generator}
          isStatic={d.static}
        />
        {!expanded && d.params.length > 0 && (
          <div className="struct-params">
            {d.params.map((p, i) => (
              <span key={i} className="param-chip">
                {p}
              </span>
            ))}
          </div>
        )}
        {!expanded && d.returnsLabel && (
          <div className="struct-returns">→ {d.returnsLabel}</div>
        )}
      </div>
      {expanded && (
        <div className="expand-well">
          <WellFlowHandles inStep={d.flowWellInStep} outStep={d.flowWellOutStep} />
          {paramVisible &&
            d.params.map((name, i) => (
              <span
                key={i}
                className="well-param-name"
                style={{
                  top:
                    wellParamTop(i, d.params.length, frameHeight) -
                    DECL_HEADER_H -
                    WELL_MARGIN,
                }}
              >
                {name}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function BindingNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const threadMode = useEdgeMode("thread");
  const isProp = d.bindingKind === "prop";
  const threadLines = threadMode === "lines";
  return (
    <div
      className={`struct-node kind-binding ${isProp ? "kind-prop" : ""} ${d.pattern ? "kind-pattern" : ""} ${d.slotOf ? "kind-slot" : ""} ${selected ? "selected" : ""} ${d.hasThis ? "has-this" : ""}`}
    >
      <FlowHandles step={d.flowStep} />
      <Handle
        type="target"
        position={Position.Top}
        className={handleCls(threadLines)}
        id="in"
        title="in"
      />
      {threadMode === "labels" && (
        <PortLabel
          text={portName(d, "in", "in")}
          className="port-label-in-top"
          style={{ top: -2, left: "50%" }}
        />
      )}
      <KindTitle
        kind="binding"
        label={d.label}
        bindingKind={d.bindingKind}
        receiver={d.receiver}
        isStatic={d.static}
      />
      {d.pattern && d.params.length > 0 && (
        <div className="struct-params">
          {d.params.map((p, i) => (
            <span key={i} className="param-chip">
              {p}
            </span>
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={handleCls(threadLines, "handle-binding-out")}
        id="out"
        title="out"
      />
      {threadMode === "labels" && (
        <PortLabel
          text={portName(d, "out", d.label)}
          className="port-label-out-bottom"
          style={{ bottom: -2, left: "50%" }}
        />
      )}
    </div>
  );
}

/** Import parked on the left of the file graph. */
function ImportRailView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const actions = useNodeActions();
  const refMode = useEdgeMode("ref");
  const threadMode = useEdgeMode("thread");
  const returnsMode = useEdgeMode("returns");
  const callsMode = useEdgeMode("calls");
  const outVisible =
    threadMode === "lines" || returnsMode === "lines" || callsMode === "lines";
  return (
    <div
      className={`struct-node rail-block import-rail ${KIND_CLASS.import} ${selected ? "selected" : ""} has-action`}
    >
      {d.importSource && (
        <NodeCornerAction
          title={`Open ${d.importSource}`}
          onClick={() => actions.openImport(d.importSource!)}
        >
          <IconOpenFile />
        </NodeCornerAction>
      )}
      <Handle
        type="target"
        position={Position.Right}
        className={handleCls(refMode === "lines", "handle-ref")}
        id="ref"
        title="definition"
      />
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(outVisible, "handle-out")}
        id="out"
        title="used in module"
      />
      {(threadMode === "labels" || returnsMode === "labels") && (
        <PortLabel
          text={portName(d, "out", d.label)}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      <KindTitle kind="import" label={d.label} />
      {d.importSource && (
        <div className="struct-returns rail-meta">{d.importSource}</div>
      )}
    </div>
  );
}

/** Export parked on the right of the file graph. */
function ExportRailView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const returnsMode = useEdgeMode("returns");
  const threadMode = useEdgeMode("thread");
  const portVisible = returnsMode === "lines" || threadMode === "lines";
  return (
    <div
      className={`struct-node rail-block export-rail ${KIND_CLASS.export} ${selected ? "selected" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={handleCls(portVisible)}
        id="in"
        title="exported value"
      />
      {(returnsMode === "labels" || threadMode === "labels") && (
        <PortLabel
          text={portName(d, "in", d.label)}
          className="port-label-in"
          style={{ left: -4, top: "50%" }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(portVisible, "handle-out")}
        id="out"
        title="outside module"
      />
      <KindTitle kind="export" label={d.label} />
      {d.importSource && (
        <div className="struct-returns rail-meta">from {d.importSource}</div>
      )}
    </div>
  );
}

function CallNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const show = useShowEdge();
  const threadMode = useEdgeMode("thread");
  const refMode = useEdgeMode("ref");
  const paramMode = useEdgeMode("param");
  const leftCount = d.params.length + (d.hasRestParam ? 1 : 0);
  const paramVisible = paramMode === "lines" || threadMode === "lines";
  const mountParams =
    (d.params.length > 0 || d.hasRestParam) &&
    (show("param") || threadMode !== "hidden");
  const threadLines = threadMode === "lines";
  return (
    <div
      className={`struct-node kind-call ${selected ? "selected" : ""} ${d.hasThis ? "has-this" : ""}`}
      style={leftCount > 2 ? { minHeight: 28 + leftCount * 18 } : undefined}
      title="Double-click to jump to definition"
    >
      <FlowHandles step={d.flowStep} />
      {d.hasThis && <CallThisHandle label={d.receiver} visible={threadLines} />}
      {d.hasThis && threadMode === "labels" && (
        <PortLabel
          text={portName(d, "this", d.receiver === "this" || !d.receiver ? "this" : d.receiver)}
          className="port-label-this"
          style={{ left: 10, top: -2 }}
        />
      )}
      {!d.hasThis && (
        <Handle
          type="target"
          position={Position.Left}
          className={handleCls(threadLines)}
          id="in"
          title="callee / input"
          style={{ top: "50%" }}
        />
      )}
      {threadMode === "labels" && !d.hasThis && (
        <PortLabel
          text={portName(d, "in", "in")}
          className="port-label-in"
          style={{ left: -4, top: "50%" }}
        />
      )}
      {mountParams && (
        <CallParamHandles
          params={d.params}
          visible={paramVisible}
          hasRest={!!d.hasRestParam}
        />
      )}
      {threadMode === "labels" &&
        d.params.map((name, i) => (
          <PortLabel
            key={`pl:${i}`}
            text={portName(d, `param:${i}`, name)}
            className="port-label-param"
            style={{ left: -4, top: handleTop(i, leftCount) }}
          />
        ))}
      {threadMode === "labels" && d.hasRestParam && (
        <PortLabel
          text={portName(d, "param:rest", "…")}
          className="port-label-param"
          style={{ left: -4, top: handleTop(d.params.length, leftCount) }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(threadLines, "handle-out")}
        id="out"
        title="return value"
      />
      {threadMode === "labels" && (
        <PortLabel
          text={portName(d, "out", "out")}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      <Handle
        type="source"
        position={Position.Top}
        className={handleCls(refMode === "lines", "handle-ref")}
        id="ref"
        style={d.hasThis ? { left: "72%" } : undefined}
      />
      <KindTitle
        kind="call"
        label={d.label}
        receiver={d.receiver}
        hasOptional={d.hasOptional}
      />
      {d.importSource && (
        <div className="struct-returns rail-meta">{d.importSource}</div>
      )}
      {refMode === "labels" && d.refCaption && (
        <div className="struct-ref-caption">{d.refCaption}</div>
      )}
    </div>
  );
}

/** Inline equation / template / operator — inputs on left, single return on right. */
function ExpressionNodeView({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const threadMode = useEdgeMode("thread");
  const n = d.params.length;
  const threadLines = threadMode === "lines";
  return (
    <div
      className={`struct-node kind-expression ${selected ? "selected" : ""} ${d.hasThis ? "has-this" : ""}`}
      style={n > 2 ? { minHeight: 28 + n * 18 } : undefined}
      title={d.label}
    >
      <FlowHandles step={d.flowStep} />
      {d.params.map((name, i) => (
        <Handle
          key={`in:${i}`}
          type="target"
          position={Position.Left}
          id={`in:${i}`}
          className={handleCls(threadLines, "handle-param")}
          style={{ top: handleTop(i, n) }}
          title={name}
        />
      ))}
      {threadMode === "labels" &&
        d.params.map((name, i) => (
          <PortLabel
            key={`pl:${i}`}
            text={portName(d, `in:${i}`, name)}
            className="port-label-param"
            style={{ left: -4, top: handleTop(i, n) }}
          />
        ))}
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls(threadLines, "handle-out")}
        id="out"
        title="return"
      />
      {threadMode === "labels" && (
        <PortLabel
          text={portName(d, "out", "out")}
          className="port-label-out"
          style={{ right: -4, top: "50%" }}
        />
      )}
      <KindTitle kind="expression" label={d.label} receiver={d.receiver} />
      {threadLines && n > 0 && (
        <div className="struct-params">
          {d.params.map((p, i) => (
            <span key={i} className="param-chip">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  structure: StructureNodeView,
  classHeader: ClassHeaderView,
  methodBlock: MethodBlockView,
  binding: BindingNodeView,
  call: CallNodeView,
  expression: ExpressionNodeView,
  importRail: ImportRailView,
  exportRail: ExportRailView,
};

function graphToNodeData(
  n: GraphNode,
  expanded: boolean,
  frameHeight?: number
): NodeData {
  return {
    label: n.label,
    kind: n.kind,
    params: n.params,
    returnsLabel: n.returnsLabel,
    loc: n.loc,
    extends: n.extends,
    stackOrder: n.stackOrder,
    memberKind: n.memberKind,
    stackClassId:
      (n.kind === "method" || (n.kind === "binding" && n.bindingKind === "prop")) &&
      n.parentId?.startsWith("class:")
        ? n.parentId
        : undefined,
    scopeId: n.scopeId,
    bindingKind: n.bindingKind,
    refId: n.refId,
    expandable: n.expandable,
    expanded: expanded && !!n.expandable,
    importSource: n.importSource,
    receiver: n.receiver,
    hasThis: n.hasThis,
    hasOptional: n.hasOptional,
    async: n.async,
    generator: n.generator,
    static: n.static,
    pattern: n.pattern,
    slotOf: n.slotOf,
    branchKind: n.branchKind,
    loopKind: n.loopKind,
    jsxTag: n.jsxTag,
    hasRestParam: n.hasRestParam,
    nodeId: n.id,
    frameHeight: expanded ? frameHeight : undefined,
  };
}

function refCaptionFor(n: GraphNode, graph: StructureGraph): string | undefined {
  if (n.kind === "class") {
    return n.extends ? `extends ${n.extends}` : "no superclass";
  }
  if (n.kind !== "call") return undefined;
  const methodName = n.label.replace(/\(\)$/, "");
  const def = n.refId ? graph.nodes.find((x) => x.id === n.refId) : undefined;
  if (!def) {
    if (n.receiver) return `${n.receiver}.${methodName}`;
    return undefined;
  }
  if (def.kind === "method") {
    const receiver = n.receiver ?? (n.hasThis ? "this" : undefined);
    if (receiver) return `${receiver}.${def.label}`;
    const cls = def.parentId
      ? graph.nodes.find((x) => x.id === def.parentId)
      : undefined;
    return cls ? `${cls.label}.${def.label}` : def.label;
  }
  if (def.kind === "class") return `class ${def.label}`;
  if (def.kind === "import" || def.kind === "external") return "global function";
  if (def.kind === "function" || def.kind === "arrow") return "local function";
  return undefined;
}

function setExtra(
  extras: Map<string, Partial<NodeData>>,
  id: string,
  patch: Partial<NodeData>
) {
  extras.set(id, { ...(extras.get(id) ?? {}), ...patch });
}

function putPortLabel(
  extras: Map<string, Partial<NodeData>>,
  nodeId: string,
  handle: string,
  label: string | undefined
) {
  if (!label || !handle) return;
  const prev = extras.get(nodeId)?.portLabels ?? {};
  // Prefer a concrete name over generic placeholders when colliding.
  const existing = prev[handle];
  if (
    existing &&
    existing !== "thread" &&
    existing !== "assign" &&
    (label === "thread" || label === "assign")
  ) {
    return;
  }
  setExtra(extras, nodeId, { portLabels: { ...prev, [handle]: label } });
}

/** Attach flow step indices, ref captions, and port labels for label display modes. */
function enrichNodeData(
  nodes: Node[],
  graph: StructureGraph,
  expanded: Set<string>
): Node[] {
  const extras = new Map<string, Partial<NodeData>>();
  for (const gn of graph.nodes) {
    const cap = refCaptionFor(gn, graph);
    if (cap) setExtra(extras, gn.id, { refCaption: cap });
  }

  for (const e of graph.edges) {
    if (e.kind !== "thread" && e.kind !== "returns") continue;
    const label = e.label?.trim() || undefined;
    putPortLabel(extras, e.source, e.sourceHandle ?? "out", label);
    putPortLabel(extras, e.target, e.targetHandle ?? "in", label);
  }

  const outFlow = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    if (e.kind !== "flow") continue;
    if (e.sourceHandle === "flow-out") outFlow.set(e.source, e);
  }

  const wellIns = graph.edges.filter(
    (e) => e.kind === "flow" && e.sourceHandle === "flow-well-in"
  );

  for (const wi of wellIns) {
    const scopeId = wi.source;
    if (scopeId !== MODULE_ID && !expanded.has(scopeId)) continue;
    let step = 1;
    let cur: string | undefined = wi.target;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      setExtra(extras, cur, { flowStep: step });
      step += 1;
      const next = outFlow.get(cur);
      if (!next) break;
      if (next.targetHandle === "flow-well-out" || next.target === scopeId) {
        setExtra(extras, scopeId, {
          flowWellInStep: 0,
          flowWellOutStep: step,
        });
        break;
      }
      cur = next.target;
    }
  }

  // Module body (no well): number flow-linked nodes from 0.
  const moduleBody = graph.nodes.filter(
    (n) =>
      n.scopeId === MODULE_ID &&
      n.id !== MODULE_ID &&
      n.kind !== "import" &&
      n.kind !== "export" &&
      n.kind !== "external" &&
      n.kind !== "module"
  );
  const ordered = orderByExecution(moduleBody, graph.edges).filter((n) => {
    return graph.edges.some(
      (e) => e.kind === "flow" && (e.source === n.id || e.target === n.id)
    );
  });
  let m = 0;
  for (const n of ordered) {
    if (extras.get(n.id)?.flowStep != null) continue;
    setExtra(extras, n.id, { flowStep: m });
    m += 1;
  }

  return nodes.map((n) => {
    const extra = extras.get(n.id);
    if (!extra) return n;
    return { ...n, data: { ...(n.data as NodeData), ...extra } };
  });
}

function portName(d: NodeData, handle: string, fallback: string): string {
  return d.portLabels?.[handle] ?? fallback;
}

function isDeclKind(kind: NodeKind): boolean {
  return (
    kind === "function" ||
    kind === "arrow" ||
    kind === "method" ||
    kind === "branch" ||
    kind === "loop" ||
    kind === "try" ||
    kind === "jsx" ||
    kind === "fragment"
  );
}

function isClassStackMember(n: GraphNode): boolean {
  return (
    n.parentId?.startsWith("class:") === true &&
    (n.kind === "method" || (n.kind === "binding" && n.bindingKind === "prop"))
  );
}

function isLayoutBodyNode(n: GraphNode): boolean {
  if (n.slotOf) return false;
  if (isClassStackMember(n)) return false;
  return (
    n.kind === "binding" ||
    n.kind === "call" ||
    n.kind === "expression" ||
    n.kind === "throw" ||
    n.kind === "class" ||
    (isDeclKind(n.kind) && !!n.expandable)
  );
}

function edgeStyle(kind: GraphEdge["kind"]): React.CSSProperties {
  switch (kind) {
    case "flow":
      return {
        stroke: "var(--edge-flow)",
        strokeWidth: 1.75,
        strokeDasharray: "5 4",
      };
    case "ref":
      return { stroke: "var(--edge-ref)", strokeWidth: 1.5, strokeDasharray: "6 3" };
    case "thread":
      return { stroke: "var(--edge-thread)", strokeWidth: 2 };
    case "returns":
      return { stroke: "var(--edge-returns)" };
    case "param":
      return { stroke: "var(--edge-param)" };
    default:
      return { stroke: "var(--edge-calls)" };
  }
}

/** Offset red square (lines) or step number (labels): flow enters top, exits bottom.
 * Handles stay mounted in every mode so React Flow can reconnect when toggling lines on.
 */
function FlowHandles({ step }: { step?: number }) {
  const mode = useEdgeMode("flow");
  const ghost = mode !== "lines";
  return (
    <div
      className={`flow-port nodrag nopan ${mode === "labels" ? "flow-port-numbered" : ""} ${mode === "hidden" ? "flow-port-ghost" : ""}`}
      aria-hidden
    >
      {mode === "lines" && (
        <>
          <span className="flow-square" />
          <span className="flow-stub-line" />
        </>
      )}
      {mode === "labels" && <span className="flow-step">{step ?? "·"}</span>}
      <Handle
        type="target"
        position={Position.Top}
        id="flow-in"
        className={`handle handle-flow handle-flow-in ${ghost ? "handle-ghost" : ""}`}
        title="worker flow in"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="flow-out"
        className={`handle handle-flow handle-flow-out ${ghost ? "handle-ghost" : ""}`}
        title="worker flow out"
      />
    </div>
  );
}

/** Expanded well: entry on top border, exit on bottom (aligned near left). */
function WellFlowHandles({
  inStep,
  outStep,
}: {
  inStep?: number;
  outStep?: number;
}) {
  const mode = useEdgeMode("flow");
  const ghost = mode !== "lines";
  return (
    <>
      {mode === "labels" && (
        <>
          <span className="flow-well-step flow-well-step-in">{inStep ?? 0}</span>
          <span className="flow-well-step flow-well-step-out">{outStep ?? "·"}</span>
        </>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        id="flow-well-in"
        className={`handle handle-flow-well handle-flow-well-in ${ghost ? "handle-ghost" : ""}`}
        style={{ top: 0, left: 20, right: "auto", bottom: "auto" }}
        title="worker flow enter"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="flow-well-out"
        className={`handle handle-flow-well handle-flow-well-out ${ghost ? "handle-ghost" : ""}`}
        style={{ top: "auto", bottom: 0, left: 20, right: "auto" }}
        title="worker flow exit"
      />
    </>
  );
}

function PortLabel({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`port-label ${className ?? ""}`} style={style} title={text}>
      {text}
    </span>
  );
}

const COLLIDE_MARGIN = 24;
const PARENT_FIT_PAD = 16;

function nodeBoxSize(n: Node): { w: number; h: number } {
  const style = n.style ?? {};
  const rawW = style.width ?? style.minWidth;
  const rawH = style.height;
  let w =
    typeof rawW === "number"
      ? rawW
      : typeof rawW === "string"
        ? parseFloat(rawW)
        : NaN;
  let h =
    typeof rawH === "number"
      ? rawH
      : typeof rawH === "string"
        ? parseFloat(rawH)
        : NaN;
  if (!Number.isFinite(w)) {
    if (n.type === "classHeader") {
      w = (n.data as NodeData).expanded ? Math.max(STACK_W + STACK_PAD * 2 + 40, 320) : NODE_W;
    } else if (n.type === "expression") {
      const label = (n.data as NodeData).label ?? "";
      w = Math.min(280, Math.max(NODE_W, label.length * 7));
    } else w = NODE_W;
  }
  if (!Number.isFinite(h)) {
    if (n.type === "classHeader") {
      h = (n.data as NodeData).expanded ? DECL_HEADER_H + 160 : NODE_H;
    } else h = NODE_H;
  }
  return { w, h };
}

type Box = { id: string; x: number; y: number; w: number; h: number };

function boxesCollide(a: Box, b: Box, margin: number): boolean {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  );
}

/** Pack peer nodes (same parent) so AABBs do not overlap; slide down or right. */
function packPeerGroup(nodes: Map<string, Node>, ids: string[]): void {
  if (ids.length < 2) return;

  const order = [...ids].sort((a, b) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    if (na.position.y !== nb.position.y) return na.position.y - nb.position.y;
    if (na.position.x !== nb.position.x) return na.position.x - nb.position.x;
    return a.localeCompare(b);
  });

  for (let i = 1; i < order.length; i++) {
    const id = order[i]!;
    const n = nodes.get(id)!;
    let { w, h } = nodeBoxSize(n);
    let x = n.position.x;
    let y = n.position.y;
    let guard = 0;
    while (guard++ < order.length * 4) {
      const self: Box = { id, x, y, w, h };
      let moved = false;
      for (let j = 0; j < i; j++) {
        const otherId = order[j]!;
        const o = nodes.get(otherId)!;
        const os = nodeBoxSize(o);
        const other: Box = {
          id: otherId,
          x: o.position.x,
          y: o.position.y,
          w: os.w,
          h: os.h,
        };
        if (!boxesCollide(self, other, COLLIDE_MARGIN)) continue;
        const pushDown = other.y + other.h + COLLIDE_MARGIN - y;
        const pushRight = other.x + other.w + COLLIDE_MARGIN - x;
        // Prefer the smaller clear; ties go down (reading order).
        if (pushDown > 0 && (pushRight <= 0 || pushDown <= pushRight)) {
          y += pushDown;
        } else if (pushRight > 0) {
          x += pushRight;
        } else {
          y += Math.max(pushDown, COLLIDE_MARGIN);
        }
        moved = true;
        break;
      }
      if (!moved) break;
    }
    nodes.set(id, {
      ...n,
      position: { x, y },
    });
  }
}

function growParentToFitChildren(nodes: Map<string, Node>, parentId: string): void {
  const parent = nodes.get(parentId);
  if (!parent) return;
  // Class stacks are sized by restack; only grow expand frames / structure parents.
  if (parent.type === "classHeader") return;

  const children = [...nodes.values()].filter((n) => n.parentId === parentId);
  if (!children.length) return;

  let maxR = 0;
  let maxB = 0;
  for (const c of children) {
    const { w, h } = nodeBoxSize(c);
    maxR = Math.max(maxR, c.position.x + w);
    maxB = Math.max(maxB, c.position.y + h);
  }

  const pad = PARENT_FIT_PAD;
  const cur = nodeBoxSize(parent);
  const nextW = Math.max(cur.w, maxR + pad);
  const nextH = Math.max(cur.h, maxB + pad);
  if (nextW === cur.w && nextH === cur.h) return;

  const data = parent.data as NodeData;
  nodes.set(parentId, {
    ...parent,
    style: {
      ...parent.style,
      width: nextW,
      height: nextH,
    },
    data: {
      ...data,
      frameHeight: data.expanded ? nextH : data.frameHeight,
    },
  });
}

function parentDepth(nodes: Map<string, Node>, parentKey: string): number {
  if (!parentKey) return -1;
  let d = 0;
  let pid: string | undefined = parentKey;
  while (pid) {
    d += 1;
    pid = nodes.get(pid)?.parentId;
  }
  return d;
}

/**
 * After deterministic layout: resolve peer overlaps (same parentId) by sliding
 * down/right, then grow expanded parents to fit. Does not run on user drag.
 */
function resolvePeerCollisions(nodes: Node[]): Node[] {
  const map = new Map(nodes.map((n) => [n.id, { ...n, position: { ...n.position } }]));

  const groupIds = new Map<string, string[]>();
  for (const n of map.values()) {
    // Methods inside a class stack are vertically packed by restackAll.
    const parent = n.parentId ? map.get(n.parentId) : undefined;
    if (n.type === "methodBlock" && parent?.type === "classHeader") continue;
    // Import/export rails stay on the module border — don't pack with body peers.
    if (n.type === "importRail" || n.type === "exportRail") continue;

    const key = n.parentId ?? "";
    const list = groupIds.get(key) ?? [];
    list.push(n.id);
    groupIds.set(key, list);
  }

  const keys = [...groupIds.keys()].sort(
    (a, b) => parentDepth(map, b) - parentDepth(map, a)
  );

  // Deepest groups first so parents grow before their siblings are packed.
  for (let pass = 0; pass < 2; pass++) {
    for (const key of keys) {
      packPeerGroup(map, groupIds.get(key) ?? []);
      if (key) growParentToFitChildren(map, key);
    }
    // Expanded methods may have grown — refresh class stack heights, then
    // rebuild peer groups for the next pass (parent sizes changed).
    let stacked = restackAll([...map.values()]);
    for (const n of stacked) map.set(n.id, { ...n, position: { ...n.position } });
  }

  // Final peer pack after class restack (push neighbors of taller stacks).
  for (const key of keys) {
    packPeerGroup(map, groupIds.get(key) ?? []);
    if (key) growParentToFitChildren(map, key);
  }

  return [...map.values()];
}

function applyClassFrame(nodes: Node[], classId: string): Node[] {
  const classNode = nodes.find((n) => n.id === classId);
  const classExpanded = !!(classNode?.data as NodeData | undefined)?.expanded;
  const members = nodes
    .filter((n) => {
      if (n.parentId !== classId) return false;
      const d = n.data as NodeData;
      return d.kind === "method" || (d.kind === "binding" && d.bindingKind === "prop");
    })
    .sort((a, b) => a.position.y - b.position.y);

  if (!classExpanded) {
    return nodes.map((n) => {
      if (n.id !== classId) return n;
      return {
        ...n,
        style: {
          ...n.style,
          width: NODE_W,
          height: NODE_H,
        },
        className: undefined,
      };
    });
  }

  let y = BODY_Y0;
  const placed: { id: string; y: number; h: number }[] = [];
  for (const m of members) {
    const expanded = !!(m.data as NodeData).expanded;
    const { h } = nodeBoxSize(m);
    const useH = expanded ? Math.max(h, MEMBER_H) : MEMBER_H;
    placed.push({ id: m.id, y, h: useH });
    y += useH + MEMBER_GAP;
  }
  const frameH = Math.max(y + WELL_MARGIN + STACK_PAD, DECL_HEADER_H + 160);
  const frameW = Math.max(STACK_W + STACK_PAD * 2 + 40, 320);

  return nodes.map((n) => {
    if (n.id === classId) {
      return {
        ...n,
        className: "expand-frame",
        style: {
          ...n.style,
          width: frameW,
          height: frameH,
        },
        data: {
          ...(n.data as NodeData),
          expanded: true,
          frameHeight: frameH,
        },
      };
    }
    const slot = placed.find((p) => p.id === n.id);
    if (!slot) return n;
    const idx = placed.findIndex((p) => p.id === n.id);
    return {
      ...n,
      parentId: classId,
      position: { x: WELL_MARGIN + 12, y: slot.y },
      data: {
        ...(n.data as NodeData),
        stackOrder: idx,
        stackClassId: classId,
        kind: "method" as NodeKind,
      },
      type: "methodBlock",
      draggable: true,
    };
  });
}

function restackAll(nodes: Node[]): Node[] {
  let next = nodes;
  for (const cls of nodes.filter((n) => n.type === "classHeader")) {
    next = applyClassFrame(next, cls.id);
  }
  return next;
}

function absPos(node: Node, byId: Map<string, Node>): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let pid = node.parentId;
  while (pid) {
    const p = byId.get(pid);
    if (!p) break;
    x += p.position.x;
    y += p.position.y;
    pid = p.parentId;
  }
  return { x, y };
}

function nodeCenterAbs(node: Node, byId: Map<string, Node>): { x: number; y: number } {
  const { x, y } = absPos(node, byId);
  const { w, h } = nodeBoxSize(node);
  return { x: x + w / 2, y: y + h / 2 };
}

/** Node whose center is closest to a flow-space point (skips rails). */
function closestNodeToFlowPoint(
  nodes: Node[],
  flowX: number,
  flowY: number
): { id: string; offsetX: number; offsetY: number } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { id: string; dist: number; offsetX: number; offsetY: number } | null = null;
  for (const n of nodes) {
    if (n.type === "importRail" || n.type === "exportRail") continue;
    const c = nodeCenterAbs(n, byId);
    const dx = c.x - flowX;
    const dy = c.y - flowY;
    const dist = dx * dx + dy * dy;
    if (!best || dist < best.dist) {
      best = { id: n.id, dist, offsetX: dx, offsetY: dy };
    }
  }
  return best ? { id: best.id, offsetX: best.offsetX, offsetY: best.offsetY } : null;
}

const LAYOUT_TWEEN_MS = 380;

function findInsertClass(
  nodes: Node[],
  abs: { x: number; y: number },
  excludeId?: string
): string | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const cls of nodes.filter((n) => n.type === "classHeader" && n.id !== excludeId)) {
    // Only expanded classes show members / accept stack inserts.
    if (!(cls.data as NodeData).expanded) continue;
    const p = absPos(cls, byId);
    const w = Number(cls.style?.width ?? STACK_W);
    const h = Number(cls.style?.height ?? stackHeight(0));
    if (
      abs.x >= p.x - INSERT_PAD &&
      abs.x <= p.x + w + INSERT_PAD &&
      abs.y >= p.y - INSERT_PAD &&
      abs.y <= p.y + h + INSERT_PAD
    ) {
      return cls.id;
    }
  }
  return undefined;
}

function nodeTypeFor(n: GraphNode): string {
  if (n.kind === "binding") return "binding";
  if (n.kind === "call") return "call";
  if (n.kind === "expression") return "expression";
  if (n.kind === "class") return "classHeader";
  if (n.kind === "method") return "methodBlock";
  return "structure";
}

function exprMinWidth(n: GraphNode): number {
  return Math.min(280, Math.max(NODE_W, n.label.length * 7));
}

function classFrameSize(
  graph: StructureGraph,
  cls: GraphNode,
  expanded: Set<string>
): { width: number; height: number } {
  if (!expanded.has(cls.id)) {
    return { width: NODE_W, height: NODE_H };
  }
  const members = graph.nodes
    .filter((m) => isClassStackMember(m) && m.parentId === cls.id)
    .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
  let y = BODY_Y0;
  for (const m of members) {
    if (m.kind === "method" && expanded.has(m.id)) {
      const size = expandFrameSize(graph, m.id, expanded);
      y += Math.max(size.height, MEMBER_H) + MEMBER_GAP;
    } else {
      y += MEMBER_H + MEMBER_GAP;
    }
  }
  return {
    width: Math.max(STACK_W + STACK_PAD * 2 + 40, 320),
    height: Math.max(y + WELL_MARGIN + STACK_PAD, DECL_HEADER_H + 160),
  };
}

function layoutClassWithMembers(
  graph: StructureGraph,
  cls: GraphNode,
  expanded: Set<string>,
  position: { x: number; y: number },
  asChildrenOf: string | undefined,
  viewMode: ViewMode
): Node[] {
  const classOpen = expanded.has(cls.id);
  const size = classFrameSize(graph, cls, expanded);
  const out: Node[] = [
    {
      id: cls.id,
      type: "classHeader",
      parentId: asChildrenOf,
      position,
      data: graphToNodeData(cls, classOpen, size.height),
      style: {
        width: size.width,
        height: size.height,
      },
      className: classOpen ? "expand-frame" : undefined,
      draggable: true,
    },
  ];

  if (!classOpen) return out;

  const members = graph.nodes
    .filter((m) => isClassStackMember(m) && m.parentId === cls.id)
    .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
  const memberX = WELL_MARGIN + 12;
  let y = BODY_Y0;

  members.forEach((m) => {
    if (m.kind === "method") {
      const isExp = expanded.has(m.id);
      if (isExp) {
        const mSize = expandFrameSize(graph, m.id, expanded);
        const gutter =
          WELL_MARGIN + 8 + (m.params.length > 0 ? PARAM_RAIL : 12);
        out.push({
          id: m.id,
          type: "methodBlock",
          parentId: cls.id,
          position: { x: memberX, y },
          data: graphToNodeData(m, true, mSize.height),
          style: { width: mSize.width, height: mSize.height },
          className: "expand-frame",
          draggable: true,
        });
        out.push(
          ...layoutScopeContents(
            graph,
            m.id,
            expanded,
            { x: 0, y: 0 },
            m.id,
            gutter,
            viewMode
          )
        );
        y += Math.max(mSize.height, MEMBER_H) + MEMBER_GAP;
      } else {
        out.push({
          id: m.id,
          type: "methodBlock",
          parentId: cls.id,
          position: { x: memberX, y },
          data: graphToNodeData(m, false),
          draggable: true,
        });
        y += MEMBER_H + MEMBER_GAP;
      }
    } else {
      out.push({
        id: m.id,
        type: "binding",
        parentId: cls.id,
        position: { x: memberX, y },
        data: graphToNodeData(m, false),
        draggable: true,
      });
      y += MEMBER_H + MEMBER_GAP;
    }
  });
  return out;
}

/** Place a non-class body/decl node (collapsed). */
function plainNode(
  n: GraphNode,
  position: { x: number; y: number },
  asChildrenOf?: string,
  expanded = false
): Node {
  const base: Node = {
    id: n.id,
    type: nodeTypeFor(n),
    parentId: asChildrenOf,
    position,
    data: graphToNodeData(n, expanded),
    draggable: true,
  };
  if (n.kind === "expression") {
    base.style = { minWidth: exprMinWidth(n) };
  }
  return base;
}

function layoutScopeExecution(
  graph: StructureGraph,
  scopeId: string,
  expanded: Set<string>,
  asChildrenOf: string | undefined,
  leftGutter: number,
  viewMode: ViewMode
): Node[] {
  const inScope = graph.nodes.filter((n) => n.scopeId === scopeId && n.id !== scopeId);
  const candidates = inScope.filter(isLayoutBodyNode);
  const ordered = orderByExecution(candidates, graph.edges);

  const out: Node[] = [];
  let y = asChildrenOf ? BODY_Y0 : 24;
  const x0 = asChildrenOf ? leftGutter : 24;

  for (const n of ordered) {
    if (n.kind === "class") {
      const chunk = layoutClassWithMembers(
        graph,
        n,
        expanded,
        { x: x0, y },
        asChildrenOf,
        viewMode
      );
      out.push(...chunk);
      const h = Number(chunk[0]?.style?.height ?? NODE_H);
      y += h + 28;
      continue;
    }
    if (isDeclKind(n.kind) && n.expandable && expanded.has(n.id)) {
      const size = expandFrameSize(graph, n.id, expanded);
      const gutter =
        WELL_MARGIN + 8 + (n.params.length > 0 ? PARAM_RAIL : 12);
      out.push({
        id: n.id,
        type: "structure",
        parentId: asChildrenOf,
        position: { x: x0, y },
        data: graphToNodeData(n, true, size.height),
        style: { width: size.width, height: size.height },
        className: "expand-frame",
        draggable: true,
      });
      out.push(
        ...layoutScopeContents(
          graph,
          n.id,
          expanded,
          { x: 0, y: 0 },
          n.id,
          gutter,
          viewMode
        )
      );
      y += size.height + 28;
      continue;
    }
    if (n.pattern) {
      const slots = graph.nodes
        .filter((s) => s.slotOf === n.id)
        .sort((a, b) => locKey(a) - locKey(b) || a.id.localeCompare(b.id));
      const nestH = NODE_H + slots.length * 40 + 12;
      out.push({
        id: n.id,
        type: "binding",
        parentId: asChildrenOf,
        position: { x: x0, y },
        data: graphToNodeData(n, false),
        style: { width: NODE_W + 24, height: nestH },
        className: "expand-frame",
        draggable: true,
      });
      slots.forEach((s, i) => {
        out.push({
          id: s.id,
          type: "binding",
          parentId: n.id,
          position: { x: 10, y: NODE_H - 8 + i * 40 },
          data: graphToNodeData(s, false),
          style: { width: NODE_W - 8, height: 36 },
          draggable: true,
        });
      });
      y += nestH + 20;
      continue;
    }
    out.push(plainNode(n, { x: x0, y }, asChildrenOf, false));
    y += NODE_H + 20;
  }
  return out;
}

/**
 * Variable view: defs along top; value-flow chains as rows (producer on the right →
 * consumer on the left). Independent blocks/components start new rows.
 */
function layoutScopeVariable(
  graph: StructureGraph,
  scopeId: string,
  expanded: Set<string>,
  asChildrenOf: string | undefined,
  leftGutter: number,
  viewMode: ViewMode
): Node[] {
  const inScope = graph.nodes.filter((n) => n.scopeId === scopeId && n.id !== scopeId);
  const defs = inScope
    .filter(
      (n) =>
        n.kind === "class" ||
        (isDeclKind(n.kind) && n.expandable)
    )
    .sort((a, b) => locKey(a) - locKey(b));
  const body = inScope.filter(
    (n) =>
      isLayoutBodyNode(n) &&
      n.kind !== "class" &&
      !(isDeclKind(n.kind) && n.expandable)
  );

  const out: Node[] = [];
  const x0 = asChildrenOf ? leftGutter : 24;
  let x = x0;
  const topY = asChildrenOf ? DECL_ROW_Y : 24;

  for (const d of defs) {
    if (d.kind === "class") {
      const chunk = layoutClassWithMembers(
        graph,
        d,
        expanded,
        { x, y: topY },
        asChildrenOf,
        viewMode
      );
      out.push(...chunk);
      const w = Number(chunk[0]?.style?.width ?? NODE_W);
      x += w + (expanded.has(d.id) ? 48 : 28);
      continue;
    }
    if (expanded.has(d.id) && d.expandable) {
      const size = expandFrameSize(graph, d.id, expanded);
      const gutter =
        WELL_MARGIN + 8 + (d.params.length > 0 ? PARAM_RAIL : 12);
      out.push({
        id: d.id,
        type: "structure",
        parentId: asChildrenOf,
        position: { x, y: topY },
        data: graphToNodeData(d, true, size.height),
        style: { width: size.width, height: size.height },
        className: "expand-frame",
        draggable: true,
      });
      out.push(
        ...layoutScopeContents(
          graph,
          d.id,
          expanded,
          { x: 0, y: 0 },
          d.id,
          gutter,
          viewMode
        )
      );
      x += size.width + 48;
    } else {
      out.push(plainNode(d, { x, y: topY }, asChildrenOf));
      x += NODE_W + 28;
    }
  }

  // Thread connectivity among body nodes
  const bodyIds = new Set(body.map((n) => n.id));
  const adj = new Map<string, Set<string>>();
  const directed: { s: string; t: string }[] = [];
  for (const id of bodyIds) adj.set(id, new Set());
  for (const e of graph.edges) {
    if (e.kind !== "thread") continue;
    if (!bodyIds.has(e.source) || !bodyIds.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
    directed.push({ s: e.source, t: e.target });
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of bodyIds) {
    if (seen.has(id)) continue;
    const stack = [id];
    const comp: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    components.push(comp);
  }

  // Stable order components by earliest loc
  const byId = new Map(body.map((n) => [n.id, n]));
  components.sort((a, b) => {
    const la = Math.min(...a.map((id) => locKey(byId.get(id)!)));
    const lb = Math.min(...b.map((id) => locKey(byId.get(id)!)));
    return la - lb;
  });

  let rowY =
    topY +
    (defs.length
      ? Math.max(
          NODE_H + 48,
          ...out
            .filter((n) => !n.parentId || n.parentId === asChildrenOf)
            .map((n) => {
              const h = Number(n.style?.height ?? NODE_H);
              return n.position.y + h - topY + 48;
            })
        )
      : 0);

  for (const comp of components) {
    // Topological order (sources first), then reverse so sources sit on the right.
    const indeg = new Map(comp.map((id) => [id, 0]));
    const outs = new Map(comp.map((id) => [id, [] as string[]]));
    for (const { s, t } of directed) {
      if (!indeg.has(s) || !indeg.has(t)) continue;
      outs.get(s)!.push(t);
      indeg.set(t, (indeg.get(t) ?? 0) + 1);
    }
    const queue = comp.filter((id) => (indeg.get(id) ?? 0) === 0).sort((a, b) => a.localeCompare(b));
    const topo: string[] = [];
    const localIndeg = new Map(indeg);
    while (queue.length) {
      const id = queue.shift()!;
      topo.push(id);
      for (const t of outs.get(id) ?? []) {
        const next = (localIndeg.get(t) ?? 1) - 1;
        localIndeg.set(t, next);
        if (next === 0) queue.push(t);
      }
    }
    for (const id of comp) if (!topo.includes(id)) topo.push(id);
    // R→L value flow: sinks on the left, producers on the right
    const rowOrder = [...topo].reverse();

    let cx = x0;
    for (const id of rowOrder) {
      const n = byId.get(id)!;
      out.push(plainNode(n, { x: cx, y: rowY }, asChildrenOf));
      cx += (n.kind === "expression" ? exprMinWidth(n) : NODE_W) + 36;
    }
    rowY += NODE_H + 28;
  }

  return out;
}

/** Inheritance view: declarations on top; same-scope calls stacked under their definition. */
function layoutScopeInheritance(
  graph: StructureGraph,
  scopeId: string,
  expanded: Set<string>,
  asChildrenOf: string | undefined,
  leftGutter: number,
  viewMode: ViewMode
): Node[] {
  const inScope = graph.nodes.filter((n) => n.scopeId === scopeId && n.id !== scopeId);
  const decls = inScope
    .filter((n) => (isDeclKind(n.kind) && n.expandable) || n.kind === "class")
    .sort((a, b) => locKey(a) - locKey(b));
  const calls = inScope.filter((n) => n.kind === "call");
  const other = inScope.filter(
    (n) => n.kind === "binding" || n.kind === "expression"
  );

  const out: Node[] = [];
  const x0 = asChildrenOf ? leftGutter : 24;
  const topY = asChildrenOf ? DECL_ROW_Y : 24;
  let x = x0;
  const colXs = new Map<string, number>();

  for (const d of decls) {
    colXs.set(d.id, x);
    if (d.kind === "class") {
      const chunk = layoutClassWithMembers(
        graph,
        d,
        expanded,
        { x, y: topY },
        asChildrenOf,
        viewMode
      );
      out.push(...chunk);
      const w = Number(chunk[0]?.style?.width ?? NODE_W);
      x += w + (expanded.has(d.id) ? 48 : 28);
      continue;
    }
    if (expanded.has(d.id)) {
      const size = expandFrameSize(graph, d.id, expanded);
      const gutter =
        WELL_MARGIN + 8 + (d.params.length > 0 ? PARAM_RAIL : 12);
      out.push({
        id: d.id,
        type: "structure",
        parentId: asChildrenOf,
        position: { x, y: topY },
        data: graphToNodeData(d, true, size.height),
        style: { width: size.width, height: size.height },
        className: "expand-frame",
        draggable: true,
      });
      out.push(
        ...layoutScopeContents(
          graph,
          d.id,
          expanded,
          { x: 0, y: 0 },
          d.id,
          gutter,
          viewMode
        )
      );
      x += size.width + 48;
    } else {
      out.push(plainNode(d, { x, y: topY }, asChildrenOf));
      x += NODE_W + 28;
    }
  }

  const callY0 = topY + 120;
  const callCountUnder = new Map<string, number>();
  const orphans: GraphNode[] = [];

  for (const c of calls.sort((a, b) => locKey(a) - locKey(b))) {
    const ref = c.refId && colXs.has(c.refId) ? c.refId : undefined;
    if (!ref) {
      orphans.push(c);
      continue;
    }
    const i = callCountUnder.get(ref) ?? 0;
    callCountUnder.set(ref, i + 1);
    out.push(
      plainNode(c, { x: colXs.get(ref)!, y: callY0 + i * (NODE_H + 16) }, asChildrenOf)
    );
  }

  // Bindings / expressions / orphan calls — under a free column to the right
  let ox = x + 24;
  let oy = callY0;
  for (const n of [...other, ...orphans].sort((a, b) => locKey(a) - locKey(b))) {
    out.push(plainNode(n, { x: ox, y: oy }, asChildrenOf));
    oy += NODE_H + 16;
  }

  return out;
}

function layoutScopeContents(
  graph: StructureGraph,
  scopeId: string,
  expanded: Set<string>,
  origin: { x: number; y: number },
  asChildrenOf: string | undefined,
  leftGutter: number = EXPAND_PAD,
  viewMode: ViewMode = "execution"
): Node[] {
  let out: Node[];
  if (viewMode === "variable") {
    out = layoutScopeVariable(
      graph,
      scopeId,
      expanded,
      asChildrenOf,
      leftGutter,
      viewMode
    );
  } else if (viewMode === "inheritance") {
    out = layoutScopeInheritance(
      graph,
      scopeId,
      expanded,
      asChildrenOf,
      leftGutter,
      viewMode
    );
  } else {
    out = layoutScopeExecution(
      graph,
      scopeId,
      expanded,
      asChildrenOf,
      leftGutter,
      viewMode
    );
  }

  if (!asChildrenOf) {
    for (const n of out) {
      if (!n.parentId) {
        n.position = { x: n.position.x + origin.x, y: n.position.y + origin.y };
      }
    }
  }
  return out;
}

function expandFrameSize(graph: StructureGraph, scopeId: string, expanded: Set<string>): {
  width: number;
  height: number;
} {
  const scopeNode = graph.nodes.find((n) => n.id === scopeId);
  const paramRail = (scopeNode?.params.length ?? 0) > 0 ? PARAM_RAIL : 0;
  const inScope = graph.nodes.filter((n) => n.scopeId === scopeId && n.id !== scopeId);
  const decls = inScope.filter((n) => isDeclKind(n.kind) && n.expandable).length;
  const bindings = inScope.filter((n) => n.kind === "binding" && !n.slotOf).length;
  const calls = inScope.filter((n) => n.kind === "call").length;
  const expressions = inScope.filter(
    (n) => n.kind === "expression" || n.kind === "throw"
  ).length;
  const classes = inScope.filter((n) => n.kind === "class");

  const gutter = EXPAND_PAD + paramRail;
  const bodyCount = bindings + calls + expressions + decls;
  const bodyH =
    DECL_HEADER_H +
    WELL_MARGIN +
    Math.max(bodyCount, 1) * (NODE_H + 20) +
    classes.reduce((h, c) => {
      const size = classFrameSize(graph, c, expanded);
      return h + size.height + 28;
    }, 0) +
    WELL_MARGIN +
    16;

  // Recursively account for nested expanded decls
  let nestedExtra = 0;
  for (const d of inScope.filter((n) => isDeclKind(n.kind) && expanded.has(n.id))) {
    const inner = expandFrameSize(graph, d.id, expanded);
    nestedExtra += inner.height + 40;
  }

  return {
    width: Math.max(gutter + NODE_W + 80, 320 + paramRail),
    height: Math.max(bodyH + nestedExtra, DECL_HEADER_H + 160),
  };
}

function layoutModuleRails(
  graph: StructureGraph,
  body: Node[]
): Node[] {
  const imports = graph.nodes
    .filter((n) => n.kind === "import" && n.scopeId === MODULE_ID)
    .sort((a, b) => locKey(a) - locKey(b) || a.id.localeCompare(b.id));
  const exports = graph.nodes
    .filter((n) => n.kind === "export" && n.scopeId === MODULE_ID)
    .sort((a, b) => locKey(a) - locKey(b) || a.id.localeCompare(b.id));

  let minY = 24;
  let maxY = 24 + RAIL_BLOCK_H;
  let maxR = 24 + NODE_W;
  for (const n of body) {
    if (n.parentId) continue;
    const { w, h } = nodeBoxSize(n);
    minY = Math.min(minY, n.position.y);
    maxY = Math.max(maxY, n.position.y + h);
    maxR = Math.max(maxR, n.position.x + w);
  }

  const out: Node[] = [];
  const placeRail = (
    list: GraphNode[],
    type: "importRail" | "exportRail",
    x: number
  ) => {
    if (!list.length) return;
    const span = Math.max(maxY - minY, RAIL_BLOCK_H);
    const step =
      list.length <= 1
        ? 0
        : Math.min(RAIL_BLOCK_H + RAIL_GAP, span / Math.max(list.length - 1, 1));
    list.forEach((n, i) => {
      const y =
        list.length === 1
          ? minY + Math.max(0, (span - RAIL_BLOCK_H) / 2)
          : minY + i * step;
      out.push({
        id: n.id,
        type,
        position: { x, y },
        data: graphToNodeData(n, false),
        style: {
          width: type === "importRail" ? IMPORT_RAIL - 16 : EXPORT_RAIL - 16,
          height: RAIL_BLOCK_H,
        },
        draggable: false,
      });
    });
  };

  if (imports.length) placeRail(imports, "importRail", 24);
  if (exports.length) placeRail(exports, "exportRail", maxR + 36);
  return out;
}

function layoutGraph(
  graph: StructureGraph,
  expanded: Set<string>,
  viewMode: ViewMode = "execution"
): { nodes: Node[]; edges: Edge[] } {
  const hasImports = graph.nodes.some((n) => n.kind === "import");
  const bodyShiftX = hasImports ? IMPORT_RAIL + 16 : 0;

  let nodes = layoutScopeContents(
    graph,
    MODULE_ID,
    expanded,
    { x: bodyShiftX, y: 0 },
    undefined,
    24,
    viewMode
  );

  nodes = restackAll(nodes);
  nodes = resolvePeerCollisions(nodes);

  const rails = layoutModuleRails(graph, nodes);
  nodes = [...nodes.filter((n) => n.type !== "importRail" && n.type !== "exportRail"), ...rails];

  // Externals sit to the right of body + export rails.
  const topExternals = graph.nodes.filter((n) => n.kind === "external");
  if (topExternals.length) {
    let maxR = 24;
    let minY = 24;
    for (const n of nodes) {
      if (n.parentId) continue;
      const { w } = nodeBoxSize(n);
      maxR = Math.max(maxR, n.position.x + w);
      minY = Math.min(minY, n.position.y);
    }
    let ey = minY;
    for (const n of topExternals) {
      nodes.push({
        id: n.id,
        type: "structure",
        position: { x: maxR + 48, y: ey },
        data: graphToNodeData(n, false),
        draggable: true,
      });
      ey += NODE_H + 16;
    }
  }

  nodes = enrichNodeData(nodes, graph, expanded);

  const visibleIds = new Set(nodes.map((n) => n.id));
  const byGraphId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges: Edge[] = graph.edges
    .filter((e) => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
      if (e.sourceHandle?.startsWith("param:")) {
        const src = byGraphId.get(e.source);
        if (src?.expandable && !expanded.has(e.source)) return false;
      }
      if (e.targetHandle === "return" || e.targetHandle === "result") {
        const tgt = byGraphId.get(e.target);
        if (tgt?.expandable && !expanded.has(e.target)) return false;
      }
      if (e.sourceHandle === "flow-well-in" || e.targetHandle === "flow-well-out") {
        const wellId = e.sourceHandle === "flow-well-in" ? e.source : e.target;
        if (!expanded.has(wellId)) return false;
      }
      return true;
    })
    .map((e: GraphEdge) => {
      const isRef = e.kind === "ref";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? (isRef ? "ref" : undefined),
        targetHandle: e.targetHandle ?? (isRef ? "ref" : undefined),
        label:
          e.kind === "ref"
            ? e.label ?? "def"
            : e.kind === "flow"
              ? undefined
              : e.kind === "thread"
                ? e.label ?? "thread"
                : e.label ?? e.kind,
        animated: e.kind === "thread" || e.kind === "flow",
        className: `edge-${e.kind}`,
        data: { edgeKind: e.kind },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: edgeStyle(e.kind),
      };
    });

  return { nodes, edges };
}

function FlowApp() {
  const [graph, setGraph] = useState<StructureGraph | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [error, setError] = useState<ParseErrorPayload | null>(null);
  const [empty, setEmpty] = useState<string | null>("Waiting for graph…");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeVis, setEdgeVis] = useState<EdgeVisibility>(() => loadEdgeVisibility());
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [layoutTween, setLayoutTween] = useState(false);
  const { getNodes, setCenter, getNode, getViewport } = useReactFlow();
  const storeApi = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const graphRef = useRef<StructureGraph | null>(null);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const layoutTweenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flowViewportCenter = useCallback(() => {
    const { x: vx, y: vy, zoom } = getViewport();
    const { width: paneW, height: paneH } = storeApi.getState();
    if (!paneW || !paneH || zoom <= 0) return null;
    return {
      x: (paneW / 2 - vx) / zoom,
      y: (paneH / 2 - vy) / zoom,
      zoom,
    };
  }, [getViewport, storeApi]);

  /** Pan so `nodeId`'s center sits at viewportCenter + (offsetX, offsetY). */
  const restoreNodeOffset = useCallback(
    (nodeId: string, offsetX: number, offsetY: number, zoom: number) => {
      const run = () => {
        const nodesNow = getNodes();
        const byId = new Map(nodesNow.map((n) => [n.id, n]));
        const node = byId.get(nodeId) ?? getNode(nodeId);
        if (!node) return;
        const c = nodeCenterAbs(node, byId);
        void setCenter(c.x - offsetX, c.y - offsetY, { zoom, duration: LAYOUT_TWEEN_MS });
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
    },
    [getNodes, getNode, setCenter]
  );

  /** Pan (tweened) so `nodeId` is centered — or top/left-aligned if it overflows the pane. */
  const focusNodeInView = useCallback(
    (nodeId: string) => {
      const run = () => {
        const nodesNow = getNodes();
        const byId = new Map(nodesNow.map((n) => [n.id, n]));
        const node = byId.get(nodeId) ?? getNode(nodeId);
        if (!node) return;

        const { x: left, y: top } = absPos(node, byId);
        const { w, h } = nodeBoxSize(node);
        const { zoom } = getViewport();
        const { width: paneW, height: paneH } = storeApi.getState();
        if (!paneW || !paneH || zoom <= 0) return;

        const viewW = paneW / zoom;
        const viewH = paneH / zoom;

        // Overflowing axis: align viewport edge to node edge; otherwise center.
        const cx = w > viewW ? left + viewW / 2 : left + w / 2;
        const cy = h > viewH ? top + viewH / 2 : top + h / 2;

        void setCenter(cx, cy, { zoom, duration: LAYOUT_TWEEN_MS });
      };

      // Wait for layout + DOM measure after expand/collapse.
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
    },
    [getNodes, getNode, getViewport, setCenter, storeApi]
  );

  const toggleEdgeKind = useCallback((kind: EdgeKind) => {
    setEdgeVis((prev) => {
      const next = { ...prev, [kind]: edgeModeCycle(kind, prev[kind] ?? "lines") };
      saveEdgeVisibility(next);
      return next;
    });
  }, []);

  const selectViewMode = useCallback(
    (mode: ViewMode) => {
      if (mode === viewModeRef.current) return;
      const g = graphRef.current;
      const center = flowViewportCenter();
      const anchor =
        center != null ? closestNodeToFlowPoint(getNodes(), center.x, center.y) : null;

      setViewMode(mode);
      saveViewMode(mode);

      if (g) {
        setLayoutTween(true);
        if (layoutTweenTimer.current) clearTimeout(layoutTweenTimer.current);
        layoutTweenTimer.current = setTimeout(() => {
          setLayoutTween(false);
          layoutTweenTimer.current = null;
        }, LAYOUT_TWEEN_MS + 40);

        const laid = layoutGraph(g, expanded, mode);
        setNodes(laid.nodes);
        setEdges(laid.edges);

        if (anchor && center) {
          restoreNodeOffset(anchor.id, anchor.offsetX, anchor.offsetY, center.zoom);
        }
      }
    },
    [expanded, setNodes, setEdges, getNodes, flowViewportCenter, restoreNodeOffset]
  );

  const relayout = useCallback(
    (g: StructureGraph, exp: Set<string>, mode: ViewMode = viewModeRef.current) => {
      const laid = layoutGraph(g, exp, mode);
      setNodes(laid.nodes);
      setEdges(laid.edges);
    },
    [setNodes, setEdges]
  );

  useEffect(() => {
    return () => {
      if (layoutTweenTimer.current) clearTimeout(layoutTweenTimer.current);
    };
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;

      try {
        if (msg.type === "setGraph") {
          setError(null);
          setEmpty(null);
          setGraph(msg.graph);
          graphRef.current = msg.graph;
          setExpanded(new Set());
          relayout(msg.graph, new Set());
          setSelectedId(null);
        } else if (msg.type === "setError") {
          setError(msg.error);
          setEmpty(null);
          setGraph(null);
          graphRef.current = null;
          setNodes([]);
          setEdges([]);
        } else if (msg.type === "setEmpty") {
          setEmpty(msg.reason);
          setError(null);
          setGraph(null);
          graphRef.current = null;
          setNodes([]);
          setEdges([]);
        }
      } catch (err) {
        setError({
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, [relayout, setNodes, setEdges]);

  const highlightedEdges = useMemo(() => {
    // Keep edges mounted (use `hidden`) so React Flow can recompute paths when
    // handles reappear after expand / mode toggles — filtering them out loses geometry.
    return edges.map((e) => {
      const kind = (e.data as { edgeKind?: EdgeKind } | undefined)?.edgeKind;
      const showLines = !kind || edgeVis[kind] === "lines";
      if (!selectedId) return { ...e, hidden: !showLines };
      const onPath = e.source === selectedId || e.target === selectedId;
      return {
        ...e,
        hidden: !showLines,
        animated: onPath || Boolean(e.animated),
        style: {
          ...e.style,
          opacity: onPath ? 1 : 0.22,
          strokeWidth: onPath ? 2.5 : 1.5,
        },
      };
    });
  }, [edges, selectedId, edgeVis]);

  // After handles mount/move (toggle, expand, view change), refresh RF handle bounds.
  useLayoutEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const ids = getNodes().map((n) => n.id);
        if (ids.length) updateNodeInternals(ids);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [edgeVis, expanded, viewMode, nodes, updateNodeInternals, getNodes]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedId(node.id);
    const loc = (node.data as NodeData).loc;
    vscode.postMessage({ type: "selectNode", nodeId: node.id, loc });
  }, []);

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as NodeData;
      const g = graphRef.current;
      if (!g) return;

      // Call site → center on declaration
      if (data.kind === "call" && data.refId) {
        setSelectedId(data.refId);
        const target = getNode(data.refId);
        if (target) {
          const w = Number(target.style?.width ?? NODE_W);
          const h = Number(target.style?.height ?? NODE_H);
          setCenter(target.position.x + w / 2, target.position.y + h / 2, {
            zoom: 1.1,
            duration: 400,
          });
        } else {
          const decl = g.nodes.find((n) => n.id === data.refId);
          if (decl?.scopeId && decl.scopeId !== MODULE_ID) {
            const next = new Set(expanded);
            next.add(decl.scopeId);
            setExpanded(next);
            relayout(g, next);
            requestAnimationFrame(() => {
              const t = getNode(data.refId!);
              if (t) {
                setCenter(t.position.x + NODE_W / 2, t.position.y + NODE_H / 2, {
                  zoom: 1.1,
                  duration: 400,
                });
              }
            });
          }
        }
        const declNode = g.nodes.find((n) => n.id === data.refId);
        if (declNode?.loc) {
          vscode.postMessage({ type: "selectNode", nodeId: data.refId, loc: declNode.loc });
        }
      }
    },
    [expanded, getNode, setCenter, relayout]
  );

  const toggleExpand = useCallback(
    (nodeId: string) => {
      const g = graphRef.current;
      if (!g) return;
      const next = new Set(expanded);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      setExpanded(next);
      relayout(g, next);
      focusNodeInView(nodeId);
    },
    [expanded, relayout, focusNodeInView]
  );

  const openImport = useCallback((source: string) => {
    vscode.postMessage({ type: "openImport", source });
  }, []);

  const nodeActions = useMemo(
    () => ({ toggleExpand, openImport }),
    [toggleExpand, openImport]
  );

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, dragged) => {
      const current = getNodes();
      const byId = new Map(current.map((n) => [n.id, n]));
      const live = byId.get(dragged.id) ?? dragged;
      const data = live.data as NodeData;

      if (live.type === "classHeader") {
        setNodes(restackAll(current));
        return;
      }

      if (data.kind !== "method" && live.type !== "methodBlock") return;

      const abs = absPos(live, byId);
      const prevStack = live.parentId;
      let next = current.map((n) => ({ ...n, data: { ...(n.data as object) } }));
      const stackTarget = findInsertClass(next, abs, live.id);

      if (prevStack && !stackTarget) {
        const parent = byId.get(prevStack);
        if (parent) {
          const pp = absPos(parent, byId);
          const cx = pp.x + Number(parent.style?.width ?? STACK_W) / 2;
          const farX = Math.abs(abs.x + STACK_W / 2 - cx) > DETACH_X;
          const above = abs.y + MEMBER_H / 2 < pp.y + BODY_Y0 * 0.4;
          if (farX || above) {
            next = next.map((n) => {
              if (n.id !== live.id) return n;
              return {
                ...n,
                parentId: undefined,
                position: abs,
                data: { ...data, stackClassId: undefined, stackOrder: undefined },
              };
            });
            next = applyClassFrame(next, prevStack);
            setNodes(restackAll(next));
            return;
          }
        }
        next = applyClassFrame(next, prevStack);
        setNodes(restackAll(next));
        return;
      }

      if (stackTarget) {
        const parent = byId.get(stackTarget)!;
        const pp = absPos(parent, byId);
        const relY = abs.y - pp.y;
        next = next.map((n) => {
          if (n.id !== live.id) return n;
          return {
            ...n,
            parentId: stackTarget,
            position: { x: WELL_MARGIN + 12, y: Math.max(BODY_Y0, relY) },
            type: "methodBlock",
            data: {
              ...data,
              kind: "method" as NodeKind,
              stackClassId: stackTarget,
              memberKind: data.memberKind ?? "method",
            },
          };
        });
        if (prevStack && prevStack !== stackTarget) next = applyClassFrame(next, prevStack);
        next = applyClassFrame(next, stackTarget);
        setNodes(restackAll(next));
      }
    },
    [getNodes, setNodes]
  );

  if (error) {
    return (
      <div className="status status-error">
        <h1>Parse error</h1>
        <p>{error.message}</p>
        {error.line != null && (
          <p className="meta">
            Line {error.line}
            {error.column != null ? `, column ${error.column}` : ""}
          </p>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="status">
        <h1>Cute Code</h1>
        <p>{empty}</p>
      </div>
    );
  }

  return (
    <EdgeVisContext.Provider value={edgeVis}>
      <NodeActionsContext.Provider value={nodeActions}>
        <div className="app">
          <header className="toolbar">
            <span className="brand">Cute Code</span>
            <div className="view-toggles" role="radiogroup" aria-label="View layout">
              {VIEW_MODES.map((v) => {
                const on = viewMode === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`edge-toggle view-toggle ${on ? "on" : "off"}`}
                    title={v.label}
                    aria-label={v.label}
                    aria-pressed={on}
                    onClick={() => selectViewMode(v.id)}
                  >
                    <ViewModeIcon mode={v.id} size={15} />
                  </button>
                );
              })}
            </div>
            <div className="edge-toggles" role="toolbar" aria-label="Edge display">
              {EDGE_TOGGLES.map((t) => {
                const mode = edgeVis[t.kind] ?? "lines";
                const next = edgeModeCycle(t.kind, mode);
                return (
                  <button
                    key={t.kind}
                    type="button"
                    className={`edge-toggle mode-${mode}`}
                    title={`${t.label}: ${mode} (click → ${next})`}
                    aria-label={`${t.label}: ${mode}`}
                    aria-pressed={mode !== "hidden"}
                    style={{ "--toggle-accent": `var(${t.cssVar})` } as React.CSSProperties}
                    onClick={() => toggleEdgeKind(t.kind)}
                  >
                    <EdgeKindIcon kind={t.kind} size={15} />
                  </button>
                );
              })}
            </div>
            <span className="hint">
              Views · edge modes (lines / labels / hidden) · expand · dbl-click call → definition
              {graph ? ` · ${expanded.size} expanded` : ""}
            </span>
          </header>
          <div className={`canvas ${layoutTween ? "layout-tween" : ""}`}>
            <ReactFlow
              nodes={nodes}
              edges={highlightedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.15}
              defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} color="var(--grid)" />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) => {
                  const kind = (n.data as NodeData)?.kind;
                  if (kind === "class") return "var(--accent-class)";
                  if (kind === "method" || kind === "function" || kind === "arrow")
                    return "var(--accent-function)";
                  if (kind === "binding") return "var(--accent-binding)";
                  if (kind === "call") return "var(--accent-call)";
                  if (kind === "expression") return "var(--accent-expression)";
                  if (kind === "import") return "var(--accent-import)";
                  if (kind === "export") return "var(--accent-export)";
                  if (kind === "external") return "var(--accent-external)";
                  if (kind === "branch") return "var(--accent-branch)";
                  if (kind === "loop") return "var(--accent-loop)";
                  if (kind === "try") return "var(--accent-try)";
                  if (kind === "throw") return "var(--accent-throw)";
                  if (kind === "jsx") return "var(--accent-jsx)";
                  if (kind === "fragment") return "var(--accent-fragment)";
                  return "var(--accent-function)";
                }}
                maskColor="transparent"
              />
            </ReactFlow>
          </div>
        </div>
      </NodeActionsContext.Provider>
    </EdgeVisContext.Provider>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <FlowApp />
    </ReactFlowProvider>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
