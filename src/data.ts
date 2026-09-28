/**
 * Bases rows into the matrix: rows are options (notes), and number or checkbox properties are the
 * criteria, the way Solenoid's Decision Matrix reads a Frame's number and logical columns. Dates and
 * text are never criteria.
 */
import { BooleanValue, NumberValue } from 'obsidian';
import type { App, BasesEntry, BasesEntryGroup, BasesPropertyId, BasesViewConfig } from 'obsidian';
import type { Cell } from './scoring.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';

const bareName = (id: string): string => id.slice(id.indexOf('.') + 1);

function readCell(entry: BasesEntry, id: BasesPropertyId): Cell | undefined {
	const v = entry.getValue(id);
	if (v instanceof NumberValue) return Number(v.toString());
	if (v instanceof BooleanValue) return v.isTruthy();
	if (v == null || v.toString() === '' || v.toString() === 'null') return null;
	return undefined;
}

/** A column is a criterion when its first scored cell is a number or a checkbox. */
function kindOf(entries: BasesEntry[], id: BasesPropertyId): 'number' | 'logical' | null {
	for (const entry of entries) {
		const c = readCell(entry, id);
		if (c === null) continue;
		if (c === undefined) return null;
		return typeof c === 'boolean' ? 'logical' : 'number';
	}
	return null;
}

export function detectCriteria(
	app: App,
	config: BasesViewConfig,
	entries: BasesEntry[],
	skip: string,
): MatrixCriterion[] {
	let ids = config.getOrder().filter(id => !id.startsWith('file.'));
	// A view with no chosen properties (a fresh Rankings view) scores every note property.
	if (ids.length === 0) {
		const seen = new Set<string>();
		for (const entry of entries) {
			const fm = app.metadataCache.getFileCache(entry.file)?.frontmatter ?? {};
			for (const key of Object.keys(fm)) seen.add(key);
		}
		ids = [...seen].map(k => `note.${k}` as BasesPropertyId);
	}
	const out: MatrixCriterion[] = [];
	for (const id of ids) {
		const name = bareName(id);
		if (name === skip || name === 'title') continue;
		const kind = kindOf(entries, id);
		if (!kind) continue;
		out.push({
			id,
			name,
			label: config.getDisplayName(id),
			editable: id.startsWith('note.'),
			logical: kind === 'logical',
		});
	}
	return out;
}

function toItem(entry: BasesEntry, criteria: MatrixCriterion[]): DecisionItem {
	const title = entry.getValue('note.title' as BasesPropertyId)?.toString().trim();
	return {
		id: entry.file.path,
		file: entry.file,
		title: title && title !== 'null' ? title : entry.file.basename,
		cells: criteria.map(c => readCell(entry, c.id) ?? null),
	};
}

export function groupsOf(groupedData: BasesEntryGroup[], criteria: MatrixCriterion[]): ItemGroup[] {
	return groupedData.map(g => ({
		key: g.hasKey() ? String(g.key) : '',
		items: g.entries.map(e => toItem(e, criteria)),
	}));
}
