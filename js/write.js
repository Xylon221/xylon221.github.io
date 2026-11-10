import { articleBody, publishArticle } from './write-publish.js?v=1';

const form = document.getElementById('write-form');
const fields = document.getElementById('write-fields');
const blocks = document.getElementById('content-blocks');
const title = document.getElementById('post-title');
const category = document.getElementById('post-category');
const date = document.getElementById('post-date');
const tags = document.getElementById('post-tags');
const files = document.getElementById('image-files');
const tokenInput = document.getElementById('github-token');
const status = document.getElementById('write-status');
const preview = document.getElementById('write-preview');
const imageError = document.getElementById('image-error');
const images = new Map();
const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const categories = { technical: '技术笔记', privacy: '技术笔记 / 隐私计算', life: '生活随笔' };
let draftId = crypto.randomUUID().slice(0, 12);
let busy = false;

function today() {
  const now = new Date();
  const part = number => String(number).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
}

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('write-error', error);
}

function addBlock(kind) {
  const block = document.getElementById(`${kind}-block`).content.firstElementChild.cloneNode(true);
  block.querySelector('.remove-block').addEventListener('click', () => {
    const image = images.get(block);
    if (image) URL.revokeObjectURL(image.preview);
    images.delete(block);
    block.remove();
    preview.hidden = true;
    imageError.textContent = '';
  });
  blocks.append(block);
  return block;
}

function addText(focus = false) {
  const input = addBlock('text').querySelector('textarea');
  if (focus) input.focus();
}

document.getElementById('add-text').addEventListener('click', () => addText(true));
document.getElementById('add-image').addEventListener('click', () => files.click());
files.addEventListener('change', () => {
  imageError.textContent = '';
  for (const file of files.files) {
    if (images.size >= 12) {
      imageError.textContent = '每篇最多添加 12 张图片。';
      break;
    }
    if (!formats[file.type] || file.size === 0 || file.size > 8 * 1024 * 1024) {
      imageError.textContent = '请选用不超过 8 MB 的 JPG、PNG、WebP、GIF 或 AVIF 图片。';
      continue;
    }
    const block = addBlock('image');
    const previewUrl = URL.createObjectURL(file);
    images.set(block, { file, preview: previewUrl });
    block.querySelector('img').src = previewUrl;
    block.querySelector('.image-name').textContent = file.name;
  }
  preview.hidden = true;
  files.value = '';
});

function readDraft() {
  const heading = title.value.trim();
  if (!heading) throw new Error('请填写文章标题。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) throw new Error('请选择有效的发布日期。');
  const labels = [...new Map(tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()];
  if (labels.length > 10 || labels.some(tag => !/^[\p{L}\p{N}_+-]+(?: [\p{L}\p{N}_+-]+)*$/u.test(tag)
      || tag.length > 36 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(tag))) {
    throw new Error('最多填 10 个标签，用逗号隔开。每个标签可使用文字、数字、空格、短横线、下划线和加号。');
  }
  const content = [];
  let number = 0;
  for (const block of blocks.children) {
    if (block.dataset.kind === 'text') {
      const text = block.querySelector('textarea').value.trim();
      if (text) content.push({ kind: 'text', text });
    } else {
      const image = images.get(block);
      const caption = block.querySelector('input').value.trim();
      content.push({ kind: 'image', ...image, caption, path: `assets/image-${++number}.${formats[image.file.type]}` });
    }
  }
  if (!content.length) throw new Error('请写一段文字或添加一张图片。');
  return { id: draftId, title: heading, date: date.value, category: category.value, tags: labels, blocks: content };
}

document.getElementById('show-preview').addEventListener('click', () => {
  try {
    const draft = readDraft();
    preview.querySelector('h2').textContent = draft.title;
    preview.querySelector('.preview-meta').textContent = [draft.date, categories[draft.category], ...draft.tags.map(tag => `#${tag}`)].join(' · ');
    preview.querySelector('.write-prose').innerHTML = articleBody(draft.blocks, image => image.preview);
    preview.hidden = false;
    message('');
    preview.scrollIntoView({ block: 'start' });
  } catch (error) {
    message(error.message, true);
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let draft;
  try { draft = readDraft(); } catch (error) { message(error.message, true); return; }
  const token = tokenInput.value.trim();
  if (!token.startsWith('github_pat_')) {
    message('请先填写 GitHub 细粒度发布令牌。', true);
    tokenInput.focus();
    return;
  }
  tokenInput.value = '';
  busy = true;
  fields.disabled = true;
  try {
    const url = await publishArticle(draft, token, message);
    message('已提交到 GitHub。等 Pages 部署完成即可打开文章。 ');
    const link = document.createElement('a');
    link.href = url;
    link.textContent = '打开文章 ↗';
    status.append(link);
    for (const image of images.values()) URL.revokeObjectURL(image.preview);
    images.clear();
    blocks.replaceChildren();
    form.reset();
    date.value = today();
    preview.hidden = true;
    draftId = crypto.randomUUID().slice(0, 12);
    addText();
  } catch (error) {
    message(error instanceof TypeError ? '无法连接 GitHub。正文和图片还在当前页，可以稍后重新发布。' : error.message, true);
  } finally {
    fields.disabled = false;
    busy = false;
  }
});

date.value = today();
addText();
