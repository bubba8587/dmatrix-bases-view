/**
 * The Decision Matrix Rankings view: every option best first as a labeled bar, the same ranking
 * Solenoid's seed draws from a Decision Matrix. Under Breakdown each bar splits into the criteria's
 * signed contributions, penalties left of zero.
 */
import type { QueryController } from 'obsidian';
import { formatScore } from './scoring.ts';
import { DecisionView, rankText } from './view.ts';
import type { Model } from './view.ts';

const SERIES = 8;

export class DecisionMatrixRankingsView extends DecisionView {
	type = 'decision-matrix-rankings';

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller, containerEl, 'dmv-rankings');
	}

	protected renderBody(body: HTMLElement, m: Model): void {
		const { result } = m;
		const order = m.items.map((item, i) => ({ item, i })).sort((a, b) => result.ranks[a.i] - result.ranks[b.i]);
		const breakdown = m.detail === 'breakdown';

		// Zero sits where the largest penalty ends, so every bar shares one axis.
		let pos = 0, neg = 0;
		for (const { i } of order) {
			if (breakdown) {
				let p = 0, n = 0;
				for (const col of result.contributions) { if (col[i] > 0) p += col[i]; else n -= col[i]; }
				pos = Math.max(pos, p); neg = Math.max(neg, n);
			} else {
				const s = result.scores[i];
				pos = Math.max(pos, s); neg = Math.max(neg, -s);
			}
		}
		const span = pos + neg || 1;
		const pct = (v: number) => `${(v / span) * 100}%`;

		if (breakdown) {
			const legend = body.createDiv('dmv-legend');
			m.criteria.forEach((c, j) => {
				const key = legend.createSpan('dmv-legend-item');
				key.createSpan({ cls: `dmv-swatch dmv-series-${j % SERIES}` });
				key.createSpan({ text: c.label });
			});
		}

		const list = body.createDiv('dmv-ranking');
		for (const { item, i } of order) {
			const rank = result.ranks[i];
			const row = list.createDiv(rank === 1 ? 'dmv-rank-row is-top' : 'dmv-rank-row');
			row.createSpan({ text: rankText(rank, result.tied[i]), cls: 'dmv-rank-num' });
			this.optionLink(row, item, 'dmv-link dmv-rank-name');

			const track = row.createDiv('dmv-track');
			if (neg > 0) track.createDiv('dmv-zero').style.left = pct(neg);
			if (breakdown) {
				let right = neg, left = neg;
				result.contributions.forEach((col, j) => {
					const v = col[i];
					if (v === 0) return;
					const seg = track.createDiv({
						cls: `dmv-seg-bar dmv-series-${j % SERIES}${v < 0 ? ' is-negative' : ''}`,
						attr: { title: m.criteria[j].label },
					});
					if (v > 0) { seg.style.left = pct(right); right += v; }
					else { left += v; seg.style.left = pct(left); }
					seg.style.width = pct(Math.abs(v));
				});
			} else {
				const s = result.scores[i];
				const bar = track.createDiv(s < 0 ? 'dmv-bar is-negative' : 'dmv-bar');
				bar.style.left = pct(s < 0 ? neg + s : neg);
				bar.style.width = pct(Math.abs(s));
			}
			row.createSpan({ text: formatScore(result.scores[i]), cls: 'dmv-score' });
		}
	}
}
