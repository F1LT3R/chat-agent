// theme + width state.
// All visual differences come from style.css: this file only sets
// data-theme + color-scheme on <html>, swaps the hljs sheet on one
// <link>, sets the toggle glyph, and sizes the inner #chat-col column
// (and the #composer below it) as a percentage of the full-width
// #messages scroll container.
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

// The ONLY function that sizes and positions the column. Width is a
// percentage of #messages' content width (default 100%, 20–100% clamp).
// The column + composer are centered on the SCREEN (not their parent),
// clamped so the column's left edge never crosses the menu's right edge
// (in-flow menu open) or the screen's left edge (menu hidden / mobile
// drawer), plus the messages padding. #messages stays full-width so its
// scrollbar is pinned to the right screen edge.
export function applyWidth() {
	const col = document.querySelector('#chat-col')
	if (!col) return
	const composer = document.querySelector('#composer')
	const messages = document.querySelector('#messages')

	const cs = getComputedStyle(messages)
	const padL = parseFloat(cs.paddingLeft) || 0
	const padR = parseFloat(cs.paddingRight) || 0
	// Column px width from the scroll container's content width (clientWidth
	// already excludes the scrollbar), so this matches the rendered width
	// without a reflow / scrollbar race.
	const colW = widthRatio * (messages.clientWidth - padL - padR)

	col.style.width = Math.round(widthRatio * 100) + '%'
	const vw = document.documentElement.clientWidth

	// In-flow menu right edge in viewport x. The mobile drawer overlays
	// (position: fixed) and does not bound the column, so it contributes 0.
	let menuRight = 0
	const app = document.getElementById('app')
	const panel = document.getElementById('panel')
	if (
		app && panel &&
		app.classList.contains('panel-open') &&
		getComputedStyle(panel).position === 'static'
	) {
		menuRight = panel.getBoundingClientRect().right
	}

	// #messages' content-box left in viewport x, and the clamp for the
	// column's left edge (menu edge / screen edge + padding).
	const contentLeft = menuRight + padL
	const leftView = Math.max((vw - colW) / 2, contentLeft)
	const marginLeft = Math.max(0, leftView - contentLeft)

	col.style.marginLeft = marginLeft + 'px'
	col.style.marginRight = 'auto'
	// The composer lives in #chat-inner (padL further left, no padding of
	// its own); size + offset it in px so it sits exactly under the column.
	if (composer) {
		composer.style.width = colW + 'px'
		composer.style.marginLeft = (padL + marginLeft) + 'px'
		composer.style.marginRight = 'auto'
	}
}
