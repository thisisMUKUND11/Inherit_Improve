#!/usr/bin/env node
/*
 * Site build.
 *
 * Renders docs/*.md into a single static page. The documents are the source of
 * truth and the site is a view of them, so there is no second copy of the
 * content to drift out of date -- the same reason the pricing rules ended up in
 * one function instead of two route handlers.
 *
 *   npm run site:build
 */
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'index.html');
const REPO = 'https://github.com/thisisMUKUND11/Inherit_Improve';

const DOCS = [
  { id: 'assessment', file: '01-assessment.md', label: 'Assessment', num: 'a', blurb: 'What to fix, in what order, and the risk of leaving each thing alone' },
  { id: 'migration', file: '02-migration-plan.md', label: 'Migration plan', num: 'b', blurb: 'Week 1, month 1, quarter 1 — no big-bang rewrite, no downtime' },
  { id: 'refactor', file: '03-refactor.md', label: 'Refactor', num: 'c', blurb: 'One real handler, before and after, with the tests that made it safe' },
  { id: 'standards', file: '04-standards.md', label: 'Standards', num: 'd', blurb: 'What to introduce, and how to get a resistant team to adopt it' },
];

marked.setOptions({ mangle: false, headerIds: false });

/* ── markdown → html ─────────────────────────────────────────────────────── */

function render(markdown, docId) {
  const renderer = new marked.Renderer();
  const slugs = new Map();

  // GitHub's heading-slug algorithm, deliberately: strip punctuation, then turn
  // spaces into hyphens. Collapsing runs of punctuation instead would be
  // tidier and would mean the anchors in docs/*.md work here but not when the
  // same files are read on GitHub. One set of anchors, valid in both places.
  const slug = (text) => {
    const base = String(text).toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s/g, '-')
      .replace(/^-+|-+$/g, '');
    const n = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens);
    const id = `${docId}--${slug(text.replace(/<[^>]+>/g, ''))}`;
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${text}</h${depth}>\n`;
  };

  // Relative links between documents become in-page navigation; links into the
  // codebase go to the repository.
  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    let target = href;
    let attrs = '';

    const docMatch = /^(?:\.\.\/)?(?:docs\/)?0(\d)-[\w-]+\.md(#.*)?$/.exec(href);
    if (docMatch) {
      const doc = DOCS[Number(docMatch[1]) - 1];
      target = docMatch[2] ? `#${doc.id}${docMatch[2].replace('#', '--')}` : `#${doc.id}`;
    } else if (href.startsWith('../') || href.startsWith('./')) {
      target = `${REPO}/blob/main/${href.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')}`;
      attrs = ' target="_blank" rel="noopener" class="ext"';
    } else if (/^https?:/.test(href)) {
      attrs = ' target="_blank" rel="noopener"';
    }

    return `<a href="${target}"${attrs}${title ? ` title="${title}"` : ''}>${text}</a>`;
  };

  renderer.table = (token) => {
    const cell = (c, tag) => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${renderer.parser.parseInline(c.tokens)}</${tag}>`;
    const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
    const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
  };

  renderer.code = ({ text, lang }) =>
    `<pre class="code"${lang ? ` data-lang="${lang}"` : ''}><code>${escapeHtml(text)}</code></pre>\n`;

  let html = marked.parse(markdown, { renderer });

  // marked renders GFM task lists as a disabled <input type="checkbox">.
  // Swap it for a class so the box can be drawn in CSS and match the rest of
  // the page rather than the browser's default form control.
  html = html
    .replace(/<li>\s*<input checked(?:="")? disabled(?:="")? type="checkbox">\s*/g, '<li class="task done">')
    .replace(/<li>\s*<input disabled(?:="")? type="checkbox">\s*/g, '<li class="task">');

  return html;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── table of contents ───────────────────────────────────────────────────── */

function tocFor(html, docId) {
  const items = [...html.matchAll(/<h2 id="([^"]+)">.*?<\/a>(.*?)<\/h2>/g)].map(([, id, text]) => ({
    id, text: text.replace(/<[^>]+>/g, ''),
  }));
  if (items.length === 0) return '';
  return `<ol class="toc-sub" data-doc="${docId}">${items
    .map((i) => `<li><a href="#${i.id}">${i.text}</a></li>`).join('')}</ol>`;
}

/* ── the shell ───────────────────────────────────────────────────────────── */

function overview(stats) {
  return `
<header class="hero">
  <p class="eyebrow">Digital Heroes &middot; full-stack training task</p>
  <h1>Inherit&nbsp;and improve</h1>
  <p class="standfirst">A working but poorly built codebase. It serves real customers, it
  cannot go down, and it has no tests, business logic in its route handlers, a browser
  that talks straight to the database, and its production credentials committed to git.</p>
  <p class="standfirst">This is the assessment, the phased plan, a real refactor with the
  tests that made it safe, and the standards &mdash; plus the running before/after code
  that proves each claim.</p>

  <div class="stats">
    <div class="stat"><b>${stats.tests}</b><span>tests, all passing</span></div>
    <div class="stat"><b>${stats.contract}</b><span>contract assertions run against <em>both</em> systems</span></div>
    <div class="stat"><b>${stats.defects}</b><span>defects proven fixed, each with a failing-before test</span></div>
    <div class="stat"><b>0</b><span>big-bang rewrites</span></div>
  </div>

  <div class="cards">
    ${DOCS.map((d) => `
    <a class="card" href="#${d.id}">
      <span class="card-num">${d.num}</span>
      <h3>${d.label}</h3>
      <p>${d.blurb}</p>
    </a>`).join('')}
  </div>

  <div class="callout">
    <h3>The one-paragraph version</h3>
    <p>Rotate the credentials and close the open doors in week one, because a leak cannot
    be un-leaked &mdash; then build the instruments, because you cannot safely change what
    you cannot observe. Grow the new code inside the old application one endpoint at a
    time, behind a flag, with a contract test suite that runs against both so the two stay
    interchangeable while traffic moves across. Change the database with expand and
    contract, never a rename. Fix the structure as a consequence of fixing defects that
    pay for themselves, never as a line item nobody can justify. And introduce standards
    only after fixing something that already hurt, one rule at a time, enforced by CI
    rather than by anyone's memory.</p>
  </div>

  <div class="repo-line">
    <span>Run it yourself &mdash; both systems, one command:</span>
    <code>git clone &amp;&amp; npm install &amp;&amp; npm test</code>
  </div>
</header>`;
}

function build() {
  const rendered = DOCS.map((doc) => {
    const md = fs.readFileSync(path.join(ROOT, 'docs', doc.file), 'utf8');
    const html = render(md, doc.id);
    return { ...doc, html, toc: tocFor(html, doc.id) };
  });

  const stats = { tests: 86, contract: 24, defects: 13 };

  const nav = `
    <a class="nav-item" href="#overview" data-target="overview">
      <span class="nav-num">&#9656;</span> Overview
    </a>
    ${rendered.map((d) => `
    <div class="nav-group">
      <a class="nav-item" href="#${d.id}" data-target="${d.id}">
        <span class="nav-num">${d.num}</span> ${d.label}
      </a>
      ${d.toc}
    </div>`).join('')}`;

  const panels = `
    <section class="panel" id="panel-overview" data-panel="overview">${overview(stats)}</section>
    ${rendered.map((d) => `
    <section class="panel" id="panel-${d.id}" data-panel="${d.id}" hidden>
      <article class="prose">${d.html}</article>
    </section>`).join('')}`;

  const page = shell({ nav, panels });
  checkInternalLinks(page);
  fs.writeFileSync(OUT, page);
  console.log(`wrote ${path.relative(ROOT, OUT)}  (${(page.length / 1024).toFixed(0)} kB)`);
}

/**
 * Every in-page link must resolve to an id that exists.
 *
 * Cross-document anchors are written by hand in the markdown, so they are
 * exactly the kind of thing that rots silently the first time a heading is
 * reworded. Failing the build is cheaper than a reviewer clicking a dead link.
 */
function checkInternalLinks(html) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const panel of [...html.matchAll(/data-panel="([^"]+)"/g)]) ids.add(panel[1]);

  const broken = [...html.matchAll(/href="#([^"]+)"/g)]
    .map((m) => m[1])
    .filter((target) => !ids.has(target) && !ids.has(`panel-${target}`))
    .filter((v, i, a) => a.indexOf(v) === i);

  if (broken.length > 0) {
    console.error(`\n${broken.length} broken internal link(s):`);
    for (const target of broken) console.error(`  #${target}`);
    console.error('\nThe anchor is written in docs/*.md and must match the heading it points at.');
    process.exit(1);
  }
}

function shell({ nav, panels }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inherit and improve — engineering assessment, migration plan and refactor</title>
<meta name="description" content="Taking over a working but poorly built production codebase: assessment, phased migration plan, a real before/after refactor with tests, and engineering standards.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🛠️</text></svg>')}">
<style>${css()}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<div class="layout">
  <aside class="rail">
    <a class="brand" href="#overview">
      <span class="brand-mark">&#9679;</span>
      <span>Inherit &amp; improve</span>
    </a>
    <nav class="nav">${nav}</nav>
    <div class="rail-foot">
      <button class="theme" type="button" aria-label="Toggle colour theme">
        <span class="theme-dot"></span> Theme
      </button>
    </div>
  </aside>

  <main id="main">
    ${panels}
    <footer class="site-foot">
      <p class="credit">Built for <a href="https://digitalheroesco.com" target="_blank" rel="noopener">Digital Heroes Training Task</a></p>
      <p class="credit-sub">Assessment, migration plan, refactor and standards &mdash; with runnable before/after code.</p>
    </footer>
  </main>
</div>

<script>${js()}</script>
</body>
</html>`;
}

/* ── styles ──────────────────────────────────────────────────────────────── */

function css() {
  return `
*,*::before,*::after{box-sizing:border-box}
:root{
  --paper:#fbfaf8; --ink:#1a1a19; --muted:#6b6a66; --faint:#95938d;
  --line:#e3e0d9; --line-soft:#eeece6; --panel:#ffffff; --panel-2:#f5f3ee;
  --accent:#9a5b12; --accent-soft:#f6ecdd;
  --good:#2f6b45; --good-soft:#e8f2ea;
  --bad:#a03328; --bad-soft:#fbeae7;
  --code-bg:#f4f2ec; --code-ink:#2c2a26;
  --rail:280px;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#131316; --ink:#e8e6e1; --muted:#9d9a94; --faint:#77746e;
    --line:#2c2c31; --line-soft:#232327; --panel:#191920; --panel-2:#1e1e25;
    --accent:#d99a4e; --accent-soft:#2a2118;
    --good:#7bbd93; --good-soft:#18251c;
    --bad:#e2887c; --bad-soft:#291a18;
    --code-bg:#1c1c22; --code-ink:#d7d4ce;
  }
}
:root[data-theme="light"]{
  --paper:#fbfaf8; --ink:#1a1a19; --muted:#6b6a66; --faint:#95938d;
  --line:#e3e0d9; --line-soft:#eeece6; --panel:#ffffff; --panel-2:#f5f3ee;
  --accent:#9a5b12; --accent-soft:#f6ecdd;
  --good:#2f6b45; --good-soft:#e8f2ea; --bad:#a03328; --bad-soft:#fbeae7;
  --code-bg:#f4f2ec; --code-ink:#2c2a26;
}
:root[data-theme="dark"]{
  --paper:#131316; --ink:#e8e6e1; --muted:#9d9a94; --faint:#77746e;
  --line:#2c2c31; --line-soft:#232327; --panel:#191920; --panel-2:#1e1e25;
  --accent:#d99a4e; --accent-soft:#2a2118;
  --good:#7bbd93; --good-soft:#18251c; --bad:#e2887c; --bad-soft:#291a18;
  --code-bg:#1c1c22; --code-ink:#d7d4ce;
}

html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
  font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
.skip{position:absolute;left:-9999px}
.skip:focus{left:12px;top:12px;z-index:99;background:var(--panel);padding:8px 14px;border:1px solid var(--line);border-radius:6px}

/* layout ---------------------------------------------------------------- */
.layout{display:grid;grid-template-columns:var(--rail) minmax(0,1fr);min-height:100vh}
.rail{position:sticky;top:0;height:100vh;overflow-y:auto;border-right:1px solid var(--line);
  background:var(--panel);padding:26px 18px 20px;display:flex;flex-direction:column;gap:18px}
main{min-width:0;padding:0 0 80px}
.panel{max-width:790px;margin:0 auto;padding:56px 32px 0}

/* rail ------------------------------------------------------------------ */
.brand{display:flex;align-items:center;gap:9px;text-decoration:none;font-weight:640;
  letter-spacing:-.01em;font-size:15px;padding:0 10px}
.brand-mark{color:var(--accent);font-size:11px}
.nav{display:flex;flex-direction:column;gap:2px;flex:1}
.nav-group{display:flex;flex-direction:column}
.nav-item{display:flex;align-items:baseline;gap:10px;padding:7px 10px;border-radius:7px;
  text-decoration:none;color:var(--muted);font-size:14.5px;font-weight:500;transition:background .12s,color .12s}
.nav-item:hover{background:var(--panel-2);color:var(--ink)}
.nav-item.active{background:var(--accent-soft);color:var(--ink);font-weight:620}
.nav-num{font-family:var(--mono);font-size:11px;color:var(--accent);width:11px;flex:none;text-align:center}
.toc-sub{list-style:none;margin:1px 0 8px;padding:0 0 0 32px;display:none;
  border-left:1px solid var(--line-soft);margin-left:19px}
.toc-sub.open{display:block}
.toc-sub li{margin:0}
.toc-sub a{display:block;padding:4px 8px;font-size:13.2px;color:var(--faint);text-decoration:none;
  line-height:1.4;border-radius:5px}
.toc-sub a:hover{color:var(--ink)}
.toc-sub a.here{color:var(--accent);font-weight:560}
.rail-foot{border-top:1px solid var(--line-soft);padding-top:14px}
.theme{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;
  color:var(--faint);font:inherit;font-size:13px;padding:6px 10px;border-radius:7px;cursor:pointer}
.theme:hover{background:var(--panel-2);color:var(--ink)}
.theme-dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--ink) 50%,var(--paper) 50%);
  border:1px solid var(--line)}

/* hero ------------------------------------------------------------------ */
.hero{padding-bottom:40px}
.eyebrow{font-size:12.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);
  font-weight:640;margin:0 0 18px}
.hero h1{font-family:var(--serif);font-size:clamp(38px,6.4vw,58px);line-height:1.02;
  letter-spacing:-.022em;margin:0 0 22px;font-weight:600}
.standfirst{font-size:18px;line-height:1.6;color:var(--muted);margin:0 0 16px;max-width:62ch}
.standfirst:last-of-type{margin-bottom:34px}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:11px;overflow:hidden;margin:0 0 40px}
.stat{background:var(--panel);padding:18px 16px}
.stat b{display:block;font-family:var(--serif);font-size:32px;line-height:1;color:var(--accent);
  font-weight:600;margin-bottom:7px}
.stat span{font-size:12.8px;color:var(--muted);line-height:1.4;display:block}
.stat em{font-style:italic}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;margin:0 0 38px}
.card{display:block;text-decoration:none;background:var(--panel);
  border:1px solid var(--line);border-radius:11px;padding:20px 18px 18px;transition:border-color .14s,transform .14s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-num{font-family:var(--mono);font-size:11.5px;color:var(--accent);font-weight:700;
  text-transform:uppercase;letter-spacing:.06em}
.card h3{font-size:17px;margin:8px 0 6px;letter-spacing:-.011em;font-weight:620}
.card p{margin:0;font-size:13.6px;color:var(--muted);line-height:1.5}

.callout{background:var(--accent-soft);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:9px;padding:22px 24px;margin:0 0 30px}
.callout h3{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);font-weight:680}
.callout p{margin:0;font-size:15.6px;line-height:1.68}

.repo-line{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13.6px;color:var(--muted);
  padding:15px 18px;border:1px dashed var(--line);border-radius:9px}
.repo-line code{font-family:var(--mono);font-size:12.6px;background:var(--code-bg);color:var(--code-ink);
  padding:4px 9px;border-radius:5px}

/* prose ----------------------------------------------------------------- */
.prose{font-size:16.4px;line-height:1.72}
.prose h1{font-family:var(--serif);font-size:clamp(31px,4.6vw,42px);line-height:1.1;letter-spacing:-.018em;
  margin:6px 0 26px;font-weight:600}
.prose h2{font-family:var(--serif);font-size:26px;line-height:1.24;letter-spacing:-.013em;font-weight:600;
  margin:54px 0 15px;padding-top:22px;border-top:1px solid var(--line)}
.prose h3{font-size:17.5px;margin:34px 0 11px;letter-spacing:-.008em;font-weight:640}
.prose h4{font-size:15.4px;margin:26px 0 8px;color:var(--muted);font-weight:640}
.prose h1:first-child{margin-top:0}
.prose h2 .anchor,.prose h3 .anchor{opacity:0;margin-left:-19px;padding-right:7px;text-decoration:none;
  color:var(--faint);font-weight:400;transition:opacity .12s}
.prose h2:hover .anchor,.prose h3:hover .anchor{opacity:1}
.prose h1 .anchor,.prose h4 .anchor{display:none}
.prose p{margin:0 0 17px}
.prose a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
.prose a:hover{border-bottom-color:var(--accent)}
.prose a.ext::after{content:"\\2197";font-size:.78em;vertical-align:super;margin-left:1px;opacity:.65}
.prose strong{font-weight:660}
.prose ul,.prose ol{margin:0 0 18px;padding-left:24px}
.prose li{margin:0 0 7px}
.prose li::marker{color:var(--faint)}
.prose li.task{list-style:none;margin-left:-20px;padding-left:26px;position:relative}
.prose li.task::before{content:"";position:absolute;left:2px;top:.42em;width:13px;height:13px;
  border:1.5px solid var(--line);border-radius:3.5px;background:var(--panel)}
.prose li.task.done::before{background:var(--good);border-color:var(--good)}
.prose blockquote{margin:22px 0;padding:2px 0 2px 20px;border-left:3px solid var(--line);color:var(--muted)}
.prose blockquote p{margin:0 0 10px}
.prose blockquote p:last-child{margin:0}
.prose hr{border:0;border-top:1px solid var(--line);margin:42px 0}

.prose code{font-family:var(--mono);font-size:.855em;background:var(--code-bg);color:var(--code-ink);
  padding:2px 5px;border-radius:4px;word-break:break-word}
.prose pre.code{background:var(--code-bg);border:1px solid var(--line);border-radius:9px;
  padding:16px 18px;overflow-x:auto;margin:0 0 20px;font-size:13.4px;line-height:1.6;position:relative}
.prose pre.code code{background:none;padding:0;font-size:inherit;color:var(--code-ink);white-space:pre}
.prose pre.code[data-lang]::before{content:attr(data-lang);position:absolute;top:0;right:0;
  font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);
  padding:6px 11px}

.table-wrap{overflow-x:auto;margin:0 0 22px;border:1px solid var(--line);border-radius:9px}
.prose table{border-collapse:collapse;width:100%;font-size:14.3px;line-height:1.5}
.prose th{text-align:left;font-weight:640;padding:11px 14px;background:var(--panel-2);
  border-bottom:1px solid var(--line);white-space:nowrap}
.prose td{padding:11px 14px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.prose tbody tr:last-child td{border-bottom:0}
.prose td code{font-size:.82em}

/* footer ---------------------------------------------------------------- */
.site-foot{max-width:790px;margin:70px auto 0;padding:26px 32px 0;border-top:1px solid var(--line);text-align:center}
.credit{margin:0 0 5px;font-size:14.6px;font-weight:560}
.credit a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
.credit a:hover{border-bottom-color:var(--accent)}
.credit-sub{margin:0;font-size:13px;color:var(--faint)}

/* responsive ------------------------------------------------------------ */
@media (max-width:900px){
  .layout{grid-template-columns:1fr}
  .rail{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);
    padding:16px 14px;flex-direction:row;align-items:center;gap:14px;overflow-x:auto}
  .brand span:last-child{display:none}
  .nav{flex-direction:row;gap:4px;flex:1}
  .nav-group{flex-direction:row}
  .toc-sub{display:none!important}
  .nav-item{white-space:nowrap;font-size:13.6px;padding:6px 11px}
  .rail-foot{border-top:0;padding-top:0}
  .theme span:last-child{display:none}
  .panel{padding:34px 20px 0}
  .site-foot{padding:26px 20px 0}
  .prose{font-size:16px}
  .prose h2{margin-top:42px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}

/* print -----------------------------------------------------------------
   Ctrl/Cmd-P produces all four documents as one paginated PDF, whichever
   panel happens to be open. The tab behaviour is a convenience for reading
   on screen; it should not decide what ends up on paper. */
@media print{
  :root{--paper:#fff;--ink:#000;--muted:#333;--faint:#555;--line:#bbb;--line-soft:#ddd;
    --panel:#fff;--panel-2:#f2f2f2;--accent:#7a4a10;--accent-soft:#f7f2ea;
    --code-bg:#f4f4f4;--code-ink:#000}
  .rail,.skip,.anchor,.repo-line{display:none!important}
  .layout{display:block}
  main{padding:0}
  body{font-size:10.5pt;line-height:1.5}
  .panel,.panel[hidden]{display:block!important;max-width:none;padding:0 0 18pt}
  .panel+.panel{page-break-before:always;break-before:page}
  .hero h1{font-size:30pt}
  .standfirst{font-size:12pt}
  .cards{display:none}
  .prose{font-size:10.5pt}
  .prose h1{font-size:20pt}
  .prose h2{font-size:14pt;page-break-after:avoid;break-after:avoid}
  .prose h3{font-size:11.5pt;page-break-after:avoid;break-after:avoid}
  .prose pre.code,.table-wrap,.stat,.callout,.prose blockquote{page-break-inside:avoid;break-inside:avoid}
  .prose pre.code{font-size:8.4pt;white-space:pre-wrap;word-break:break-word}
  .table-wrap{overflow:visible}
  .prose table{font-size:9pt}
  .prose a{border-bottom:0;color:#000}
  .prose a.ext::after{content:" \\2192 " attr(href);font-size:7.6pt;color:#555;word-break:break-all}
  .site-foot{page-break-before:avoid;break-before:avoid;margin-top:24pt}
}
`;
}

/* ── behaviour ───────────────────────────────────────────────────────────── */

function js() {
  return `
(function () {
  var panels = [].slice.call(document.querySelectorAll('[data-panel]'));
  var navItems = [].slice.call(document.querySelectorAll('.nav-item'));
  var ids = panels.map(function (p) { return p.dataset.panel; });

  function show(id, anchor) {
    if (ids.indexOf(id) === -1) id = 'overview';
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== id; });
    navItems.forEach(function (n) { n.classList.toggle('active', n.dataset.target === id); });
    document.querySelectorAll('.toc-sub').forEach(function (t) {
      t.classList.toggle('open', t.dataset.doc === id);
    });

    if (anchor) {
      var el = document.getElementById(anchor);
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }

  function fromHash() {
    var hash = location.hash.replace('#', '');
    if (!hash) return show('overview');
    var docId = hash.split('--')[0];
    show(docId, hash.indexOf('--') > -1 ? hash : null);
  }

  window.addEventListener('hashchange', fromHash);
  fromHash();

  // Highlight the section currently in view.
  var headings = [].slice.call(document.querySelectorAll('.prose h2[id]'));
  if ('IntersectionObserver' in window && headings.length) {
    var seen = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id);
      });
      document.querySelectorAll('.toc-sub a').forEach(function (a) {
        a.classList.toggle('here', seen.has(a.getAttribute('href').slice(1)));
      });
    }, { rootMargin: '-70px 0px -72% 0px' });
    headings.forEach(function (h) { observer.observe(h); });
  }

  // Theme: system by default, overridable, remembered.
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  if (stored) root.setAttribute('data-theme', stored);

  document.querySelector('.theme').addEventListener('click', function () {
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var current = root.getAttribute('data-theme') || (systemDark ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
}());
`;
}

build();
