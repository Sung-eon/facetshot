/**
 * Checks that read a page instead of looking at it: each turns something a reviewer would spot in a screenshot into a
 * line of text, so an agent can find the broken screen without opening every image.
 *
 * `inPage` runs inside the browser and must not use anything from outside its own body.
 */
import type { Finding } from '../types.ts';

export const PAGE_CHECKS = [
	'overflow',
	'clipped',
	'covered',
	'images',
	'blank',
	'targets'
] as const;
export const ALL_CHECKS = ['console', 'network', ...PAGE_CHECKS, 'a11y'] as const;
export type CheckName = (typeof ALL_CHECKS)[number];

export const CHECK_HELP: Record<CheckName, string> = {
	console: 'Errors the page logged or threw.',
	network: 'Requests that failed or answered 4xx/5xx.',
	overflow: 'The page is wider than the screen (sideways scrolling).',
	clipped: 'Text cut off by its box, a line clamp, or the screen edge.',
	covered: 'Buttons and links another element sits on top of.',
	images: 'Images that failed to load.',
	blank: 'A page with nothing on it.',
	targets: 'Tap targets smaller than 24×24 on touch devices.',
	a11y: 'Accessibility problems found by axe-core (contrast, labels, roles). Slower.'
};

export function inPage(args: { checks: string[]; touch: boolean; width: number }): Finding[] {
	const findings: Finding[] = [];
	const want = new Set(args.checks);
	const describe = (element: Element): string => {
		const parts: string[] = [];
		for (
			let at: Element | null = element;
			at && at !== document.body && parts.length < 4;
			at = at.parentElement
		) {
			let part = at.tagName.toLowerCase();
			if (at.id) {
				parts.unshift(`${part}#${at.id}`);
				break;
			}
			const testId = at.getAttribute('data-testid');
			if (testId) {
				parts.unshift(`${part}[data-testid="${testId}"]`);
				break;
			}
			const cls = [...at.classList]
				.filter((name) => !/^(svelte|css|sc|jsx)-/.test(name))
				.slice(0, 2);
			if (cls.length) part += `.${cls.join('.')}`;
			parts.unshift(part);
		}
		return parts.join(' > ');
	};
	const shown = (element: Element): boolean => {
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
			return false;
		const box = element.getBoundingClientRect();
		return box.width > 0 && box.height > 0;
	};
	const short = (text: string | null | undefined) =>
		(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

	if (want.has('overflow')) {
		// Compared with the device's width, not innerWidth: a phone browser widens its layout to fit wide content.
		const screenWidth = args.width;
		const wide = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
		if (wide > screenWidth + 1) {
			// Name the widest culprit: the element sticking out furthest past the right edge.
			let worst: Element | undefined;
			let right = screenWidth;
			for (const element of document.body.querySelectorAll('*')) {
				const box = element.getBoundingClientRect();
				if (box.right > right + 1 && box.width < wide && shown(element)) {
					right = box.right;
					worst = element;
				}
			}
			findings.push({
				check: 'overflow',
				severity: 'error',
				message: `The page is ${wide - screenWidth}px wider than the screen, so it scrolls sideways.`,
				where: worst ? describe(worst) : undefined
			});
		}
	}

	if (want.has('clipped')) {
		const seen = new Set<string>();
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node && seen.size < 30; node = walker.nextNode()) {
			const text = node.textContent?.trim();
			const parent = node.parentElement;
			if (!text || !parent || !shown(parent)) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			if (!range.getClientRects().length) continue;
			const box = range.getBoundingClientRect();
			if (box.width < 2 || box.top > innerHeight || box.bottom < 0) continue;
			let cut: string | null = null;
			for (let at: Element | null = parent; at && at !== document.body; at = at.parentElement) {
				const style = getComputedStyle(at);
				// Hidden on purpose (screen-reader text) is not a defect.
				if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') break;
				if (
					style.overflowX === 'visible' &&
					style.overflowY === 'visible' &&
					style.display !== '-webkit-box'
				)
					continue;
				if (style.overflowX === 'auto' || style.overflowX === 'scroll') break;
				const edge = at.getBoundingClientRect();
				if (box.right > edge.right + 1 || box.left < edge.left - 1) {
					cut = style.textOverflow === 'ellipsis' ? 'ellipsis' : 'cut sideways';
					break;
				}
				if (
					style.overflowY !== 'auto' &&
					style.overflowY !== 'scroll' &&
					(box.bottom > edge.bottom + 2 || box.top < edge.top - 2) &&
					edge.height > 4
				) {
					cut = 'cut top/bottom';
					break;
				}
				if (
					style.webkitLineClamp &&
					style.webkitLineClamp !== 'none' &&
					at.scrollHeight > at.clientHeight + 1
				) {
					cut = 'line-clamped';
					break;
				}
			}
			if (!cut && box.right > innerWidth + 1) cut = 'off the right edge';
			if (!cut) continue;
			const key = `${cut}:${text.slice(0, 40)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			findings.push({
				check: 'clipped',
				// An ellipsis or a clamp is usually a design choice; text simply cut off is not.
				severity: cut === 'ellipsis' || cut === 'line-clamped' ? 'info' : 'warning',
				message: `Text ${cut}.`,
				where: describe(parent),
				text: short(text)
			});
		}
	}

	if (want.has('covered')) {
		let count = 0;
		for (const element of document.querySelectorAll(
			'a[href], button, input, select, textarea, [role=button], [role=link], [tabindex]:not([tabindex="-1"])'
		)) {
			if (count >= 20 || !shown(element)) continue;
			const box = element.getBoundingClientRect();
			const x = box.left + box.width / 2;
			const y = box.top + box.height / 2;
			if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
			const top = document.elementFromPoint(x, y);
			if (!top || top === element || element.contains(top) || top.contains(element)) continue;
			// Behind an open modal on purpose.
			const modal = top.closest('dialog[open], [aria-modal="true"]');
			if (modal && !modal.contains(element)) continue;
			// A label wrapping its input, or a custom control drawn over a native one, is fine.
			if (top.closest('label')?.contains(element)) continue;
			count += 1;
			findings.push({
				check: 'covered',
				severity: 'warning',
				message: `Something sits on top of this control, so a tap at its middle hits "${describe(top)}".`,
				where: describe(element),
				text: short(element.textContent || element.getAttribute('aria-label'))
			});
		}
	}

	if (want.has('images')) {
		for (const image of document.images) {
			if (image.complete && image.naturalWidth === 0 && shown(image) && image.currentSrc) {
				findings.push({
					check: 'images',
					severity: 'error',
					message: `Image failed to load: ${image.currentSrc.slice(0, 120)}`,
					where: describe(image)
				});
			}
		}
	}

	if (want.has('blank')) {
		const words = (document.body.innerText || '').trim().length;
		const media = document.querySelectorAll('img, svg, canvas, video').length;
		if (!words && !media) {
			findings.push({
				check: 'blank',
				severity: 'error',
				message: 'The page has no text and no images.'
			});
		}
	}

	if (want.has('targets') && args.touch) {
		let count = 0;
		for (const element of document.querySelectorAll(
			'a[href], button, input:not([type=hidden]), select, [role=button]'
		)) {
			if (count >= 15 || !shown(element)) continue;
			const box = element.getBoundingClientRect();
			if (box.top > innerHeight || box.bottom < 0) continue;
			// Links inside running text are exempt (WCAG 2.5.8).
			if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') continue;
			if (box.width < 24 || box.height < 24) {
				count += 1;
				findings.push({
					check: 'targets',
					severity: 'warning',
					message: `Tap target is ${Math.round(box.width)}×${Math.round(box.height)}, under 24×24.`,
					where: describe(element),
					text: short(element.textContent || element.getAttribute('aria-label'))
				});
			}
		}
	}

	return findings;
}
