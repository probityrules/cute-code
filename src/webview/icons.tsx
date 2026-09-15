/**
 * Lucide icons via Iconify (offline).
 * Bodies sourced from @iconify-json/lucide / Iconify API.
 */
import { Icon, addIcon } from "@iconify/react/dist/offline";
import type { IconifyIcon } from "@iconify/types";
import type {
  BindingKind,
  EdgeKind,
  MemberKind,
  NodeKind,
  ValueType,
} from "../shared/graph";

const lucide: Record<string, IconifyIcon> = {
  "maximize-2": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 3h6v6m0-6l-7 7M3 21l7-7m-1 7H3v-6"/>',
    width: 24,
    height: 24,
  },
  "minimize-2": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14 10l7-7m-1 7h-6V4M3 21l7-7m-6 0h6v6"/>',
    width: 24,
    height: 24,
  },
  "file-symlink": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="M14 2v5a1 1 0 0 0 1 1h5M10 18l3-3l-3-3"/></g>',
    width: 24,
    height: 24,
  },
  "square-function": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3m-6 4.2h5.7"/></g>',
    width: 24,
    height: 24,
  },
  "corner-down-right": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m15 10l5 5l-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></g>',
    width: 24,
    height: 24,
  },
  boxes: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3zM7 16.5l-4.74-2.85M7 16.5l5-3m-5 3v5.17m5-8.17V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5zm5 3l-5-3m5 3l4.74-2.85M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3l5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0zM12 8L7.26 5.15M12 8l4.74-2.85M12 13.5V8"/></g>',
    width: 24,
    height: 24,
  },
  box: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7l8.7 5l8.7-5M12 22V12"/></g>',
    width: 24,
    height: 24,
  },
  copy: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g>',
    width: 24,
    height: 24,
  },
  hammer: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m15 12l-9.373 9.373a1 1 0 0 1-3.001-3L12 9m6 6l4-4"/><path d="m21.5 11.5l-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></g>',
    width: 24,
    height: 24,
  },
  eye: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></g>',
    width: 24,
    height: 24,
  },
  pencil: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/>',
    width: 24,
    height: 24,
  },
  download: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10l5 5l5-5"/></g>',
    width: 24,
    height: 24,
  },
  upload: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m5-7l-5-5l-5 5m14 7v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    width: 24,
    height: 24,
  },
  globe: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20"/></g>',
    width: 24,
    height: 24,
  },
  variable: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 21s-4-3-4-9s4-9 4-9m8 0s4 3 4 9s-4 9-4 9M15 9l-6 6m0-6l6 6"/>',
    width: 24,
    height: 24,
  },
  lock: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></g>',
    width: 24,
    height: 24,
  },
  quote: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zm-11 0a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></g>',
    width: 24,
    height: 24,
  },
  hash: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    width: 24,
    height: 24,
  },
  "toggle-left": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="20" height="12" x="2" y="6" rx="6" ry="6"/><circle cx="8" cy="12" r="2"/></g>',
    width: 24,
    height: 24,
  },
  braces: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1m8-18h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
    width: 24,
    height: 24,
  },
  brackets: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 3h3v18h-3M8 21H5V3h3"/>',
    width: 24,
    height: 24,
  },
  "circle-off": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m2 2l20 20"/><path d="M8.35 2.69A10 10 0 0 1 21.3 15.65M19.08 19.08A10 10 0 1 1 4.92 4.92"/></g>',
    width: 24,
    height: 24,
  },
  "circle-help": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"/></g>',
    width: 24,
    height: 24,
  },
  zap: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>',
    width: 24,
    height: 24,
  },
  "file-code-2": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4M5 12l-3 3l3 3m4 0l3-3l-3-3"/></g>',
    width: 24,
    height: 24,
  },
  "link-2": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8"/>',
    width: 24,
    height: 24,
  },
  cable: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1zm0 2v-2"/><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10m16 11v-2M3 5V3"/><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2zm3-5V3"/></g>',
    width: 24,
    height: 24,
  },
  "undo-2": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></g>',
    width: 24,
    height: 24,
  },
  "phone-forwarded": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 6h8m-4-4l4 4l-4 4m-4.168 6.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233a14 14 0 0 0 6.392 6.384"/>',
    width: 24,
    height: 24,
  },
  "between-horizontal-start": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="13" height="7" x="8" y="3" rx="1"/><path d="m2 9l3 3l-3 3"/><rect width="13" height="7" x="8" y="14" rx="1"/></g>',
    width: 24,
    height: 24,
  },
  sigma: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>',
    width: 24,
    height: 24,
  },
  "circle-dot": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></g>',
    width: 24,
    height: 24,
  },
  workflow: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></g>',
    width: 24,
    height: 24,
  },
  "list-ordered": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M4 14h2v4M4 18h2"/></g>',
    width: 24,
    height: 24,
  },
  "arrow-left-right": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3L4 7l4 4M4 7h16m-4 14l4-4l-4-4m4 4H4"/>',
    width: 24,
    height: 24,
  },
  "git-fork": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9m6 9v-6"/></g>',
    width: 24,
    height: 24,
  },
  "git-branch": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></g>',
    width: 24,
    height: 24,
  },
  repeat: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m17 2l4 4l-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22l-4-4l4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></g>',
    width: 24,
    height: 24,
  },
  "shield-alert": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4m0 4h.01"/></g>',
    width: 24,
    height: 24,
  },
  bomb: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="11" cy="13" r="9"/><path d="M14.35 4.65L16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95M22 2l-1.5 1.5"/></g>',
    width: 24,
    height: 24,
  },
  component: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0zm-13.518 0a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L5.809 8.916a1 1 0 0 0-1.414 0zM8.916 15.536a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0zm0-13.518a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L12.707.607a1 1 0 0 0-1.414 0z"/>',
    width: 24,
    height: 24,
  },
  group: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/></g>',
    width: 24,
    height: 24,
  },
  focus: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/></g>',
    width: 24,
    height: 24,
  },
  "eye-off": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/></g>',
    width: 24,
    height: 24,
  },
  x: {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/>',
    width: 24,
    height: 24,
  },
  network: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="6" height="6" x="16" y="16" rx="1"/><rect width="6" height="6" x="2" y="16" rx="1"/><rect width="6" height="6" x="9" y="2" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3m-7-4V8"/></g>',
    width: 24,
    height: 24,
  },
  target: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></g>',
    width: 24,
    height: 24,
  },
  layers: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></g>',
    width: 24,
    height: 24,
  },
  radius: {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20.34 17.52a10 10 0 1 0-2.82 2.82"/><circle cx="19" cy="19" r="2"/><path d="m13.41 13.41l4.18 4.18"/><circle cx="12" cy="12" r="2"/></g>',
    width: 24,
    height: 24,
  },
};

for (const [name, data] of Object.entries(lucide)) {
  addIcon(`lucide:${name}`, data);
}

function LucideIcon({
  name,
  size = 13,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      icon={`lucide:${name}`}
      width={size}
      height={size}
      className={className}
      aria-hidden
    />
  );
}

export function IconExpand({ condensed }: { condensed: boolean }) {
  return (
    <LucideIcon
      name={condensed ? "maximize-2" : "minimize-2"}
      className="node-action-icon"
    />
  );
}

export function IconOpenFile() {
  return <LucideIcon name="file-symlink" className="node-action-icon" />;
}

/** Small glyph for `this` receivers on call / assignment titles. */
export function IconThis({ size = 12 }: { size?: number } = {}) {
  return (
    <span className="struct-this-icon" title="this" aria-label="this">
      <LucideIcon name="circle-dot" size={size} />
    </span>
  );
}

type KindIconSpec = { icon: string; label: string };

function valueTypeIconSpec(valueType: ValueType | undefined): KindIconSpec | undefined {
  switch (valueType) {
    case "function":
      return { icon: "square-function", label: "Function value" };
    case "string":
      return { icon: "quote", label: "String" };
    case "number":
      return { icon: "hash", label: "Number" };
    case "boolean":
      return { icon: "toggle-left", label: "Boolean" };
    case "object":
      return { icon: "braces", label: "Object" };
    case "array":
      return { icon: "brackets", label: "Array" };
    case "null":
      return { icon: "circle-off", label: "Null" };
    case "undefined":
      return { icon: "circle-help", label: "Undefined" };
    case "class":
      return { icon: "boxes", label: "Class" };
    case "instance":
      return { icon: "copy", label: "Instance" };
    case "unknown":
      return { icon: "circle-help", label: "Unknown value" };
    default:
      return undefined;
  }
}

function kindIconSpec(
  kind: NodeKind,
  opts?: {
    memberKind?: MemberKind;
    bindingKind?: BindingKind;
    valueType?: ValueType;
    callKind?: "call" | "new";
  }
): KindIconSpec {
  if (kind === "method") {
    switch (opts?.memberKind) {
      case "constructor":
        return { icon: "hammer", label: "Constructor" };
      case "get":
        return { icon: "eye", label: "Getter" };
      case "set":
        return { icon: "pencil", label: "Setter" };
      default:
        return { icon: "box", label: "Method" };
    }
  }
  if (kind === "binding") {
    const byValue = valueTypeIconSpec(opts?.valueType);
    if (byValue) return byValue;
    switch (opts?.bindingKind) {
      case "const":
        return { icon: "lock", label: "const" };
      case "let":
        return { icon: "variable", label: "let" };
      case "var":
        return { icon: "variable", label: "var" };
      case "prop":
        return { icon: "pencil", label: "Property" };
      default:
        return { icon: "variable", label: "Binding" };
    }
  }
  switch (kind) {
    case "function":
      return { icon: "square-function", label: "Function" };
    case "arrow":
      return { icon: "square-function", label: "Arrow function" };
    case "class":
      return { icon: "boxes", label: "Class" };
    case "import":
      return { icon: "download", label: "Import" };
    case "export":
      return { icon: "upload", label: "Export" };
    case "external":
      return { icon: "globe", label: "External" };
    case "call":
      return opts?.callKind === "new"
        ? { icon: "copy", label: "Instance (new)" }
        : { icon: "zap", label: "Call (double-click → definition)" };
    case "expression":
      return { icon: "sigma", label: "Expression" };
    case "module":
      return { icon: "file-code-2", label: "Module" };
    case "branch":
      return { icon: "git-branch", label: "Branch" };
    case "loop":
      return { icon: "repeat", label: "Loop" };
    case "try":
      return { icon: "shield-alert", label: "Try / catch" };
    case "throw":
      return { icon: "bomb", label: "Throw" };
    case "jsx":
      return { icon: "component", label: "JSX element" };
    case "fragment":
      return { icon: "group", label: "JSX fragment" };
    default:
      return { icon: "box", label: kind };
  }
}

/** Kind glyph + accessible name for the top-left of a block. */
export function KindIcon({
  kind,
  memberKind,
  bindingKind,
  valueType,
  callKind,
  size = 14,
}: {
  kind: NodeKind;
  memberKind?: MemberKind;
  bindingKind?: BindingKind;
  valueType?: ValueType;
  callKind?: "call" | "new";
  size?: number;
}) {
  const spec = kindIconSpec(kind, { memberKind, bindingKind, valueType, callKind });
  return (
    <span className="struct-kind-icon" title={spec.label} aria-label={spec.label}>
      <LucideIcon name={spec.icon} size={size} />
    </span>
  );
}

export type EdgeDisplayMode = "lines" | "labels" | "hidden";

export type EdgeToggleDef = {
  kind: EdgeKind;
  icon: string;
  label: string;
  cssVar: string;
  /** When false, toggle only cycles lines ↔ hidden */
  hasLabels?: boolean;
};

/** Toolbar edge-visibility toggles (order = display order). */
export const EDGE_TOGGLES: EdgeToggleDef[] = [
  {
    kind: "flow",
    icon: "workflow",
    label: "Worker flow (processing order)",
    cssVar: "--edge-flow",
    hasLabels: true,
  },
  {
    kind: "ref",
    icon: "link-2",
    label: "Call / extends → definition",
    cssVar: "--edge-ref",
    hasLabels: true,
  },
  {
    kind: "thread",
    icon: "cable",
    label: "Value flow (outputs → inputs)",
    cssVar: "--edge-thread",
    hasLabels: true,
  },
  {
    kind: "returns",
    icon: "undo-2",
    label: "Returns / exports",
    cssVar: "--edge-returns",
    hasLabels: true,
  },
  {
    kind: "calls",
    icon: "phone-forwarded",
    label: "Call edges",
    cssVar: "--edge-calls",
    hasLabels: false,
  },
  {
    kind: "param",
    icon: "between-horizontal-start",
    label: "Parameter edges",
    cssVar: "--edge-param",
    hasLabels: false,
  },
];

export function edgeModeCycle(kind: EdgeKind, current: EdgeDisplayMode): EdgeDisplayMode {
  const def = EDGE_TOGGLES.find((t) => t.kind === kind);
  const modes: EdgeDisplayMode[] = def?.hasLabels
    ? ["lines", "labels", "hidden"]
    : ["lines", "hidden"];
  const i = modes.indexOf(current);
  return modes[(i < 0 ? 0 : i + 1) % modes.length]!;
}

export function EdgeKindIcon({ kind, size = 14 }: { kind: EdgeKind; size?: number }) {
  const def = EDGE_TOGGLES.find((t) => t.kind === kind);
  return <LucideIcon name={def?.icon ?? "link-2"} size={size} />;
}

export type ViewMode = "execution" | "variable" | "inheritance";

export type ViewModeDef = {
  id: ViewMode;
  icon: string;
  label: string;
};

export const VIEW_MODES: ViewModeDef[] = [
  { id: "execution", icon: "list-ordered", label: "Execution order (vertical)" },
  { id: "variable", icon: "arrow-left-right", label: "Variable flow (horizontal chains)" },
  { id: "inheritance", icon: "git-fork", label: "Inheritance (calls under definitions)" },
];

export function ViewModeIcon({ mode, size = 14 }: { mode: ViewMode; size?: number }) {
  const def = VIEW_MODES.find((t) => t.id === mode);
  return <LucideIcon name={def?.icon ?? "list-ordered"} size={size} />;
}

export type ArchitecturePresetId = "trace" | "coupling" | "dataflow" | "interface";

const PRESET_ICONS: Record<ArchitecturePresetId, string> = {
  trace: "zap",
  coupling: "git-branch",
  dataflow: "cable",
  interface: "layers",
};

export function PresetIcon({
  id,
  size = 14,
}: {
  id: string;
  size?: number;
}) {
  const icon = PRESET_ICONS[id as ArchitecturePresetId] ?? "workflow";
  return <LucideIcon name={icon} size={size} />;
}

export function ToolbarLucideIcon({
  name,
  size = 15,
}: {
  name: string;
  size?: number;
}) {
  return <LucideIcon name={name} size={size} />;
}

/** Focus neighborhood radius: 1-hop vs 2-hop. */
export function FocusHopsIcon({ hops, size = 15 }: { hops: 1 | 2; size?: number }) {
  return <LucideIcon name={hops === 1 ? "circle-dot" : "target"} size={size} />;
}
