export const textColors = ['ink', 'red', 'blue', 'green', 'purple'];
export const highlightColors = ['yellow', 'mint', 'sky', 'pink'];
export const softBreak = 'soft-break';

export function hasInlineFormatting(ops) {
  return ops.some(op => Object.keys(op.attributes ?? {}).some(format => format !== softBreak));
}

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function legacyTextOps(text) {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n(?:[ \t]*\n)*/);
  const ops = [];
  for (const paragraph of paragraphs) {
    for (const [index, line] of paragraph.split('\n').entries()) {
      if (index > 0) ops.push({ insert: '\n', attributes: { [softBreak]: 'yes' } });
      if (line) ops.push({ insert: line });
    }
    ops.push({ insert: '\n' });
  }
  return ops;
}

export function plainText(ops) {
  return ops.map(op => typeof op.insert === 'string'
    ? op.insert.replaceAll('\n', op.attributes?.[softBreak] ? '\n' : '\n\n')
    : '').join('').trim();
}

function inlineHtml(text, attributes = {}) {
  let html = escapeHtml(text);
  if (attributes.bold) html = `<strong>${html}</strong>`;
  if (attributes.italic) html = `<em>${html}</em>`;
  if (attributes.underline) html = `<u>${html}</u>`;
  if (highlightColors.includes(attributes.background)) html = `<mark class="ql-bg-${attributes.background}">${html}</mark>`;
  if (textColors.includes(attributes.color)) html = `<span class="ql-color-${attributes.color}">${html}</span>`;
  return html;
}

export function textHtml(ops) {
  const paragraphs = [];
  let paragraph = '';
  for (const op of ops) {
    if (typeof op.insert !== 'string') continue;
    const lines = op.insert.split('\n');
    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        if (op.attributes?.[softBreak]) paragraph += '<br>';
        else {
          paragraphs.push(`<p>${paragraph || '<br>'}</p>`);
          paragraph = '';
        }
      }
      if (line) paragraph += inlineHtml(line, op.attributes);
    }
  }
  if (paragraph) paragraphs.push(`<p>${paragraph}</p>`);
  return paragraphs.join('\n');
}
