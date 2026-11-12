// Downloads (/downloads): the game loader's and the host app's download boxes (site/js/downloads-box.mjs).
import {downloadBox} from './downloads-box.mjs';

const [loader,host]=await Promise.all([downloadBox('loader'),downloadBox('host')]);
for(const [id,box] of [['dl-loader',loader],['dl-host',host]]){const slot=document.getElementById(id);slot.removeAttribute('aria-busy');slot.replaceChildren(box);}
document.body.dataset.ready='1';
