/**
 * Bases rows into the matrix: each note is an option, and the number and checkbox columns of the
 * notes' Scores frames, stacked and typed the way Solenoid types them, are the criteria.
 */
import type { App, BasesEntry, BasesEntryGroup } from 'obsidian';
import type { PluginColumnTypes } from './frame.ts';
import type { Cell } from './scoring.ts';
import { scoreRow, scoreTable, withListed } from './scores.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { listedCriteria } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

export interface MatrixData {
	criteria: MatrixCriterion[];
	/** Per note path, one cell per criterion, and each as written. */
	cells: Map<string, { cells: Cell[]; raw: string[] }>;
}

function titleOf(entry: BasesEntry): string {
	const title = entry.getValue('note.title')?.toString().trim();
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
	const columns = withListed(table.columns, listedCriteria(weights, picks[weightsKey]), table.names);
	const criteria = columns.map(c => ({ ...c, label: c.name }));
	const n = table.columns.length;
	const cells = new Map(entries.map((e, i) => [e.file.path, {
		cells: criteria.map((_, j) => (j < n ? table.cells[i][j] : null)),
		raw: criteria.map((_, j) => (j < n ? table.raw[i][j] : '')),
	}]));
	return { criteria, cells };
}

export function groupsOf(groupedData: Pick<BasesEntryGroup, 'key' | 'hasKey' | 'entries'>[], cells: MatrixData['cells']): ItemGroup[] {
	return groupedData.map(g => ({
		key: g.hasKey() ? String(g.key) : '',
		items: g.entries.map((e): DecisionItem => ({
			id: e.file.path,
			file: e.file,
			title: titleOf(e),
			cells: cells.get(e.file.path)?.cells ?? [],
			raw: cells.get(e.file.path)?.raw ?? [],
		})),
	}));
}
