import { marked } from 'marked';
import DOMPurify from 'dompurify';

const DOMPURIFY_CONFIG = {
    ADD_TAGS: ['img', 'figure', 'figcaption'],
    ADD_ATTR: ['src', 'alt', 'title', 'width', 'height', 'loading']
};

export const sanitizeHtml = (html) => DOMPurify.sanitize(html, DOMPURIFY_CONFIG);

export const slugify = (text) => String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-가-힣]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

export const renderMarkdown = (content) => {
    const renderer = new marked.Renderer();
    renderer.heading = (text, level) => {
        const id = slugify(text);
        return `<h${level} id="${id}">${text}</h${level}>`;
    };
    const rawHtml = marked.parse(content || '', { renderer });
    return sanitizeHtml(rawHtml);
};

export const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildExportHtml = (markdown, meta = {}) => {
    const html = renderMarkdown(markdown);
    const { timestamp, agents, prompt } = meta;

    const metaRows = [
        `생성 시각: ${escapeHtml(timestamp || '')}`,
        `활성 에이전트: ${escapeHtml(agents || '')}`,
        prompt ? `질문: ${escapeHtml(prompt)}` : null
    ].filter(Boolean);

    return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Multi Agent Analysis</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: "Noto Sans KR", sans-serif; background: #fffdf9; color: #1a1a1a; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 36px 64px; }
      .meta { background: #f5f2ed; border: 1px solid #e6e0d8; border-radius: 24px; padding: 24px; margin-bottom: 32px; }
      .meta .brand { font-weight: 900; font-size: 12px; text-transform: uppercase; color: #8c8279; margin-bottom: 8px; }
      .meta .row { font-size: 12px; color: #8c8279; margin: 4px 0; }
      h1, h2, h3 { color: #1a1a1a; margin-top: 1.5em; }
      p { line-height: 1.8; color: #2d2a28; }
      hr { border: 0; height: 1px; background: #e6e0d8; margin: 32px 0; }
      table { width: 100%; border-collapse: collapse; margin: 18px 0; }
      th, td { border: 1px solid #e6e0d8; padding: 12px; text-align: left; }
      th { background: #f5f2ed; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <section class="meta">
        <div class="brand">SIGNAL LAB Intelligence Report</div>
        ${metaRows.map(row => `<div class="row">${row}</div>`).join('')}
      </section>
      <article>${html}</article>
    </main>
  </body>
</html>`;
};
