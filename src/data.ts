/**
 * Bases rows into the matrix: each note is an option, and its Scores frame's number and checkbox
 * columns are the criteria.
 */
import type { App, BasesEntry, BasesEntryGroup, BasesPropertyId } from 'obsidian';
import { cellsOf, scoreColumns, scoreRow, withListed } from './scores.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { listedCriteria } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

function rowOf(app: App, entry: BasesEntry, scoresKey: string): WeightsRecord | null {
	return scoreRow(app.metadataCache.getFileCache(entry.file)?.frontmatter?.[scoresKey]);
}

/** The Scores columns across the notes, then any criterion only the Weights frame names so far. */
export function detectCriteria(app: App, entries: BasesEntry[], scoresKey: string, weights: WeightsRecord[] | null): MatrixCriterion[] {
	const columns = scoreColumns(entries.map(e => rowOf(app, e, scoresKey)));
	return withListed(columns, listedCriteria(weights)).map(c => ({ ...c, label: c.name }));
}

function toItem(app: App, entry: BasesEntry, criteria: MatrixCriterion[], scoresKey: string): DecisionItem {
	const title = entry.getValue('note.title' as BasesPropertyId)?.toString().trim();
	return {
		id: entry.file.path,
		file: entry.file,
		title: title && title !== 'null' ? title : entry.file.basename,
		cells: cellsOf(rowOf(app, entry, scoresKey), criteria),
	};
}

export function groupsOf(app: App, groupedData: BasesEntryGroup[], criteria: MatrixCriterion[], scoresKey: string): ItemGroup[] {
	return groupedData.map(g => ({
		key: g.hasKey() ? String(g.key) : '',
		items: g.entries.map(e => toItem(app, e, criteria, scoresKey)),
	}));
}
