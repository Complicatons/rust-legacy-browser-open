// Points page name ?to (default p1) at the page ?from (default p2), so the offline steps can drive an online page.
export default async function({pages,logs},q){const from=q.from??'p2',to=q.to??'p1';pages.set(to,pages.get(from));logs.set(to,logs.get(from));return `${to} -> ${from}`;}
