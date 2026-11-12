// Refreshes site/content/progress.json (the roadmap progress bar's fallback) from the public journal's README.
//   node tools/sync-progress.mjs [readme-url]
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseProgress} from '../central/progress.mjs';

const url=process.argv[2]??'https://raw.githubusercontent.com/OWNER/rust-legacy-browser/main/README.md';
const res=await fetch(url);if(!res.ok)throw Error(`${url}: HTTP ${res.status}`);
const data=parseProgress(await res.text());if(!data)throw Error(`${url}: no "Overall … NN%" figure found`);
await writeFile(fileURLToPath(new URL('../site/content/progress.json',import.meta.url)),JSON.stringify(data,null,1)+'\n');
console.log(`progress: ${data.overall}% (${data.date??'no date'}), ${data.areas.length} areas`);
