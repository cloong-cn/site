// Code blocks, coloured at build time like Xcode's default theme (the colours themselves are in blog.css).
// highlight.js finds keywords, strings, comments and so on; a second pass below adds what Xcode shows on top:
// type names (String, List), method calls, properties, constants, annotations with coloured arguments.
//
// In Markdown, after the three backticks:
//   ```java                                  the language
//   ```java title="UserController.java"      a file name in the block's header
//   ```java {3,7-9}                           lines to highlight
import hljs from 'highlight.js';

/* how a language is named in the block's header */
const NAMES = {
  java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin', groovy: 'Groovy', gradle: 'Gradle', scala: 'Scala',
  js: 'JavaScript', javascript: 'JavaScript', mjs: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  vue: 'Vue', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', less: 'Less', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  toml: 'TOML', ini: 'INI', properties: 'Properties', sql: 'SQL', bash: 'Shell', sh: 'Shell', shell: 'Shell', zsh: 'Shell',
  console: '终端', powershell: 'PowerShell', ps1: 'PowerShell', python: 'Python', py: 'Python', go: 'Go', rust: 'Rust', rs: 'Rust',
  c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', php: 'PHP', ruby: 'Ruby', swift: 'Swift', dart: 'Dart',
  dockerfile: 'Dockerfile', docker: 'Dockerfile', nginx: 'Nginx', makefile: 'Makefile', md: 'Markdown', markdown: 'Markdown',
  diff: 'Diff', http: 'HTTP', graphql: 'GraphQL', lua: 'Lua', glsl: 'GLSL', text: '纯文本', txt: '纯文本', plaintext: '纯文本',
};
/* names people write that mean a different highlight.js language */
const ALIAS = { shell: 'bash', sh: 'bash', zsh: 'bash', console: 'shell', vue: 'xml', html: 'xml', toml: 'ini' };
const PLAIN = new Set(['', 'text', 'txt', 'plaintext', 'plain']);
/* languages where Xcode-style type names, calls and properties are added */
const SEMANTIC = new Set(['java', 'kotlin', 'scala', 'groovy', 'gradle', 'csharp', 'swift', 'dart', 'typescript', 'javascript', 'go', 'rust', 'c', 'cpp', 'objectivec', 'php']);
const ANNOTATED = new Set(['java', 'kotlin', 'scala', 'groovy']);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

const canonical = new Map();
function languageOf(lang) {
  const want = ALIAS[lang] || lang;
  if (!canonical.has(want)) {
    const def = hljs.getLanguage(want);
    canonical.set(want, def ? hljs.listLanguages().find((n) => hljs.getLanguage(n) === def) : null);
  }
  return canonical.get(want);
}

/* identifiers in plain code text: Type, CONSTANT, call(, .property */
function semantic(text) {
  let out = '';
  const re = /(&[a-z#0-9]+;)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) { out += m[0]; continue; }
    const id = m[2];
    const before = text.slice(0, m.index).replace(/\s+$/, '');
    const after = text.slice(re.lastIndex).replace(/^\s+/, '');
    let cls = '';
    if (after.startsWith('(') || before.endsWith('::')) cls = 'x-f'; /* a call, or a method reference (User::getName) */
    else if (/^[A-Z][A-Z0-9_]+$/.test(id)) cls = 'x-c';
    else if (/^[A-Z]/.test(id)) cls = 'x-t';
    else if (before.endsWith('.') && !before.endsWith('..')) cls = 'x-p';
    out += cls ? `<span class="${cls}">${id}</span>` : id;
  }
  return out;
}
/* run fn over the text that sits outside strings, comments and the like */
function plainText(html, fn) {
  const OPEN = new Set(['hljs-params', 'hljs-subst', 'hljs-function']);
  const stack = [];
  return html.replace(/<span class="([^"]*)">|<\/span>|[^<]+/g, (tok, cls) => {
    if (cls !== undefined) { stack.push(cls); return tok; }
    if (tok === '</span>') { stack.pop(); return tok; }
    const top = stack[stack.length - 1];
    return top === undefined || OPEN.has(top) ? fn(tok) : tok;
  });
}

/* split highlighted HTML into lines, closing and reopening spans that run across a line break */
function lines(html) {
  const out = [];
  const stack = [];
  let cur = '';
  for (const tok of html.match(/<span class="[^"]*">|<\/span>|\n|[^<\n]+/g) || []) {
    if (tok === '\n') {
      out.push(cur + '</span>'.repeat(stack.length));
      cur = stack.join('');
    } else {
      if (tok.startsWith('<span')) stack.push(tok);
      else if (tok === '</span>') stack.pop();
      cur += tok;
    }
  }
  out.push(cur);
  return out;
}

function colour(code, lang) {
  let html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  /* lower-case "types" are built-in ones (int, void, long): Xcode shows those as keywords */
  html = html.replace(/<span class="hljs-type">([a-z][a-z0-9_]*)<\/span>/g, '<span class="hljs-keyword">$1</span>');
  /* a class being declared, as opposed to one being used */
  html = html.replace(/(<span class="hljs-keyword">(?:class|interface|enum|record|struct|object|trait|protocol|extension|@interface)<\/span>\s+)<span class="hljs-title class_">/g, '$1<span class="hljs-title class_ decl__">');
  /* obj.method: a call, not a declaration */
  html = html.replace(/\.<span class="hljs-title function_">/g, '.<span class="hljs-title function_ invoke__">');
  /* in JavaScript a plain name( is a call too, unless it follows the word function */
  if (lang === 'javascript' || lang === 'typescript') {
    html = html.replace(/(?<!<span class="hljs-keyword">function<\/span>\s{0,3}(?:\*\s{0,3})?)<span class="hljs-title function_">/g, '<span class="hljs-title function_ invoke__">');
  }
  if (ANNOTATED.has(lang)) {
    /* @GetMapping("/{id}"): the name in the annotation colour, its arguments highlighted as code */
    html = html.replace(/<span class="hljs-meta">(@[\w.$]+)(\([^<]*?\))<\/span>/g, (m, name, args) => `<span class="hljs-meta">${name}</span>${colour(unesc(args), lang)}`);
    /* package paths after import / package stay plain */
    html = html.replace(/(<span class="hljs-keyword">(?:import|package)<\/span>(?:\s*<span class="hljs-keyword">static<\/span>)?)([^\n<]*)/g, '$1<span class="x-path">$2</span>');
  }
  if (SEMANTIC.has(lang)) html = plainText(html, semantic);
  return html;
}

function parseInfo(raw) {
  const s = String(raw || '').trim();
  const lang = (s.match(/^[^\s{]+/) || [''])[0].toLowerCase();
  const t = s.match(/title=(?:"([^"]*)"|'([^']*)'|(\S+))/);
  const marks = new Set();
  const r = s.match(/\{([\d,\s-]+)\}/);
  if (r) {
    for (const part of r[1].split(',')) {
      const [a, b] = part.trim().split('-').map(Number);
      if (a) for (let i = a; i <= (b || a) && i < a + 500; i++) marks.add(i);
    }
  }
  /* flags: nolines (no line numbers), nofold (never fold) */
  const flags = new Set((s.replace(/title=(?:"[^"]*"|'[^']*'|\S+)/, '').match(/\b(nolines|nofold)\b/g) || []));
  return { lang, title: t ? t[1] || t[2] || t[3] : '', marks, flags };
}

/* long blocks fold: more than FOLD_OVER lines show only the first FOLD_TO until expanded */
export const FOLD_OVER = 30;
export const FOLD_TO = 18;

/* a whole code block: header (file name or language, copy button), the numbered lines, and a fold for long ones */
export function codeBlock(text, info) {
  const { lang, title, marks, flags } = parseInfo(info);
  const id = PLAIN.has(lang) ? null : languageOf(lang);
  const html = id ? colour(text, id) : esc(text);
  let rows = lines(html);
  if (id === 'bash') {
    /* the command at the start of a line (npm, rsync, docker …), unless the line continues the one before */
    rows = rows.map((l, i) => (i && /\\$/.test(rows[i - 1]) ? l : l.replace(/^(\s*)([A-Za-z_][\w.+-]*)(?=\s|$)/, '$1<span class="x-cmd">$2</span>')));
  }
  const n = rows.length;
  const numbered = n > 1 && !flags.has('nolines');
  /* fold long blocks, unless a highlighted line would end up hidden */
  const folds = n > FOLD_OVER && !flags.has('nofold') && ![...marks].some((m) => m > FOLD_TO);
  const body = rows.map((l, i) => {
    const cls = ['line'];
    if (marks.has(i + 1)) cls.push('is-hl');
    if (id === 'diff' && l.startsWith('<span class="hljs-addition">')) cls.push('is-add');
    if (id === 'diff' && l.startsWith('<span class="hljs-deletion">')) cls.push('is-del');
    return `<span class="${cls.join(' ')}">${l}</span>`;
  }).join('\n');
  const name = lang ? NAMES[lang] || lang : '';
  /* how wide the longest line is, in columns (Chinese characters take two): media.js offers the wrap button only
     when that does not fit the column */
  const cols = Math.max(...text.split('\n').map((l) => [...l].reduce((w, c) => w + (c.codePointAt(0) > 0x2e7f ? 2 : c === '\t' ? 4 : 1), 0)));
  const tools = '<button class="code-wrap" type="button" aria-pressed="false" hidden>换行</button><button class="code-copy" type="button" hidden>复制</button>';
  const head = title
    ? `<span class="code-title">${esc(title)}</span><span class="code-side"><span class="code-lang">${esc(name)}</span>${tools}</span>`
    : `<span class="code-lang">${esc(name)}</span><span class="code-side">${tools}</span>`;
  const cls = ['codeblock'];
  if (numbered) cls.push('has-lines');
  if (folds) cls.push('is-long');
  /* --rows: the block's exact height is known without laying it out, so off-screen blocks can wait (blog.css) */
  const style = `--ln:${String(n).length};--rows:${n};--cols:${cols}${folds ? `;--fold:${FOLD_TO}` : ''}`;
  /* the fold button only appears with JavaScript; without it the whole block simply shows */
  const fold = folds
    ? `<button class="code-fold" type="button" aria-expanded="false" hidden><span class="code-fold-label">展开全部代码</span><span class="code-fold-n">共 ${n} 行</span><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    : '';
  return `<div class="${cls.join(' ')}" style="${style}"${folds ? ` data-lines="${n}"` : ''}><div class="code-head">${head}</div><pre><code class="hljs${id ? ` language-${id}` : ''}">${body}</code></pre>${fold}</div>\n`;
}
