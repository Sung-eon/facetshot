// Shows the view the hash names, and marks its link.
function show() {
	const view = location.hash.replace(/^#/, '') || '/';
	for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== view;
	for (const link of document.querySelectorAll('nav a')) {
		if (link.getAttribute('href') === `#${view}`) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	}
}
addEventListener('hashchange', show);
show();
