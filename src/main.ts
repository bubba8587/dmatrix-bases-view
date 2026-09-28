import { Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { App, SettingDefinitionItem } from 'obsidian';
import { DecisionMatrixView } from './matrix-view.ts';
import { DecisionMatrixRankingsView } from './rankings-view.ts';
import { assignFrameType, solenoid } from './solenoid.ts';
import { DEFAULT_SCORES_PROPERTY, DEFAULT_WEIGHTS_PROPERTY } from './types.ts';
import { HOVER_SOURCE, viewOptions } from './view.ts';

export default class DecisionMatrixPlugin extends Plugin {
	/** 0.7's score prefix setting, still in this plugin's data.json, for converting a 0.7 decision. */
	private legacyPrefix = '';

	async onload(): Promise<void> {
		const data: unknown = await this.loadData();
		const prefix = typeof data === 'object' && data !== null ? (data as { scorePrefix?: unknown }).scorePrefix : undefined;
		if (typeof prefix === 'string') this.legacyPrefix = prefix;
		const legacy = () => this.legacyPrefix;

		this.registerBasesView('decision-matrix', {
			name: 'Decision Matrix',
			icon: 'scale',
			factory: (controller, containerEl) => new DecisionMatrixView(controller, containerEl, legacy),
			options: () => viewOptions(),
		});
		this.registerBasesView('decision-matrix-rankings', {
			name: 'Decision Matrix Rankings',
			icon: 'award',
			factory: (controller, containerEl) => new DecisionMatrixRankingsView(controller, containerEl, legacy),
			options: () => viewOptions(),
		});
		this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Decision Matrix', defaultMod: true });
		this.addSettingTab(new DecisionMatrixSettingsTab(this.app, this));
	}
}

class DecisionMatrixSettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
	}

	private rows(): { name: string; render: (setting: Setting) => void }[] {
		const rows: { name: string; render: (setting: Setting) => void }[] = [];
		if (!solenoid(this.app)) {
			rows.push({
				name: 'Solenoid Properties',
				render: (setting) => { setting.setDesc('Decision Matrix needs the Solenoid Properties plugin for its scores and weights frames. Install and enable it from community plugins.'); },
			});
		}
		rows.push({
			name: 'Example notes',
			render: (setting) => {
				setting
					.setDesc(`Adds a "${FOLDER}" folder: four laptops, a base with both views, and a decision note with a weights frame.`)
					.addButton(btn => btn.setButtonText('Create examples').setCta().onClick(() => void createExamples(this.app)));
			},
		});
		return rows;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.rows().map(row => ({ name: row.name, render: (setting: Setting) => row.render(setting.setName(row.name)) }));
	}

	/** Obsidian before 1.13 draws the tab through this; 1.13 draws it from the definitions. */
	display(): void {
		this.containerEl.empty();
		for (const row of this.rows()) row.render(new Setting(this.containerEl).setName(row.name));
	}
}

const FOLDER = 'Decision Matrix Examples';

const LAPTOPS: { name: string; scores: Record<string, number | boolean>; blurb: string }[] = [
	{ name: 'Laptop A', scores: { cost: 1200, performance: 7, portability: 6, build_quality: 9, battery: 7, backlit: true }, blurb: 'High-end workstation. Great build, decent battery.' },
	{ name: 'Laptop B', scores: { cost: 950, performance: 9, portability: 4, build_quality: 8, battery: 5, backlit: true }, blurb: 'Gaming powerhouse. Heavy but fast.' },
	{ name: 'Laptop C', scores: { cost: 800, performance: 5, portability: 9, build_quality: 7, battery: 9, backlit: false }, blurb: 'Ultra-portable with great battery.' },
	{ name: 'Laptop D', scores: { cost: 1600, performance: 8, portability: 7, build_quality: 9, battery: 8, backlit: true }, blurb: 'Premium all-rounder. Expensive but balanced.' },
];

async function createExamples(app: App): Promise<void> {
	const vault = app.vault;
	if (!vault.getAbstractFileByPath(FOLDER)) await vault.createFolder(FOLDER);

	const note = (props: string[], body: string[]) => ['---', ...props, '---', '', ...body, ''].join('\n');
	const filters = [
		'    filters:',
		'      and:',
		`        - file.folder == "${FOLDER}"`,
		'        - \'file.ext == "md"\'',
		'        - \'file.name != "Laptop Decision"\'',
	];
	const base = [
		'views:',
		'  - type: decision-matrix',
		'    name: Laptop Matrix',
		...filters,
		'  - type: decision-matrix-rankings',
		'    name: Laptop Rankings',
		...filters,
		'    detail: breakdown',
		'',
	].join('\n');

	// The Weights frame, one row per criterion. Cost is the price in dollars: a higher price is worse,
	// so it weighs negative and ranks by order instead of by size.
	const weights: [string, number, string | null][] = [
		['cost', -3, 'Rank'],
		['performance', 5, null],
		['portability', 2, null],
		['build_quality', 4, null],
		['battery', 3, null],
		['backlit', 1, null],
	];
	const decision = note(
		[
			'title: Laptop Decision',
			`${DEFAULT_WEIGHTS_PROPERTY}:`,
			...weights.flatMap(([c, w, n]) => [`  - Criterion: ${c}`, `    Weight: ${w}`, `    Norm: ${n ?? 'null'}`]),
		],
		[
			'# Laptop Decision',
			'',
			'Each laptop keeps its scores in a `scores` Frame, and the weights live in the `weights` Frame above. Cost weighs negative because a higher price is worse, and its Norm is Rank so the laptops compare by price order rather than dollars.',
			'',
			'![[laptop-comparison.base#Laptop Matrix]]',
			'',
			'![[laptop-comparison.base#Laptop Rankings]]',
		],
	);

	const files = [
		...LAPTOPS.map(l => ({
			path: `${FOLDER}/${l.name}.md`,
			content: note([
				`title: ${l.name}`,
				`${DEFAULT_SCORES_PROPERTY}:`,
				...Object.entries(l.scores).map(([k, v], i) => `${i === 0 ? '  - ' : '    '}${k}: ${v}`),
			], [l.blurb]),
		})),
		{ path: `${FOLDER}/laptop-comparison.base`, content: base },
		{ path: `${FOLDER}/Laptop Decision.md`, content: decision },
	];

	assignFrameType(app, DEFAULT_WEIGHTS_PROPERTY);
	assignFrameType(app, DEFAULT_SCORES_PROPERTY);
	// Typed as the Frame editor would type them on save.
	await solenoid(app)?.setColumnTypes(DEFAULT_SCORES_PROPERTY,
		Object.fromEntries(Object.entries(LAPTOPS[0].scores).map(([k, v]) => [k, typeof v === 'boolean' ? 'logical' : 'number'])));
	await solenoid(app)?.setColumnTypes(DEFAULT_WEIGHTS_PROPERTY, { Criterion: 'string', Weight: 'number', Norm: 'string' });
	let created = 0;
	for (const f of files) {
		if (vault.getAbstractFileByPath(f.path)) continue;
		await vault.create(f.path, f.content);
		created++;
	}
	new Notice(created > 0 ? `Created ${created} files in ${FOLDER}` : `The examples already exist in ${FOLDER}`);
}
