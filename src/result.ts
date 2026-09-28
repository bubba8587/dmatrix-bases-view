/**
 * The result as a Frame for the decision note: the table Solenoid's Decision Matrix node outputs,
 * best first, Option · [each criterion's signed contribution, under Breakdown] · Score · Rank. A
 * column name already taken gets a number (Score2), as Solenoid's `makeHeaders` does. No Obsidian imports, so `npm test` covers it.
 */
import type { ColumnType } from './frame.ts';
import type { Detail, MatrixResult } from './scoring.ts';
import type { WeightsRecord } from './weights.ts';

export interface ResultFrame {
	rows: WeightsRecord[];
	/** The column types to record for the property. */
	types: Record<string, ColumnType>;
}

/** Solenoid's `makeHeaders`: names trimmed, a blank one ColN, a repeat Name2, Name3 and so on. */
export function uniqueNames(names: string[]): string[] {
	const raw = names.map((n, i) => (n.trim() !== '' ? n.trim() : `Col${i + 1}`));
	const seen = new Set<string>();
	return raw.map(name => {
		if (!seen.has(name)) { seen.add(name); return name; }
		let n = 2;
		while (seen.has(`${name}${n}`)) n++;
		seen.add(`${name}${n}`);
		return `${name}${n}`;
	});
}

export function resultFrame(options: string[], criteria: string[], result: MatrixResult, detail: Detail): ResultFrame {
	const breakdown = detail === 'breakdown';
	const names = uniqueNames(['Option', ...(breakdown ? criteria : []), 'Score', 'Rank']);
	const order = options.map((_, i) => i).sort((a, b) => result.ranks[a] - result.ranks[b] || a - b);
	const rows = order.map(i => {
		const cells = [options[i], ...(breakdown ? result.contributions.map(col => col[i]) : []), result.scores[i], result.ranks[i]];
		return Object.fromEntries(names.map((n, k) => [n, cells[k]]));
	});
	const types: Record<string, ColumnType> = Object.fromEntries(names.map((n, k) => [n, k === 0 ? 'string' : 'number']));
	return { rows, types };
}
