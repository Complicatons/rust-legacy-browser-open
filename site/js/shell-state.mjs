// DOM-free state for the site shell (top bar tabs and account corner). Imported by shell.mjs and by node tests.
const TABS=['servers','island','updates','roadmap','guide','wiki','forum'];

// Which top-bar tab a path belongs to ('play' is the title screen), or null for pages outside the tabs.
export function navState(pathname){
 if(pathname==='/'||pathname==='')return 'play';
 const first=pathname.split('/')[1];
 if(first==='leaderboard'||first==='players')return 'servers'; // the leaderboard sits under the Servers tab
 return TABS.includes(first)?first:null;
}

// What the account corner shows: provider sign-in buttons when signed out, the player's menu when signed in.
export function accountCorner(me,config={}){
 if(!me)return {kind:'signed-out',providers:[...(config.providers??[])]};
 return {kind:'signed-in',name:me.username??me.name,staff:Boolean(me.staff),needsUsername:Boolean(me.needsUsername)};
}
