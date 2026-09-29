/**
 * The joined Scores frame: every option's score row stacked under an Option column, the table
 * Solenoid's Decision Matrix node takes as its Scores input. The view opens it in Solenoid
 * Properties' Frame editor, and a Save splits it back into each note's Scores frame. No Obsidian
 * imports, so `npm test` covers it.
 */
import { uniqueNames } from './result.ts';
import { isFrameYaml } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

export interface JoinedOption {
	title: string;
	/** The note's Scores property as it is, frame or not. */
	scores: unknown;
}

export interface Joined {
	/** The column that names each row's option. */
	optionKey: string;
	/** The score columns, in first-appearance order. */
	columns: string[];
	rows: WeightsRecord[];
}

export interface Split {
	/** Per option index, its new Scores frame; options whose row did not change are left out. */
	writes: { index: number; frame: WeightsRecord[] }[];
	/** Saved rows no option is named by, as their Option text. */
	unmatched: string[];
	/** Columns renamed in the editor, from → to. */
	renames: [string, string][];
	/** Columns removed in the editor. */
	dropped: string[];
}

const firstRow = (scores: unknown): WeightsRecord => (isFrameYaml(scores) && scores.length > 0 ? scores[0] : {});
const isContainer = (v: unknown): boolean => typeof v === 'object' && v !== null;

function columnsOf(rows: readonly WeightsRecord[]): string[] {
	const names: string[] = [];
	for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
	return names;
}

/** Each option's first Scores row under an Option column, named Option2 and so on when a score column is called Option. */
export function joinScores(options: readonly JoinedOption[]): Joined {
	const columns = columnsOf(options.map(o => firstRow(o.scores)));
	const optionKey = uniqueNames([...columns, 'Option'])[columns.length];
	const rows = options.map((o): WeightsRecord => {
		const row = firstRow(o.scores);
		const out: WeightsRecord = { [optionKey]: o.title };
		for (const c of columns) out[c] = c in row ? row[c] : null;
		return out;
	});
	return { optionKey, columns, rows };
}

/**
 * The editor adds and removes columns only at the end, so a column in the same place under a new
 * name, neither name found on the other side, is a rename, unless the old column held values and
 * the new one holds none, which is a column removed and a blank one added. Any other column gone is
 * dropped.
 */
function diffColumns(before: string[], after: string[], had: (c: string) => boolean, has: (c: string) => boolean): { renames: [string, string][]; dropped: string[] } {
	const renames: [string, string][] = [];
	if (before.length === after.length) {
		before.forEach((b, i) => {
			const a = after[i];
			if (a !== b && !after.includes(b) && !before.includes(a) && (has(a) || !had(b))) renames.push([b, a]);
		});
	}
	const renamed = new Set(renames.map(([b]) => b));
	return { renames, dropped: before.filter(b => !after.includes(b) && !renamed.has(b)) };
}

function sameRecord(a: WeightsRecord, b: WeightsRecord): boolean {
	const ka = Object.keys(a), kb = Object.keys(b);
	return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/**
 * The note's new first row: its own keys in their order (renamed in place, dropped when the column
 * went), the saved values over them, then any new column the row fills. A blank new column stays out
 * of the note, and a list or map the editor cannot show survives its blank cell.
 */
function mergeRow(before: WeightsRecord, saved: WeightsRecord, renames: Map<string, string>, dropped: Set<string>): WeightsRecord {
	const next: WeightsRecord = {};
	for (const [k, v] of Object.entries(before)) {
		if (dropped.has(k)) continue;
		const key = renames.get(k) ?? k;
		if (!(key in saved)) { next[key] = v; continue; }
		next[key] = saved[key] === null && isContainer(v) ? v : saved[key];
	}
	for (const [k, v] of Object.entries(saved)) if (!(k in next) && v !== null) next[k] = v;
	return next;
}

/** The editor's saved frame split back into each option's Scores frame, matching rows to options by their Option text, in order. */
export function splitScores(joined: Joined, saved: unknown, options: readonly JoinedOption[]): Split {
	if (!isFrameYaml(saved)) return { writes: [], unmatched: [], renames: [], dropped: [] };
	const after = columnsOf(saved).filter(c => c !== joined.optionKey);
	const filled = (rows: readonly WeightsRecord[], c: string) => rows.some(r => r[c] !== null && r[c] !== undefined && r[c] !== '');
	const { renames, dropped } = diffColumns(joined.columns, after, c => filled(joined.rows, c), c => filled(saved, c));
	const renameMap = new Map(renames);
	const droppedSet = new Set(dropped);

	const byTitle = new Map<string, number[]>();
	options.forEach((o, i) => byTitle.set(o.title, [...(byTitle.get(o.title) ?? []), i]));
	const writes: Split['writes'] = [];
	const unmatched: string[] = [];
	for (const rec of saved) {
		const title = rec[joined.optionKey];
		const text = typeof title === 'string' || typeof title === 'number' ? String(title) : '';
		const index = byTitle.get(text)?.shift();
		if (index === undefined) { unmatched.push(text); continue; }
		const row = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== joined.optionKey));
		const before = firstRow(options[index].scores);
		const next = mergeRow(before, row, renameMap, droppedSet);
		if (sameRecord(before, next)) continue;
		const scores = options[index].scores;
		writes.push({ index, frame: isFrameYaml(scores) && scores.length > 0 ? [next, ...scores.slice(1).map(r => ({ ...r }))] : [next] });
	}
	return { writes, unmatched, renames, dropped };
}
