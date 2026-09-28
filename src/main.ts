import { Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { DecisionMatrixView } from './matrix-view.ts';
import { DecisionMatrixRankingsView } from './rankings-view.ts';
import { assignFrameType, solenoid } from './solenoid.ts';
import { DEFAULT_WEIGHTS_PROPERTY } from './types.ts';
import { viewOptions } from './view.ts';

export default class DecisionMatrixPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerBasesView('decision-matrix', {
			name: 'Decision Matrix',
			icon: 'scale',
			factory: (controller, containerEl) => new DecisionMatrixView(controller, containerEl),
			options: () => viewOptions(),
		});
		this.registerBasesView('decision-matrix-rankings', {
			name: 'Decision Matrix Rankings',
			icon: 'award',
			factory: (controller, containerEl) => new DecisionMatrixRankingsView(controller, containerEl),
			options: () => viewOptions(),
		});
		this.addSettingTab(new DecisionMatrixSettingsTab(this.app, this));
	}
}

class DecisionMatrixSettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		if (!solenoid(this.app)) {
			new Setting(containerEl)
				.setName('Solenoid Properties')
				.setDesc('Decision Matrix needs the Solenoid Properties plugin for its Weights frame. Install and enable it from Community plugins.');
		}

		new Setting(containerEl)
			.setName('Example notes')
			.setDesc('Adds a "Decision Matrix Examples" folder: four laptops, a base with both views, and a decision note with a Weights frame.')
			.addButton(btn => btn.setButtonText('Create Examples').setCta().onClick(() => void createExamples(this.app)));
	}
}

const FOLDER = 'Decision Matrix Examples';

const LAPTOPS: { name: string; props: Record<string, number | boolean>; blurb: string }[] = [
	{ name: 'Laptop A', props: { cost: 1200, performance: 7, portability: 6, build_quality: 9, battery: 7, backlit: true }, blurb: 'High-end workstation. Great build, decent battery.' },
	{ name: 'Laptop B', props: { cost: 950, performance: 9, portability: 4, build_quality: 8, battery: 5, backlit: true }, blurb: 'Gaming powerhouse. Heavy but fast.' },
	{ name: 'Laptop C', props: { cost: 800, performance: 5, portability: 9, build_quality: 7, battery: 9, backlit: false }, blurb: 'Ultra-portable with great battery.' },
	{ name: 'Laptop D', props: { cost: 1600, performance: 8, portability: 7, build_quality: 9, battery: 8, backlit: true }, blurb: 'Premium all-rounder. Expensive but balanced.' },
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
	const criteria = Object.keys(LAPTOPS[0].props);
	const base = [
		'views:',
		'  - type: decision-matrix',
		'    name: Laptop Matrix',
		...filters,
		'    order:',
		...criteria.map(c => `      - ${c}`),
		'  - type: decision-matrix-rankings',
		'    name: Laptop Rankings',
		...filters,
		'    order:',
		...criteria.map(c => `      - ${c}`),
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
			'The weights live in the `weights` Frame above. Cost weighs negative because a higher price is worse, and its Norm is Rank so the laptops compare by price order rather than dollars.',
			'',
			'![[laptop-comparison.base#Laptop Matrix]]',
			'',
			'![[laptop-comparison.base#Laptop Rankings]]',
		],
	);

	const files = [
		...LAPTOPS.map(l => ({
			path: `${FOLDER}/${l.name}.md`,
			content: note([`title: ${l.name}`, ...Object.entries(l.props).map(([k, v]) => `${k}: ${v}`)], [l.blurb]),
		})),
		{ path: `${FOLDER}/laptop-comparison.base`, content: base },
		{ path: `${FOLDER}/Laptop Decision.md`, content: decision },
	];

	assignFrameType(app, DEFAULT_WEIGHTS_PROPERTY);
	let created = 0;
	for (const f of files) {
		if (vault.getAbstractFileByPath(f.path)) continue;
		await vault.create(f.path, f.content);
		created++;
	}
	new Notice(created > 0 ? `Created ${created} files in ${FOLDER}` : `The examples already exist in ${FOLDER}`);
}
