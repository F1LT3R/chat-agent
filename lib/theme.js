// theme + width state.
// All visual differences come from style.css: this file only sets
// data-theme + color-scheme on <html>, swaps the hljs sheet on one
// <link>, sets the toggle glyph, and sizes #chat-inner as a percentage
// of its container.
const THEME_KEY = 'chat-agent:theme'
const WIDTH_KEY = 'chat-agent:chatWidthRatio'
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
	// aria-pressed mirrors the state for assistive tech (label: "Dark mode").
	const btn = document.querySelector('#theme-toggle')
	if (btn) {
		btn.textContent = t === 'light' ? '☀️' : '🌙'
		btn.setAttribute('aria-pressed', String(t === 'dark'))
	}
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
}

// Exactly one window-resize listener in the app: registered here,
// debounced 150 ms. Re-runs the column width re-apply — nothing else may
// add a second listener.
let resizeTimer = 0
function onWindowResize() {
	applyWidth()
}

export function initResizeHandler() {
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer)
		resizeTimer = setTimeout(onWindowResize, 150)
	})
}

/* ---------------- width slider ---------------- */

let widthRatio = 1.0 // 0.20 (far left) .. 1.0 (far right)

export function initWidth() {
	const raw = parseFloat(localStorage.getItem(WIDTH_KEY))
	widthRatio = Number.isFinite(raw) ? Math.min(1.0, Math.max(0.2, raw)) : 1.0
	const slider = document.querySelector('#width-slider')
	if (slider) {
		slider.value = Math.round(widthRatio * 100)
		slider.addEventListener('input', () => {
			widthRatio = Number(slider.value) / 100
			applyWidth() // live while dragging; not persisted yet
		})
		slider.addEventListener('change', () => {
			localStorage.setItem(WIDTH_KEY, String(widthRatio))
		})
	}
	applyWidth()
}

// The ONLY function that sets the column width: a percentage of #chat's
// content width (default 100%). No min/max beyond the 20–100% clamp.
export function applyWidth() {
	const inner = document.querySelector('#chat-inner')
	if (!inner) return
	inner.style.width = Math.round(widthRatio * 100) + '%'
}
