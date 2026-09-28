/**
 * The Scores frame: a Solenoid Properties Frame property on each option note, one row with a
 * column per criterion. Stacked note by note, those rows are the Scores frame Solenoid's Decision
 * Matrix node takes: rows are options, and number and logical columns are the criteria. Text and
 * date columns are never criteria. No Obsidian imports, so `npm test` covers it.
 */
import { toFrame } from './frame.ts';
import type { ColumnPicks, FrameCell } from './frame.ts';
import type { Cell } from './scoring.ts';
import { isFrameYaml } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

export interface ScoreColumn {
	name: string;
	logical: boolean;
	/** Named by the Weights frame but scored by no note yet. */
	pending?: boolean;
}

/** A note's score row: the frame's first row, or null when the property is not a frame. */
export function scoreRow(value: unknown): WeightsRecord | null {
	return isFrameYaml(value) && value.length > 0 ? value[0] : null;
}

export interface ScoreTable {
	columns: ScoreColumn[];
	/** Per row given, one cell per column. */
	cells: Cell[][];
}

const asCell = (v: FrameCell): Cell => (typeof v === 'number' || typeof v === 'boolean' ? v : null);

/**
 * Every note's row stacked into one Frame and typed the way Solenoid types it, picks first: the
 * number and logical columns are the criteria, in first-appearance order. One text cell in a column
 * of numbers makes it a text column there, so it is no criterion here either; a picked number column
 * reads such a cell as NaN, which scores 0.
 */
export function scoreTable(rows: (WeightsRecord | null)[], picks: ColumnPicks = {}): ScoreTable {
	const frame = toFrame(rows, picks).filter(c => c.type === 'number' || c.type === 'logical');
	return {
		columns: frame.map(c => ({ name: c.name, logical: c.type === 'logical' })),
		cells: rows.map((_, i) => frame.map(c => asCell(c.values[i]))),
	};
}

export function scoreColumns(rows: (WeightsRecord | null)[], picks: ColumnPicks = {}): ScoreColumn[] {
	return scoreTable(rows, picks).columns;
}

/** The note's Scores frame with one cell set; a missing or empty frame becomes a one-row frame. */
export function setScore(value: unknown, key: string, cell: Cell): WeightsRecord[] {
	const frame = isFrameYaml(value) && value.length > 0 ? value.map(r => ({ ...r })) : [{}];
	frame[0][key] = cell;
	return frame;
}

/**
 * Adds the criteria a Weights frame names that no note scores yet, as pending columns, so a new
 * criterion has cells to type into. Solenoid's Scores frame is built from the notes and has no such
 * column, so a pending criterion must not score (its weight stays out of Σ|w|) until a note has a value.
 */
export function withListed(columns: ScoreColumn[], listed: string[]): ScoreColumn[] {
	const have = new Set(columns.map(c => c.name.trim().toLowerCase()));
	const out = [...columns];
	for (const name of listed) {
		const key = name.trim().toLowerCase();
		if (!key || have.has(key)) continue;
		have.add(key);
		out.push({ name: name.trim(), logical: false, pending: true });
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

/**
 * Columns that look like criteria but are not: mostly numbers or checkboxes with a text cell (or a
 * mix of the two) in some note, which makes the stacked column text. Each names the rows at fault.
 */
export function scoreProblems(rows: (WeightsRecord | null)[], picks: ColumnPicks = {}): { name: string; notes: number[] }[] {
	const scoreLike = (v: unknown) => typeof v === 'number' || typeof v === 'boolean';
	return toFrame(rows, picks).flatMap(({ name, type }) => {
		const values = rows.map(r => r?.[name]);
		if (type !== 'string' || !values.some(scoreLike)) return [];
		const majority = values.filter(v => typeof v === 'number').length >= values.filter(v => typeof v === 'boolean').length ? 'number' : 'boolean';
		const notes = values.flatMap((v, i) => (v === null || v === undefined || v === '' || typeof v === majority ? [] : [i]));
		return [{ name, notes }];
	});
}
