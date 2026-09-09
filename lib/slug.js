/**
 * Canonical heading-slug rule (GitHub-compatible):
 * lowercase → strip every character that is not a letter, digit, space or
 * hyphen → trim → runs of spaces become a single hyphen → an empty result
 * becomes 'section'.
 *
 * NOTE: server/tools/sessions.js (agent side) duplicates this rule so the
 * model can build heading links for stored sessions it finds there. The two
 * copies MUST be kept in sync.
 */
export function slugify(text) {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ +/g, '-')
  return s || 'section'
}
