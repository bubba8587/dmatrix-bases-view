/**
 * A note's Frame property as Solenoid reads it: YAML records into typed columns. This is a port of
 * Solenoid's Note import (`rowsToFrame` in solenoid `src/graph/nodes/annotation.ts`, with
 * `guessNoteColumnType` and `coerceFrameCell` from `src/graph/frame.ts`), and Solenoid Properties'
 * Frame editor types columns the same way. The editor records every column's type in its `data.json`
 * under `columnTypes[property][column]` on each save; that type decides, and every cell is read as
 * it. The guess only covers a frame the editor has never saved. Keep this in step with Solenoid, or the same notes rank differently in each.
 * No Obsidian imports, so `npm test` covers it.
 */

export type ColumnType = 'string' | 'number' | 'logical' | 'date';
export type FrameCell = string | number | boolean | null;
/** A property's picked column types, by column name. */
export type ColumnPicks = Readonly<Record<string, ColumnType>>;
/** Every property's picks, as Solenoid Properties keeps them: vault-wide, by property name. */
export type PluginColumnTypes = Readonly<Record<string, ColumnPicks>>;

export interface FrameColumn {
	name: string;
	type: ColumnType;
	values: FrameCell[];
	/** Each cell's text as written, for showing a value its type cannot read. */
	raw: string[];
}

const COLUMN_TYPES: readonly ColumnType[] = ['number', 'string', 'date', 'logical'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The picks in Solenoid Properties' `data.json`; anything but a real type is dropped, a malformed body gives {}. */
export function parsePluginColumnTypes(data: unknown): PluginColumnTypes {
	const raw = isRecord(data) ? data.columnTypes : undefined;
	if (!isRecord(raw)) return {};
	const out: Record<string, ColumnPicks> = {};
	for (const [key, cols] of Object.entries(raw)) {
		if (!isRecord(cols)) continue;
		const picks: Record<string, ColumnType> = {};
		for (const [name, t] of Object.entries(cols)) if (COLUMN_TYPES.includes(t as ColumnType)) picks[name] = t as ColumnType;
		if (Object.keys(picks).length) out[key] = picks;
	}
	return out;
}

const isIsoDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim());

/** One family throughout, else text; a column with nothing filled in is text. */
export function noteColumnType(values: unknown[]): ColumnType {
	const present = values.filter(v => v !== null && v !== undefined && v !== '');
	if (present.length === 0) return 'string';
	if (present.every(v => typeof v === 'boolean')) return 'logical';
	if (present.every(v => typeof v === 'number')) return 'number';
	if (present.every(isIsoDate)) return 'date';
	return 'string';
}

const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const GROUPED_TEXT = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/** Plain decimal or scientific, or thousands grouped by commas; anything else is NaN. */
export function decimalFromText(text: string): number {
	const t = text.trim();
	if (DECIMAL_TEXT.test(t)) return Number(t);
	if (GROUPED_TEXT.test(t)) return Number(t.replace(/,/g, ''));
	return NaN;
}

function coerceLogical(s: string): boolean | null {
	const t = s.trim().toLowerCase();
	if (t === 'true') return true;
	if (t === 'false') return false;
	const n = decimalFromText(t);
	return Number.isFinite(n) ? n !== 0 : null;
}

/** A cell's text read as its column's type; an unreadable number is NaN. Dates stay text here: no criterion reads them. */
export function coerceCell(type: ColumnType, raw: string): FrameCell {
	if (type === 'string') return raw === '' ? null : raw;
	const s = raw.trim();
	if (s === '') return null;
	if (type === 'logical') return coerceLogical(s);
	if (type === 'date') return s;
	const n = decimalFromText(s);
	if (Number.isFinite(n)) return n;
	return NaN;
}

/** A YAML cell as the text Solenoid coerces: a checkbox as TRUE or FALSE, a stray list by its first item. */
function rawText(v: unknown): string {
	if (Array.isArray(v)) v = v[0] ?? null;
	if (v === null || v === undefined || typeof v === 'object') return '';
	return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
}

/** Records into typed columns, in first-appearance order of their keys. */
export function toFrame(records: readonly (Record<string, unknown> | null)[], picks: ColumnPicks = {}): FrameColumn[] {
	const names: string[] = [];
	for (const rec of records) for (const k of Object.keys(rec ?? {})) if (!names.includes(k)) names.push(k);
	return names.map(name => {
		const cells = records.map(rec => {
			const v = rec && name in rec ? rec[name] : null;
			return Array.isArray(v) ? (typeof v[0] === 'object' ? null : v[0] ?? null) : v;
		});
		const type = picks[name] ?? noteColumnType(cells);
		const raw = cells.map(rawText);
		return { name, type, values: raw.map(r => coerceCell(type, r)), raw };
	});
}
