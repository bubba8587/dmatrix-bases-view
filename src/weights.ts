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

function keysOf(records: WeightsRecord[]): string[] {
	const keys: string[] = [];
	for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
	return keys;
}

/** A column's type is its first non-blank cell's, the way a Frame guesses a note column. */
function columnType(records: WeightsRecord[], key: string): 'string' | 'number' | 'logical' | 'blank' {
	for (const rec of records) {
		const v = rec[key];
		if (v === null || v === undefined || v === '') continue;
		if (typeof v === 'number') return 'number';
		if (typeof v === 'boolean') return 'logical';
		return 'string';
	}
	return 'blank';
}

export interface WeightsLayout {
	criterionKey: string | null;
	weightKey: string | null;
	normKey: string | null;
}

export function layoutOf(records: WeightsRecord[]): WeightsLayout {
	const keys = keysOf(records);
	const criterionKey = keys.find(k => columnType(records, k) === 'string') ?? null;
	const nums = keys.filter(k => columnType(records, k) === 'number');
	const weightKey = nums.find(k => ['weight', 'weights', 'value'].includes(critKey(k))) ?? nums[0] ?? null;
	const normKey = keys.find(k => k !== criterionKey && critKey(k) === 'norm') ?? null;
	return { criterionKey, weightKey, normKey };
}

function rowIndex(records: WeightsRecord[], criterionKey: string | null): Map<string, number> {
	const m = new Map<string, number>();
	if (!criterionKey) return m;
	records.forEach((rec, i) => {
		const v = rec[criterionKey];
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

const numOrNull = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null;

export function resolveWeights(frame: WeightsRecord[] | null, criteria: Criterion[]): ResolvedWeights {
	if (!frame) {
		return { weights: criteria.map(() => 1), norms: criteria.map(() => null), listed: criteria.map(() => false) };
	}
	const layout = layoutOf(frame);
	const index = rowIndex(frame, layout.criterionKey);
	const rows = criteria.map(c => rowOf(index, c));
	return {
		weights: rows.map(r => (r != null && layout.weightKey ? numOrNull(frame[r][layout.weightKey]) : null) ?? 1),
		norms: rows.map(r => (r != null && layout.normKey ? parseNormalize(frame[r][layout.normKey]) : null)),
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
): WeightsRecord[] {
	const layout = layoutOf(frame);
	const criterionKey = layout.criterionKey ?? 'Criterion';
	const key = pick(layout) ?? fallbackKey;
	const out = frame.map(rec => ({ ...rec }));
	const r = rowOf(rowIndex(out, criterionKey), c);
	if (r != null) out[r][key] = value;
	else out.push({ [criterionKey]: c.name, [key]: value });
	return out;
}

export function setWeight(frame: WeightsRecord[], c: Criterion, weight: number): WeightsRecord[] {
	return setCell(frame, c, l => l.weightKey, 'Weight', weight);
}

export function setNorm(frame: WeightsRecord[], c: Criterion, mode: Normalize | null): WeightsRecord[] {
	return setCell(frame, c, l => l.normKey, 'Norm', mode ? NORM_TEXT[mode] : null);
}

/** Every criterion the frame names, in row order. */
export function listedCriteria(frame: WeightsRecord[] | null): string[] {
	if (!frame) return [];
	const { criterionKey } = layoutOf(frame);
	if (!criterionKey) return [];
	return frame.flatMap(r => (typeof r[criterionKey] === 'string' ? [r[criterionKey] as string] : []));
}

/** Adds a row for a new criterion; the frame is created when there is none. */
export function addCriterion(frame: WeightsRecord[], name: string): WeightsRecord[] {
	if (frame.length === 0) return [{ Criterion: name, Weight: 1, Norm: null }];
	const layout = layoutOf(frame);
	const row: WeightsRecord = { [layout.criterionKey ?? 'Criterion']: name, [layout.weightKey ?? 'Weight']: 1 };
	if (layout.normKey) row[layout.normKey] = null;
	return [...frame, row];
}

/** Renames a criterion's row; returns the frame unchanged when it has no row for it. */
export function renameCriterion(frame: WeightsRecord[], c: Criterion, to: string): WeightsRecord[] {
	const { criterionKey } = layoutOf(frame);
	if (!criterionKey) return frame;
	const r = rowOf(rowIndex(frame, criterionKey), c);
	return frame.map((rec, i) => (i === r ? { ...rec, [criterionKey]: to } : rec));
}

/** Drops a criterion's row. */
export function removeCriterion(frame: WeightsRecord[], c: Criterion): WeightsRecord[] {
	const { criterionKey } = layoutOf(frame);
	const r = criterionKey ? rowOf(rowIndex(frame, criterionKey), c) : undefined;
	return r == null ? frame : frame.filter((_, i) => i !== r);
}
