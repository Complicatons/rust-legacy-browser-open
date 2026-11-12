// List your server (/list-your-server): a static page; signed-out readers start at sign-in, then land on /owner.
import {loadSession} from './session.mjs';

const {me}=await loadSession();
if(!me)for(const a of document.querySelectorAll('a[href="/owner"]'))a.href='/signin?next=/owner';
document.body.dataset.ready='1';
