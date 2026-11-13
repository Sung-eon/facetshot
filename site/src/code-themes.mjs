// Code colours from the site's own palette: ink (or the mat's light text) for code, violet for the names of
// commands, functions and keywords, and the muted label grey for comments. No colour outside the palette.
const theme = (type, { ink, soft, muted, accent, accentHigh, background }) => ({
	name: `facetshot-${type}`,
	type,
	colors: { 'editor.background': background, 'editor.foreground': ink },
	tokenColors: [
		{ settings: { foreground: ink } },
		{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: muted } },
		{
			scope: ['entity.name', 'support.function', 'meta.function-call', 'keyword', 'storage'],
			settings: { foreground: accent }
		},
		{
			scope: ['string', 'constant.other.option', 'constant.language'],
			settings: { foreground: soft }
		},
		{
			scope: ['constant.numeric', 'variable.other.normal', 'variable.parameter'],
			settings: { foreground: accentHigh }
		},
		{ scope: ['punctuation', 'keyword.operator'], settings: { foreground: soft } }
	]
});

export const codeThemes = [
	theme('dark', {
		ink: '#e9e5dc',
		soft: '#d2cdc2',
		muted: '#aba598',
		accent: '#b6abf0',
		accentHigh: '#c9c0f2',
		background: '#262523'
	}),
	theme('light', {
		ink: '#1e1d1b',
		soft: '#4a4741',
		muted: '#67635b',
		accent: '#5b2fd6',
		accentHigh: '#3d1d9e',
		background: '#f1efea'
	})
];
