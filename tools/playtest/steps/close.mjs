// Closes page ?page (default p1) without its beforeunload prompt, freeing its memory before the next page opens.
export default async function({pages},q){const name=q.page??'p1',page=pages.get(name);if(!page)return 'none';await page.close({runBeforeUnload:false});pages.delete(name);return 'closed '+name;}
