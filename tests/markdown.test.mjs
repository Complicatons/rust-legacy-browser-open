// Restricted wiki markdown (site/js/markdown.mjs): escaping, safe links and images, tables, embeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,parseFrontMatter} from '../site/js/markdown.mjs';

test('text is escaped and raw HTML never passes through', () => {
 const html=renderMarkdown('Hello <script>alert(1)</script> & <img src=x onerror=alert(1)>');
 assert.ok(!html.includes('<script'));assert.ok(!/<img[^>]*onerror/i.test(html));
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;img/);
});

test('attribute breakouts in link and image targets stay escaped', () => {
 const html=renderMarkdown('![x](/site/a.png"onerror="alert(1)) [y](/wiki"onmouseover="alert(1))');
 assert.ok(!/<[^>]*\son(error|mouseover)=/i.test(html));
});

test('only site-relative and https links become anchors', () => {
 assert.equal(renderMarkdown('[x](javascript:alert(1))'),'<p>x</p>');
 assert.equal(renderMarkdown('[x](//evil.example/a)'),'<p>x</p>');
 assert.equal(renderMarkdown('[x](/\\evil.example/a)'),'<p>x</p>','browsers read /\\host as //host');
 assert.equal(renderMarkdown('[Servers](/servers)'),'<p><a href="/servers">Servers</a></p>');
 assert.equal(renderMarkdown('[Docs](https://example.org/a?b=1&c=2)'),'<p><a href="https://example.org/a?b=1&amp;c=2" rel="nofollow noopener" target="_blank">Docs</a></p>');
});

test('images must come from the site itself', () => {
 assert.equal(renderMarkdown('![a](https://evil/x.png)'),'<p></p>');
 assert.equal(renderMarkdown('![Map](/site/generated/media/dusk.jpg)'),'<p><img src="/site/generated/media/dusk.jpg" alt="Map" loading="lazy"></p>');
});

test('headings, emphasis, code, lists and fenced code', () => {
 const html=renderMarkdown('# Title\n## Sub\n### Small\n\nSome **bold** and *em* and `code <b>`.\n\n- one\n- two\n\n1. first\n2. second\n\n```\n<raw> & stuff\n```');
 assert.match(html,/<h2>Title<\/h2><h3>Sub<\/h3><h4>Small<\/h4>/);
 assert.match(html,/<p>Some <strong>bold<\/strong> and <em>em<\/em> and <code>code &lt;b&gt;<\/code>\.<\/p>/);
 assert.match(html,/<ul><li>one<\/li><li>two<\/li><\/ul><ol><li>first<\/li><li>second<\/li><\/ol>/);
 assert.match(html,/<pre><code>&lt;raw&gt; &amp; stuff<\/code><\/pre>/);
});

test('pipe tables render as tables', () => {
 const html=renderMarkdown('| Target | Charges |\n|---|---:|\n| Wooden Door | 1 |\n| Wood Gateway | 5 |');
 assert.equal(html,'<table><thead><tr><th>Target</th><th>Charges</th></tr></thead><tbody><tr><td>Wooden Door</td><td>1</td></tr><tr><td>Wood Gateway</td><td>5</td></tr></tbody></table>');
});

test('item and place embeds call the resolvers', () => {
 const calls=[];
 const html=renderMarkdown('Take a [[item:Hatchet]] to [[place:Hangar]], not [[item:Nope]].',{
  resolveItem:n=>{calls.push(['item',n]);return n==='Hatchet'?{slug:'hatchet',name:'Hatchet',icon:'/site/generated/wiki/icons/hatchet.png'}:null;},
  resolvePlace:n=>{calls.push(['place',n]);return {title:'Hangar',x:6400,z:4700};},
 });
 assert.deepEqual(calls,[['item','Hatchet'],['place','Hangar'],['item','Nope']]);
 assert.match(html,/<a class="wiki-item" href="\/wiki\/items\/hatchet"><img src="\/site\/generated\/wiki\/icons\/hatchet.png" alt="" loading="lazy">Hatchet<\/a>/);
 assert.match(html,/<a class="wiki-place" href="\/island\?x=6400&amp;z=4700&amp;zoom=4">Hangar<\/a>/);
 assert.match(html,/<span class="wiki-missing">Nope<\/span>/);
});

test('front matter gives the metadata and the body', () => {
 const {meta,body}=parseFrontMatter('---\ndate: 2026-10-19\ntitle: Sky, sea and shaders\nsummary: "Original sky: sun, moon and clouds"\nimage: /site/generated/media/dusk.jpg\n---\n\n## Sky\n\nText.\n');
 assert.deepEqual(meta,{date:'2026-10-19',title:'Sky, sea and shaders',summary:'Original sky: sun, moon and clouds',image:'/site/generated/media/dusk.jpg'});
 assert.equal(body,'## Sky\n\nText.\n');
 assert.deepEqual(parseFrontMatter('No front matter.'),{meta:{},body:'No front matter.'});
 assert.deepEqual(parseFrontMatter('---\r\ntitle: \'Quoted\'\r\n---\r\nBody').meta,{title:'Quoted'});
});
