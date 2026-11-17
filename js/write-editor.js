import { highlightColors, legacyTextOps, softBreak, textColors } from './article-text.js?v=1';

const Quill = window.Quill;
const Delta = Quill.import('delta');
const { ClassAttributor, Scope } = Quill.import('parchment');
const inlineFormats = ['bold', 'italic', 'underline', 'color', 'background'];
Quill.register(`formats/${softBreak}`, new ClassAttributor(softBreak, 'write-soft-break', {
  scope: Scope.BLOCK, whitelist: ['yes'],
}));
for (const [name, values] of [['color', textColors], ['background', highlightColors]]) {
  const attribute = Quill.import(`attributors/class/${name}`);
  attribute.whitelist = values;
  Quill.register(`formats/${name}`, attribute, true);
}

function insertBreak(editor, range, attributes) {
  const inline = editor.getFormat(range.index, 0);
  const change = new Delta().retain(range.index).delete(range.length).insert('\n', attributes);
  editor.updateContents(change, 'user');
  editor.setSelection(range.index + 1, 0, 'silent');
  for (const format of inlineFormats) {
    if (inline[format]) editor.format(format, inline[format], 'silent');
  }
}

export function createEditor(block, { note, draft, onChange }) {
  const toolbar = block.querySelector('.write-format');
  const editor = new Quill(block.querySelector('.write-editor'), {
    formats: [...inlineFormats, softBreak],
    placeholder: note ? '想记下什么？' : '在这里写正文。',
    modules: {
      toolbar: { container: toolbar, handlers: {
        color(value) { this.quill.format('color', value === 'default' ? false : value, 'user'); },
        background(value) { this.quill.format('background', value === 'default' ? false : value, 'user'); },
        clean() {
          const range = this.quill.getSelection();
          if (!range) return;
          if (range.length) {
            const cleared = Object.fromEntries(inlineFormats.map(format => [format, false]));
            this.quill.formatText(range.index, range.length, cleared, 'user');
          } else {
            for (const format of inlineFormats) this.quill.format(format, false, 'user');
          }
        },
      } },
      history: { userOnly: true },
      keyboard: { bindings: {
        paragraph: {
          key: 'Enter', shiftKey: false,
          handler(range) { insertBreak(this.quill, range); },
        },
        softBreak: {
          key: 'Enter', shiftKey: true,
          handler(range) { insertBreak(this.quill, range, { [softBreak]: 'yes' }); },
        },
      } },
    },
  });
  editor.root.classList.add('article-text');
  editor.root.setAttribute('role', 'textbox');
  editor.root.setAttribute('aria-label', '正文文字');
  editor.root.setAttribute('aria-multiline', 'true');
  editor.setContents(draft?.ops ?? legacyTextOps(draft?.text ?? ''), 'silent');
  const selectors = toolbar.querySelectorAll('select');
  const showSelectLabels = () => {
    for (const select of selectors) if (select.selectedIndex < 0) select.selectedIndex = 0;
  };
  editor.on('editor-change', showSelectLabels);
  showSelectLabels();
  editor.on('text-change', onChange);
  return editor;
}
