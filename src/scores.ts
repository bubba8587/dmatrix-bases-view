/**
 * The Scores frame: a Solenoid Properties Frame property on each option note, one row with a
 * column per criterion. Stacked note by note, those rows are the Scores frame Solenoid's Decision
 * Matrix node takes: rows are options, and number and logical columns are the criteria. Text and
 * date columns are never criteria. No Obsidian imports, so `npm test` covers it.
 */
import type { Cell } from './scoring.ts';
import { isFrameYaml } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

export interface ScoreColumn {
	name: string;
	logical: boolean;
}

/** A note's score row: the frame's first row, or null when the property is not a frame. */
export function scoreRow(value: unknown): WeightsRecord | null {
	return isFrameYaml(value) && value.length > 0 ? value[0] : null;
}

/**
 * The criteria across every note's row, in first-appearance order. A column's type is its first
 * filled cell's, the way a Frame guesses a note column: a number or a checkbox makes it a criterion.
 */
export function scoreColumns(rows: (WeightsRecord | null)[]): ScoreColumn[] {
	const order: string[] = [];
	const kind = new Map<string, 'number' | 'logical' | 'other'>();
	for (const row of rows) {
		if (!row) continue;
		for (const [key, v] of Object.entries(row)) {
			if (!order.includes(key)) order.push(key);
			if (kind.has(key) || v === null || v === undefined || v === '') continue;
			if (typeof v === 'number') kind.set(key, 'number');
			else if (typeof v === 'boolean') kind.set(key, 'logical');
			else kind.set(key, 'other');
		}
	}
	return order
		.filter(k => kind.get(k) === 'number' || kind.get(k) === 'logical')
		.map(name => ({ name, logical: kind.get(name) === 'logical' }));
}

export function cellsOf(row: WeightsRecord | null, columns: ScoreColumn[]): Cell[] {
	return columns.map(c => {
		const v = row?.[c.name];
		return typeof v === 'number' || typeof v === 'boolean' ? v : null;
	});
}

/** The note's Scores frame with one cell set; a missing or empty frame becomes a one-row frame. */
export function setScore(value: unknown, key: string, cell: Cell): WeightsRecord[] {
	const frame = isFrameYaml(value) && value.length > 0 ? value.map(r => ({ ...r })) : [{}];
	frame[0][key] = cell;
	return frame;
}

/**
 * Adds the criteria a Weights frame names that no note scores yet, as empty number columns, so a
 * criterion exists from the moment it is added. Solenoid reads a declared number column with blank
 * cells the same way: every option scores 0 there and its weight still counts in Σ|w|.
 */
export function withListed(columns: ScoreColumn[], listed: string[]): ScoreColumn[] {
	const have = new Set(columns.map(c => c.name.trim().toLowerCase()));
	const out = [...columns];
	for (const name of listed) {
		const key = name.trim().toLowerCase();
		if (!key || have.has(key)) continue;
		have.add(key);
		out.push({ name: name.trim(), logical: false });
	}
	return out;
}

/** The note's Scores frame with a column renamed, keeping column order; null when nothing changes. */
export function renameScore(value: unknown, from: string, to: string): WeightsRecord[] | null {
	if (!isFrameYaml(value) || !value.some(r => from in r)) return null;
	return value.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k === from ? to : k, v])));
}

/** The note's Scores frame without a column; null when nothing changes. */
export function dropScore(value: unknown, key: string): WeightsRecord[] | null {
	if (!isFrameYaml(value) || !value.some(r => key in r)) return null;
	return value.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)));
}
