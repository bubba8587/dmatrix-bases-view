/**
 * The Decision Matrix view: one table, an option per row and a criterion per column, with the
 * criterion's Weight and Norm under its name. Values edit in place and save to the option's note;
 * Weight and Norm save to the Weights frame.
 */
import type { QueryController } from 'obsidian';
import { formatScore } from './scoring.ts';
import type { Normalize } from './scoring.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { DecisionView, NORMALIZE_OPTIONS, draftInput, rankText } from './view.ts';
import type { Model } from './view.ts';

export class DecisionMatrixView extends DecisionView {
	type = 'decision-matrix';
	private collapsed = new Set<string>();

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller, containerEl, 'dmv-matrix');
	}

	protected renderBody(body: HTMLElement, m: Model): void {
		const wrap = body.createDiv('dmv-table-wrap');
		const table = wrap.createEl('table', { cls: 'dmv-table' });
		this.renderHead(table.createEl('thead'), m);

		const tbody = table.createEl('tbody');
		const maxAbs = m.result.scores.reduce((a, s) => Math.max(a, Math.abs(s)), 0);
		const sorted = this.config.getSort().length > 0;
		for (const group of m.groups) {
			if (group.key !== '') this.renderGroupRow(tbody, group, m.criteria.length + 3);
			if (this.collapsed.has(group.key)) continue;
			const items = sorted ? group.items : [...group.items].sort((a, b) => m.result.ranks[m.row.get(a.id)!] - m.result.ranks[m.row.get(b.id)!]);
			for (const item of items) this.renderRow(tbody, item, m, maxAbs);
		}
	}

	private renderHead(thead: HTMLElement, m: Model): void {
		const names = thead.createEl('tr', { cls: 'dmv-head' });
		names.createEl('th', { text: 'Rank', cls: 'dmv-th dmv-th-rank' });
		names.createEl('th', { text: 'Option', cls: 'dmv-th dmv-th-option' });
		for (const c of m.criteria) names.createEl('th', { text: c.label, cls: 'dmv-th dmv-th-num', attr: { title: c.name } });
		names.createEl('th', { text: 'Score', cls: 'dmv-th dmv-th-num dmv-th-score', attr: { title: 'Σ(value × weight) / Σ|weight|' } });

		const weights = thead.createEl('tr', { cls: 'dmv-weights-row' });
		weights.createEl('th', { cls: 'dmv-th' });
		const caption = weights.createEl('th', { cls: 'dmv-th dmv-th-option' });
		caption.createSpan({ text: 'Weight', cls: 'dmv-caption' });
		caption.createSpan({ text: 'Norm', cls: 'dmv-caption' });
		m.criteria.forEach((c, j) => {
			const th = weights.createEl('th', { cls: 'dmv-th dmv-th-num' });
			const cell = th.createDiv('dmv-weight-cell');
			draftInput(cell, 'dmv-input dmv-weight-input', String(m.result.weights[j]), (text) => {
				const w = text === '' ? 1 : Number(text);
				if (Number.isFinite(w)) this.setWeight(c, w);
				else this.render();
			}, { 'aria-label': `Weight of ${c.label}`, title: 'Weight. Negative when lower is better.' });
			this.renderNormSelect(cell, c, m.resolved.norms[j]);
		});
		weights.createEl('th', { cls: 'dmv-th' });
	}

	private renderNormSelect(parent: HTMLElement, c: MatrixCriterion, own: Normalize | null): void {
		const select = parent.createEl('select', {
			cls: own ? 'dmv-norm is-set' : 'dmv-norm',
			attr: { 'aria-label': `Norm of ${c.label}`, title: 'Norm. Blank follows the view\'s Normalize.' },
		});
		const fallback = NORMALIZE_OPTIONS.find(o => o.value === this.normalize)!.label;
		select.createEl('option', { text: `(${fallback})`, value: '' });
		for (const o of NORMALIZE_OPTIONS) select.createEl('option', { text: o.label, value: o.value });
		select.value = own ?? '';
		select.addEventListener('change', () => this.setNorm(c, (select.value || null) as Normalize | null));
	}

	private renderGroupRow(tbody: HTMLElement, group: ItemGroup, span: number): void {
		const tr = tbody.createEl('tr', { cls: 'dmv-group' });
		const td = tr.createEl('td', { attr: { colspan: String(span) } });
		const collapsed = this.collapsed.has(group.key);
		td.createSpan({ cls: collapsed ? 'dmv-chevron is-collapsed' : 'dmv-chevron' });
		td.createSpan({ text: group.key });
		td.createSpan({ text: String(group.items.length), cls: 'dmv-count' });
		tr.addEventListener('click', () => {
			if (collapsed) this.collapsed.delete(group.key);
			else this.collapsed.add(group.key);
			this.render();
		});
	}

	private renderRow(tbody: HTMLElement, item: DecisionItem, m: Model, maxAbs: number): void {
		const i = m.row.get(item.id)!;
		const rank = m.result.ranks[i];
		const tr = tbody.createEl('tr', { cls: rank === 1 ? 'dmv-row is-top' : 'dmv-row' });
		tr.createEl('td', { text: rankText(rank, m.result.tied[i]), cls: 'dmv-td dmv-td-rank' });
		const name = tr.createEl('td', { cls: 'dmv-td dmv-td-option' });
		const link = name.createEl('a', { text: item.title, cls: 'dmv-link', href: '#' });
		link.addEventListener('click', (e) => { e.preventDefault(); this.openNote(item, e); });

		m.criteria.forEach((c, j) => {
			const td = tr.createEl('td', { cls: 'dmv-td dmv-td-num' });
			if (m.detail === 'breakdown') {
				const contribution = m.result.contributions[j][i];
				td.createDiv({ text: formatScore(contribution), cls: contribution < 0 ? 'dmv-contrib is-negative' : 'dmv-contrib' });
			}
			this.renderValue(td, item, c, j);
		});

		const score = tr.createEl('td', { cls: 'dmv-td dmv-td-num dmv-td-score' });
		const s = m.result.scores[i];
		score.createSpan({ text: formatScore(s), cls: 'dmv-score' });
		const gauge = score.createDiv('dmv-gauge');
		const fill = gauge.createDiv(s < 0 ? 'dmv-gauge-fill is-negative' : 'dmv-gauge-fill');
		fill.style.width = `${maxAbs > 0 ? (Math.abs(s) / maxAbs) * 100 : 0}%`;
	}

	private renderValue(td: HTMLElement, item: DecisionItem, c: MatrixCriterion, j: number): void {
		const cell = item.cells[j];
		const sub = td.hasChildNodes();
		if (c.logical) {
			const box = td.createEl('input', { type: 'checkbox', cls: sub ? 'dmv-check is-sub' : 'dmv-check' });
			box.checked = cell === true;
			box.addEventListener('change', () => void this.writeCell(item, c, box.checked));
			return;
		}
		const text = cell === null ? '' : String(cell);
		draftInput(td, sub ? 'dmv-input dmv-value-input is-sub' : 'dmv-input dmv-value-input', text, (next) => {
			if (next === '') { void this.writeCell(item, c, null); return; }
			const n = Number(next);
			if (Number.isFinite(n)) void this.writeCell(item, c, n);
			else this.render();
		}, { 'aria-label': `${c.label} of ${item.title}`, placeholder: '0' });
	}
}
