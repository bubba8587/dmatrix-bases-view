/**
 * Bases rows into the matrix: each note is an option, and the number and checkbox columns of the
 * notes' Scores frames, stacked and typed the way Solenoid types them, are the criteria.
 */
import type { App, BasesEntry, BasesEntryGroup, BasesPropertyId } from 'obsidian';
import type { PluginColumnTypes } from './frame.ts';
import type { Cell } from './scoring.ts';
import { scoreProblems, scoreRow, scoreTable, withListed } from './scores.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { listedCriteria } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

export interface MatrixData {
	criteria: MatrixCriterion[];
	/** Per note path, one cell per criterion. */
	cells: Map<string, Cell[]>;
	/** Columns that read as text because some note has a stray value, with those notes. */
	problems: { name: string; notes: DecisionItem[] }[];
}

function titleOf(entry: BasesEntry): string {
	const title = entry.getValue('note.title' as BasesPropertyId)?.toString().trim();
	return title && title !== 'null' ? title : entry.file.basename;
}

export function readMatrix(
	app: App,
	entries: BasesEntry[],
	scoresKey: string,
	weights: WeightsRecord[] | null,
	weightsKey: string,
	picks: PluginColumnTypes,
): MatrixData {
	const rows = entries.map(e => scoreRow(app.metadataCache.getFileCache(e.file)?.frontmatter?.[scoresKey]));
	const table = scoreTable(rows, picks[scoresKey]);
	const problems = scoreProblems(rows, picks[scoresKey]).map(p => ({
		name: p.name,
		notes: p.notes.map((i): DecisionItem => ({ id: entries[i].file.path, file: entries[i].file, title: titleOf(entries[i]), cells: [] })),
	}));
	// A column demoted to text by a stray value is not a pending criterion: its notes do have values.
	const demoted = new Set(problems.map(p => p.name.trim().toLowerCase()));
	const listed = listedCriteria(weights, picks[weightsKey]).filter(n => !demoted.has(n.trim().toLowerCase()));
	const columns = withListed(table.columns, listed);
	const criteria = columns.map(c => ({ ...c, label: c.name }));
	const cells = new Map(entries.map((e, i) => [
		e.file.path,
		criteria.map((c, j) => (j < table.columns.length ? table.cells[i][j] : null)),
	]));
	return { criteria, cells, problems };
}

export function groupsOf(groupedData: BasesEntryGroup[], cells: Map<string, Cell[]>): ItemGroup[] {
	return groupedData.map(g => ({
		key: g.hasKey() ? String(g.key) : '',
		items: g.entries.map((e): DecisionItem => ({
			id: e.file.path,
			file: e.file,
			title: titleOf(e),
			cells: cells.get(e.file.path) ?? [],
		})),
	}));
}
