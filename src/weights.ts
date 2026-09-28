/**
 * The Weights frame: a Solenoid Properties Frame property on the decision note, one row per
 * criterion (Criterion · Weight · Norm). It is the same criterion-keyed table Solenoid's
 * Decision Matrix node takes on its Weights input, read by the same rules as
 * `resolveDecisionWeights`: the first text column names the criterion (trimmed, case-insensitive,
 * first row wins), the number column named Weight / Weights / Value (else the first number column)
 * is the weight, and an optional Norm column overrides normalizing per criterion.
 *
 * Solenoid Properties saves a Frame as block YAML, a list of records, so that is what this reads
 * and writes. No Obsidian imports, so `npm test` covers it.
 */
import { toFrame } from './frame.ts';
import type { ColumnPicks, FrameCell, FrameColumn } from './frame.ts';
import { parseNormalize, NORM_TEXT } from './scoring.ts';
import type { Normalize } from './scoring.ts';

export type WeightsRecord = Record<string, unknown>;

export interface Criterion {
	/** The bare property name, the key a note stores the score under. */
	name: string;
	/** What the view calls it (a Bases display name when renamed). */
	label: string;
}

export interface ResolvedWeights {
	weights: number[];
	norms: (Normalize | null)[];
	/** Per criterion, whether the frame has a row for it. */
	listed: boolean[];
}

const critKey = (s: string): string => s.trim().toLowerCase();
const isRecord = (v: unknown): v is WeightsRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isFrameYaml(v: unknown): v is WeightsRecord[] {
	return Array.isArray(v) && v.every(isRecord);
}

export interface WeightsLayout {
	criterionKey: string | null;
	weightKey: string | null;
	normKey: string | null;
}

/** Solenoid's reading of the frame's columns: the first text column names, the weight is a number column. */
function layoutOfFrame(cols: FrameColumn[]): WeightsLayout {
	const criterion = cols.find(c => c.type === 'string') ?? null;
	const nums = cols.filter(c => c.type === 'number');
	const weight = nums.find(c => ['weight', 'weights', 'value'].includes(critKey(c.name))) ?? nums[0] ?? null;
	const norm = cols.find(c => c !== criterion && critKey(c.name) === 'norm') ?? null;
	return { criterionKey: criterion?.name ?? null, weightKey: weight?.name ?? null, normKey: norm?.name ?? null };
}

export function layoutOf(records: WeightsRecord[], picks: ColumnPicks = {}): WeightsLayout {
	return layoutOfFrame(toFrame(records, picks));
}

/** Criterion name → first row naming it, from the typed criterion column. */
function rowIndex(cols: FrameColumn[], criterionKey: string | null): Map<string, number> {
	const m = new Map<string, number>();
	const col = cols.find(c => c.name === criterionKey);
	col?.values.forEach((v, i) => {
		if (typeof v === 'string') {
			const k = critKey(v);
			if (k && !m.has(k)) m.set(k, i);
		}
	});
	return m;
}

/** The frame row naming a criterion, by its property name or its display name. */
function rowOf(index: Map<string, number>, c: Criterion): number | undefined {
	return index.get(critKey(c.name)) ?? index.get(critKey(c.label));
}

const numOrNull = (v: FrameCell): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null;

export function resolveWeights(frame: WeightsRecord[] | null, criteria: Criterion[], picks: ColumnPicks = {}): ResolvedWeights {
	if (!frame) {
		return { weights: criteria.map(() => 1), norms: criteria.map(() => null), listed: criteria.map(() => false) };
	}
	const cols = toFrame(frame, picks);
	const layout = layoutOfFrame(cols);
	const index = rowIndex(cols, layout.criterionKey);
	const weightCol = cols.find(c => c.name === layout.weightKey);
	const normCol = cols.find(c => c.name === layout.normKey);
	const rows = criteria.map(c => rowOf(index, c));
	return {
		weights: rows.map(r => (r != null && weightCol ? numOrNull(weightCol.values[r]) : null) ?? 1),
		norms: rows.map(r => (r != null && normCol ? parseNormalize(normCol.values[r]) : null)),
		listed: rows.map(r => r != null),
	};
}

/** A fresh Weights frame: every criterion at weight 1, Norm blank so the view's default applies. */
export function defaultFrame(criteria: Criterion[]): WeightsRecord[] {
	return criteria.map(c => ({ Criterion: c.name, Weight: 1, Norm: null }));
}

/** Returns a copy of the frame with one criterion's cell set, adding the row or column it lacks. */
function setCell(
	frame: WeightsRecord[],
	c: Criterion,
	pick: (layout: WeightsLayout) => string | null,
	fallbackKey: string,
	value: unknown,
	picks: ColumnPicks,
): WeightsRecord[] {
	const cols = toFrame(frame, picks);
	const layout = layoutOfFrame(cols);
	const criterionKey = layout.criterionKey ?? 'Criterion';
	const key = pick(layout) ?? fallbackKey;
	const out = frame.map(rec => ({ ...rec }));
	const r = rowOf(rowIndex(cols, criterionKey), c);
	if (r != null) out[r][key] = value;
	else out.push({ [criterionKey]: c.name, [key]: value });
	return out;
}

export function setWeight(frame: WeightsRecord[], c: Criterion, weight: number, picks: ColumnPicks = {}): WeightsRecord[] {
	return setCell(frame, c, l => l.weightKey, 'Weight', weight, picks);
}

export function setNorm(frame: WeightsRecord[], c: Criterion, mode: Normalize | null, picks: ColumnPicks = {}): WeightsRecord[] {
	return setCell(frame, c, l => l.normKey, 'Norm', mode ? NORM_TEXT[mode] : null, picks);
}

/** Every criterion the frame names, in row order. */
export function listedCriteria(frame: WeightsRecord[] | null, picks: ColumnPicks = {}): string[] {
	if (!frame) return [];
	const cols = toFrame(frame, picks);
	const col = cols.find(c => c.name === layoutOfFrame(cols).criterionKey);
	return col ? col.values.flatMap(v => (typeof v === 'string' ? [v] : [])) : [];
}

/** Adds a row for a new criterion; the frame is created when there is none. */
export function addCriterion(frame: WeightsRecord[], name: string, picks: ColumnPicks = {}): WeightsRecord[] {
	if (frame.length === 0) return [{ Criterion: name, Weight: 1, Norm: null }];
	const layout = layoutOf(frame, picks);
	const row: WeightsRecord = { [layout.criterionKey ?? 'Criterion']: name, [layout.weightKey ?? 'Weight']: 1 };
	if (layout.normKey) row[layout.normKey] = null;
	return [...frame, row];
}

/** Renames a criterion's row; returns the frame unchanged when it has no row for it. */
export function renameCriterion(frame: WeightsRecord[], c: Criterion, to: string, picks: ColumnPicks = {}): WeightsRecord[] {
	const cols = toFrame(frame, picks);
	const { criterionKey } = layoutOfFrame(cols);
	if (!criterionKey) return frame;
	const r = rowOf(rowIndex(cols, criterionKey), c);
	return frame.map((rec, i) => (i === r ? { ...rec, [criterionKey]: to } : rec));
}

/** Drops a criterion's row. */
export function removeCriterion(frame: WeightsRecord[], c: Criterion, picks: ColumnPicks = {}): WeightsRecord[] {
	const cols = toFrame(frame, picks);
	const { criterionKey } = layoutOfFrame(cols);
	const r = criterionKey ? rowOf(rowIndex(cols, criterionKey), c) : undefined;
	return r == null ? frame : frame.filter((_, i) => i !== r);
}
