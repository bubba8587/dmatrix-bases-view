/**
 * The bridge to the Solenoid Properties plugin, which owns the Frame property type, its chip and
 * editor, and every Frame property's column types. The Scores and Weights frames are Solenoid Frame
 * properties, so this view shows them with Solenoid's own chip and editor and records their column
 * types the way the editor does; it only reads and writes the YAML itself.
 *
 * Solenoid Properties carries a versioned `api` for this (its spec, § The API for other plugins).
 * Releases before it have none, so each call falls back to the methods those releases have.
 */
import type { App } from 'obsidian';
import { parsePluginColumnTypes } from './frame.ts';
import type { ColumnPicks, PluginColumnTypes } from './frame.ts';

export const SOLENOID_ID = 'solenoid-properties';
export const FRAME_TYPE = 'solenoid-frame';

const FRAME_KIND = { id: FRAME_TYPE, name: 'Frame', shape: 'frame' } as const;

/** Solenoid Properties' `api`, version 1. */
interface SolenoidApiV1 {
	version: number;
	COLUMN_TYPES_EVENT: string;
	frameChip(el: HTMLElement, key: string, value: unknown, onChange: (next: unknown) => void): void;
	release(el: Element): void;
	columnTypes(key: string): ColumnPicks;
	setColumnTypes(key: string, types: ColumnPicks, replace?: boolean): Promise<void>;
}

/** What releases before the API have. */
interface LegacyPlugin {
	loadData(): Promise<unknown>;
	chip(el: HTMLElement, kind: typeof FRAME_KIND, key: string, value: unknown, onChange: (next: unknown) => void): ShadowRoot;
	release(el: Element): void;
	setColumnTypes?(key: string, types: ColumnPicks, replace?: boolean): Promise<void>;
}

/** One interface over both. */
export interface Solenoid {
	frameChip(el: HTMLElement, key: string, value: unknown, onChange: (next: unknown) => void): void;
	release(el: Element): void;
	columnTypes(keys: string[]): Promise<PluginColumnTypes>;
	setColumnTypes(key: string, types: ColumnPicks, replace?: boolean): Promise<void>;
	/** The workspace event a column-type change triggers, when this release has one. */
	columnTypesEvent: string | null;
}

interface PluginRegistry {
	getPlugin(id: string): unknown;
}

interface TypeManager {
	getAssignedWidget?(name: string): string | null;
	setType?(name: string, type: string): void;
}

function fromApi(api: SolenoidApiV1): Solenoid {
	return {
		frameChip: (el, key, value, onChange) => api.frameChip(el, key, value, onChange),
		release: (el) => api.release(el),
		columnTypes: (keys) => Promise.resolve(Object.fromEntries(keys.map(k => [k, api.columnTypes(k)]))),
		setColumnTypes: (key, types, replace) => api.setColumnTypes(key, types, replace),
		columnTypesEvent: api.COLUMN_TYPES_EVENT,
	};
}

function fromLegacy(plugin: LegacyPlugin): Solenoid {
	return {
		frameChip: (el, key, value, onChange) => { plugin.chip(el, FRAME_KIND, key, value, onChange); },
		release: (el) => plugin.release(el),
		columnTypes: async (keys) => {
			const all = parsePluginColumnTypes(await plugin.loadData());
			return Object.fromEntries(keys.map(k => [k, all[k] ?? {}]));
		},
		setColumnTypes: async (key, types, replace) => { await plugin.setColumnTypes?.(key, types, replace); },
		columnTypesEvent: null,
	};
}

/** Solenoid Properties, when it is installed and enabled; null otherwise. */
export function solenoid(app: App): Solenoid | null {
	// Obsidian has no public way to reach another plugin; `app.plugins` is how plugins do it.
	const registry = (app as unknown as { plugins?: PluginRegistry }).plugins;
	const plugin = registry?.getPlugin(SOLENOID_ID) as (Partial<LegacyPlugin> & { api?: Partial<SolenoidApiV1> }) | null | undefined;
	if (!plugin) return null;
	const api = plugin.api;
	if (api && api.version === 1 && typeof api.frameChip === 'function') return fromApi(api as SolenoidApiV1);
	if (typeof plugin.chip === 'function' && typeof plugin.release === 'function' && typeof plugin.loadData === 'function') {
		return fromLegacy(plugin as LegacyPlugin);
	}
	return null;
}

/** Types the property as a Solenoid Frame vault-wide, so the properties panel shows the chip too. */
export function assignFrameType(app: App, key: string): void {
	// The property type registry is not in Obsidian's public API; Solenoid Properties uses it the same way.
	const types = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager;
	if (types?.getAssignedWidget?.(key) === FRAME_TYPE) return;
	types?.setType?.(key, FRAME_TYPE);
}
