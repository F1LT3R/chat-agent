// theme + chat-controls state — single owner of the theme (Block A) and the
// width (Block B extends this same module). All visual differences come from
// style.css: this file only sets data-theme + color-scheme on <html>, swaps
// the hljs sheet on one <link>, sets the toggle glyph, and positions the
// floating #chat-controls pill.
const THEME_KEY = 'chat-agent:theme'
const HLJS_HREF = {
	dark: '/vendor/highlight-github-dark.css',
	light: '/vendor/highlight-github.css',
}

export function currentTheme() {
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

// Apply = data-theme + color-scheme on <html> ONLY; every visual difference
// comes from the CSS palette. The hljs sheet and the toggle glyph follow it.
export function applyTheme(t) {
	document.documentElement.dataset.theme = t
	document.documentElement.style.colorScheme = t
	const link = document.querySelector('#hljs-theme')
	if (link) link.href = HLJS_HREF[t]
	// Convention here: 🌙 while in dark mode, ☀️ while in light mode.
	const btn = document.querySelector('#theme-toggle')
	if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙'
}

export function initTheme() {
	// Default dark; never reads OS preference.
	const saved = localStorage.getItem(THEME_KEY)
	applyTheme(saved === 'light' ? 'light' : 'dark')
	const btn = document.querySelector('#theme-toggle')
	if (btn) {
		btn.addEventListener('click', () => {
			const next = currentTheme() === 'light' ? 'dark' : 'light'
			applyTheme(next)
			localStorage.setItem(THEME_KEY, next)
		})
	}
	positionControls()
}

// The composer height varies (stats line, textarea autosize, safe-area
// padding), so the pill's bottom is set in JS, not CSS.
export function positionControls() {
	const pill = document.querySelector('#chat-controls')
	const composer = document.querySelector('#composer')
	if (!pill || !composer) return
	pill.style.bottom = composer.getBoundingClientRect().height + 10 + 'px'
}

// Exactly one window-resize listener in the app: registered here, debounced
// 150 ms. Block B extends onWindowResize() to also call applyWidth(); it
// must not add a second listener.
let resizeTimer = 0
function onWindowResize() {
	positionControls()
}

export function initResizeHandler() {
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer)
		resizeTimer = setTimeout(onWindowResize, 150)
	})
}
