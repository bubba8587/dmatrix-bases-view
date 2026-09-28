/**
 * The bridge to the Solenoid Properties plugin, which owns the Frame property type and its editor.
 * The Weights frame is a Solenoid Frame property, so this view shows it as Solenoid's own chip and
 * opens Solenoid's own Frame editor on it, through the plugin's `chip()` (the same call it uses for
 * Knap notes), and only reads and writes the YAML itself.
 */
import type { App } from 'obsidian';
import { parsePluginColumnTypes } from './frame.ts';
import type { PluginColumnTypes } from './frame.ts';

export const SOLENOID_ID = 'solenoid-properties';
export const FRAME_TYPE = 'solenoid-frame';

const FRAME_KIND = { id: FRAME_TYPE, name: 'Frame', shape: 'frame' } as const;

interface SolenoidPlugin {
	loadData(): Promise<unknown>;
	chip(el: HTMLElement, kind: typeof FRAME_KIND, key: string, value: unknown, onChange: (next: unknown) => void): ShadowRoot;
	release(el: Element): void;
}

interface PluginRegistry {
	enabledPlugins?: Set<string>;
	getPlugin(id: string): unknown;
}

interface TypeManager {
	getAssignedWidget?(name: string): string | null;
	setType?(name: string, type: string): void;
}

export function solenoid(app: App): SolenoidPlugin | null {
	const registry = (app as unknown as { plugins?: PluginRegistry }).plugins;
	const plugin = registry?.getPlugin(SOLENOID_ID) as Partial<SolenoidPlugin> | null | undefined;
	if (!plugin || typeof plugin.chip !== 'function' || typeof plugin.release !== 'function') return null;
	return plugin as SolenoidPlugin;
}

/** Solenoid's Frame chip for a property, in `el`. */
export function frameChip(app: App, el: HTMLElement, key: string, value: unknown, onChange: (next: unknown) => void): void {
	solenoid(app)?.chip(el, FRAME_KIND, key, value, onChange);
}

/** Unmounts every Solenoid chip inside `el`, before it is emptied. */
export function releaseChips(app: App, el: Element): void {
	solenoid(app)?.release(el);
}

/**
 * The column types picked in Solenoid Properties' Frame editor, from its own `data.json` (the file
 * Solenoid's Note import reads them from). A pick sits above the guess for that column.
 */
export async function loadColumnTypes(app: App): Promise<PluginColumnTypes> {
	try {
		return parsePluginColumnTypes(await solenoid(app)?.loadData());
	} catch {
		return {};
	}
}

/** Types the property as a Solenoid Frame vault-wide, so the properties panel shows the chip too. */
export function assignFrameType(app: App, key: string): void {
	const types = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager;
	if (types?.getAssignedWidget?.(key) === FRAME_TYPE) return;
	types?.setType?.(key, FRAME_TYPE);
}
