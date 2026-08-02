// The text equivalent of a chart.
//
// Every chart here renders to an <svg role="img">, which exposes one label and
// nothing else — the numbers themselves live in mouse-driven tooltips, so screen
// reader, keyboard, and touch users all lose them. Each chart pairs with a table
// built from the same arrays it just plotted, which restores the data on all three
// at once and is far cheaper than making SVG interiors focusable.
import { el } from "../dom.js";
import { escapeHtml } from "../format.js";

// Render a table into `id`.
//   caption : a sentence naming what the table holds (visible, and the table's
//             accessible name)
//   cols    : column headers, the first naming the row-header column
//   rows    : arrays of cells; cell 0 becomes a <th scope="row">
export function renderTable(id, { caption, cols, rows }) {
  const head = cols.map(c => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  const body = rows.map(r =>
    `<tr><th scope="row">${escapeHtml(String(r[0]))}</th>` +
    r.slice(1).map(c => `<td>${escapeHtml(String(c))}</td>`).join("") + "</tr>").join("");
  el(id).innerHTML = `<caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
}

// A two-dimensional grid, where the column headers are themselves data values.
export function renderGridTable(id, { caption, corner, colHeads, rowHeads, cells }) {
  const head = `<th scope="col">${escapeHtml(corner)}</th>` + colHeads.map(c => `<th scope="col">${escapeHtml(String(c))}</th>`).join("");
  const body = rowHeads.map((rh, j) =>
    `<tr><th scope="row">${escapeHtml(String(rh))}</th>` +
    cells[j].map(c => `<td>${escapeHtml(String(c))}</td>`).join("") + "</tr>").join("");
  el(id).innerHTML = `<caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
}

// Pick at most `max` evenly spaced indices from a series of length `n`, always
// keeping the last one so a table never implies the curve stops early.
export function strideIndices(n, max) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1), out = [];
  for (let k = 0; k < max; k++) out.push(Math.round(k * step));
  return Array.from(new Set(out));
}

// Set an <svg role="img"> label to something that carries the finding, not the
// chart genre — "Tornado chart" tells a listener nothing they can act on.
export function describeChart(id, text) { el(id).setAttribute("aria-label", text); }
