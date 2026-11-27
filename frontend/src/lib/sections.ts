/**
 * The store's sections — its aisles, departments, areas and shelf groups — as
 * the shopper search offers them beside its items. An index built once per
 * floor (`buildSections`) and a query against it (`searchSections`).
 *
 * A department is whatever the map already names shelves by (their seeded
 * meta.department, else the dominant category pinned to them — see
 * departments.ts), so every store has sections without a seeding contract.
 * An area (a labelled zone) that holds one department is that department's
 * other name — "Produce" is Fresh Produce — not a section of its own; the
 * rest (Restrooms, Checkouts…) are places in the store.
 */
import type { MapElement, RectGeom } from '../types';
import { groupDisplayName } from '../types';
import type { MapPin } from '../components/MapCanvas';
import { shelfDepartments } from './departments';
import { bboxOf, distToPolyline, elementContains, polyPoints, rectCorners, type WorldPt } from './geometry';

export type SectionKind = 'aisle' | 'department' | 'area' | 'group';

/** A part of the floor a shopper can be sent to. */
export interface Section {
  key: string;
  kind: SectionKind;
  /** the name the shopper knows it by */
  name: string;
  /** what else it goes by, for the search only: the area a department fills,
   *  the departments an area or an aisle holds, the department a shelf sits in */
  also: string[];
  color: string;
  /** the grey line under the name, in parts */
  sub: string[];
  /** its shelves, in draw order (none for a place without products) */
  shelfIds: string[];
  /** the part of the floor it covers, in metres */
  box: Box;
}

/** What the results call each kind. */
export const SECTION_KIND: Record<SectionKind, string> = { aisle: 'Aisle', department: 'Department', area: 'Area', group: 'Shelf' };

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** How far from an aisle's line a shelf still lines it — half a shopper's aisle. */
export const AISLE_LINING_M = 2.0;

const unique = (list: (string | null | undefined)[]) => [...new Set(list.filter((v): v is string => !!v))];

/** The department a zone records in its meta, where that is not its own name. */
function zoneDepartment(z: MapElement): string {
  try {
    const d = JSON.parse(z.meta || '{}').department;
    return typeof d === 'string' ? d.trim() : '';
  } catch {
    return '';
  }
}

const centerOf = (el: MapElement): WorldPt => {
  const r = el.geom as RectGeom;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

const boxOfPoints = (pts: WorldPt[]): Box => {
  const b = bboxOf(pts);
  return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
};
const boxOfRect = (r: RectGeom): Box => boxOfPoints(rectCorners(r));

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

const boxOfZone = (z: MapElement): Box => {
  if (z.shape === 'rect') return boxOfRect(z.geom as RectGeom);
  if (z.shape === 'polygon' || z.shape === 'polyline') return boxOfPoints(polyPoints(z));
  const p = z.geom as { x: number; y: number };
  return { x0: p.x - 2, y0: p.y - 2, x1: p.x + 2, y1: p.y + 2 };
};

/** "1 shelf", "2 shelves" — the one count the results spell out. */
const shelvesLabel = (n: number) => (n === 1 ? '1 shelf' : `${n} shelves`);

/** Every section of one floor. `pins` is the floor's own stock — what names a
 *  shelf that carries no seeded department. */
export function buildSections(elements: MapElement[], pins: MapPin[]): Section[] {
  const shelves = elements.filter((e) => e.type === 'shelf' && e.shape === 'rect');
  const byId = new Map(shelves.map((s) => [s.id, s]));
  const deptOf = shelfDepartments(elements, pins);
  const labelledAreas = elements.filter((e) => e.type === 'zone' && !!e.label?.trim());

  // the shelves that line an aisle: within reach of its line, or inside it where it is drawn as a strip
  const lining = (aisle: MapElement) =>
    shelves.filter((s) => {
      if (aisle.shape === 'polyline') {
        const r = s.geom as RectGeom;
        return distToPolyline(centerOf(s), polyPoints(aisle)) <= AISLE_LINING_M + Math.min(r.w, r.h) / 2;
      }
      return aisle.shape === 'rect' && elementContains(aisle, centerOf(s), 0);
    });
  const boxOf = (ids: string[]): Box | null => {
    const boxes = ids.map((id) => byId.get(id)).filter((s): s is MapElement => !!s).map((s) => boxOfRect(s.geom as RectGeom));
    return boxes.length ? union(boxes) : null;
  };

  const out: Section[] = [];

  // ── aisles: the numbered runs, with the departments on either side ──
  const aisleRows: { el: MapElement; shelfIds: string[]; depts: string[]; box: Box }[] = [];
  for (const aisle of elements) {
    if (aisle.type !== 'aisle' || !aisle.label?.trim()) continue;
    const shelfIds = lining(aisle).map((s) => s.id);
    const depts = unique(shelfIds.map((id) => deptOf.get(id)));
    const lined = boxOf(shelfIds);
    const own = boxOfZone(aisle);
    const box = lined ? union([lined, own]) : { x0: own.x0 - AISLE_LINING_M, y0: own.y0 - AISLE_LINING_M, x1: own.x1 + AISLE_LINING_M, y1: own.y1 + AISLE_LINING_M };
    aisleRows.push({ el: aisle, shelfIds, depts, box });
    // what it runs past is said under its name, not searched by: a department's
    // own row already names its aisles, and matching would crowd out its shelves
    out.push({ key: `aisle:${aisle.id}`, kind: 'aisle', name: aisle.label.trim(), also: [], color: '#4b5563', sub: depts, shelfIds, box });
  }

  // ── departments: every shelf of one department, wherever it stands ──
  const deptShelves = new Map<string, MapElement[]>();
  for (const s of shelves) {
    const dept = deptOf.get(s.id);
    if (!dept) continue;
    deptShelves.set(dept, [...(deptShelves.get(dept) ?? []), s]);
  }
  const areaName = (s: MapElement) => unique(labelledAreas.filter((z) => elementContains(z, centerOf(s), 0)).map((z) => z.label.trim()));
  const deptSections: Section[] = [];
  for (const [dept, list] of deptShelves) {
    const shelfIds = list.map((s) => s.id);
    const areas = unique(list.flatMap(areaName)).filter((a) => a !== dept);
    for (const z of labelledAreas) {
      // an area that records this department in its meta is its name too, shelves or not
      if (zoneDepartment(z) === dept && z.label.trim() !== dept && !areas.includes(z.label.trim())) areas.push(z.label.trim());
    }
    const aisles = aisleRows.filter((a) => a.shelfIds.some((id) => shelfIds.includes(id))).map((a) => a.el.label.trim());
    deptSections.push({
      key: `dept:${dept}`,
      kind: 'department',
      name: dept,
      also: areas,
      color: list.find((s) => s.color)?.color || '#2f6f3e',
      sub: [areas.join(', '), aisles.join(', '), shelvesLabel(list.length)].filter(Boolean),
      shelfIds,
      box: boxOf(shelfIds)!,
    });
  }

  // ── areas: the named places that are not one department's floor ──
  const areaSections: Section[] = [];
  for (const z of labelledAreas) {
    const name = z.label.trim();
    const inside = shelves.filter((s) => elementContains(z, centerOf(s), 0));
    const depts = unique([...inside.map((s) => deptOf.get(s.id)), zoneDepartment(z)]).filter((d) => deptShelves.has(d));
    if (depts.length === 1) {
      // one department's floor: its other name ("Produce" for Fresh Produce), not a place of its own
      const dept = deptSections.find((d) => d.name === depts[0]);
      if (dept) {
        if (dept.name !== name && !dept.also.includes(name)) {
          dept.also.push(name);
          dept.sub = [dept.also.join(', '), ...dept.sub.slice(1)];
        }
        continue;
      }
    }
    const shelfIds = inside.map((s) => s.id);
    const own = boxOfZone(z);
    const box = boxOf(shelfIds);
    areaSections.push({
      key: `area:${z.id}`,
      kind: 'area',
      name,
      also: depts,
      color: z.color || '#7fa986',
      sub: depts,
      shelfIds,
      box: box ? union([box, own]) : own,
    });
  }

  // ── shelf groups: every titled shelf ──
  const groupSections: Section[] = [];
  for (const s of shelves) {
    const name = groupDisplayName(s);
    if (!name) continue;
    const dept = deptOf.get(s.id) ?? '';
    groupSections.push({
      key: `group:${s.id}`,
      kind: 'group',
      name,
      also: [dept, ...areaName(s)].filter((a) => a && a !== name),
      color: s.color || '#2f6f3e',
      sub: unique([dept, ...areaName(s)]).filter((a) => a !== name),
      shelfIds: [s.id],
      box: boxOfRect(s.geom as RectGeom),
    });
  }

  // a shelf named exactly like the department or the area it stands in ("Pharmacy",
  // the department's one shelf): the place's own row already says all there is
  const places = new Set([...deptSections, ...areaSections].map((s) => s.name.toLowerCase()));
  return [
    ...out.filter((s) => s.kind === 'aisle').sort(natural),
    ...deptSections.sort(natural),
    ...areaSections.sort(natural),
    ...groupSections.filter((g) => !places.has(g.name.toLowerCase())),
  ];
}

/** How well a name answers a query: 0 the name itself, 1 a name that starts
 *  with the query or has it at the start of a word, 2 a name that merely
 *  contains it. A name that does not answer at all is Infinity. */
function score(name: string, needle: string): number {
  const lower = name.toLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) return Infinity;
  if (lower === needle) return 0;
  return at === 0 || /[\s&,'’\/-]/.test(lower[at - 1]) ? 1 : 2;
}

const natural = (a: Section, b: Section) => a.name.localeCompare(b.name, undefined, { numeric: true });
const KIND_ORDER: Record<SectionKind, number> = { aisle: 0, department: 1, area: 2, group: 3 };

/** The sections answering a query, best first. A name beats another name it
 *  also goes by; among equals an aisle comes before a department, an area and
 *  a shelf. A bare number ("5", "aisle 5") asks for that aisle and no other. */
export function searchSections(sections: Section[], q: string, limit = 4): Section[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const number = /^(?:aisle\s+)?(\d+)$/.exec(needle);
  if (number) {
    return sections
      .filter((s) => s.kind === 'aisle' && s.name.toLowerCase().replace(/^aisle\s+/, '') === number[1])
      .sort(natural)
      .slice(0, limit);
  }
  if (needle.length < 2) return [];
  const ranked: { s: Section; rank: number }[] = [];
  for (const s of sections) {
    let rank = score(s.name, needle);
    if (!Number.isFinite(rank)) {
      const other = s.also.reduce((best, name) => Math.min(best, score(name, needle)), Infinity);
      if (!Number.isFinite(other)) continue;
      rank = other + 3; // the same test against its other names, a step behind
    }
    ranked.push({ s, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || KIND_ORDER[a.s.kind] - KIND_ORDER[b.s.kind] || natural(a.s, b.s))
    .slice(0, limit)
    .map((r) => r.s);
}
