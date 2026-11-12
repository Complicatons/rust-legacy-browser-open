// Steam account quality for servers that opt in (join policy, central/admin.mjs): account age, Steam level, VAC and
// game bans, through the Steam Web API with the operator's key. Results are cached per SteamID for a few hours; a
// server that sets thresholds refuses joins while Steam cannot be asked (fail closed), never other servers.
const API='https://api.steampowered.com';
const DAY=86400e3;

// Steam's three answers → {createdAt (ms, null when the profile hides it), visible, level, vacBans, gameBans, daysSinceLastBan}.
export function createSteamQuality({apiKey,fetchImpl=fetch,now=Date.now,ttlMs=6*3600e3,timeoutMs=5000}){
 const cache=new Map();
 const get=async(path,params)=>{const u=new URL(path,API);u.searchParams.set('key',apiKey);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetchImpl(u,{signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw Error('steam '+r.status);return r.json();};
 return {
  enabled:Boolean(apiKey),
  async profile(steamId){
   const t=now(),hit=cache.get(steamId);if(hit&&hit.until>t)return hit.value;
   if(!apiKey)throw Error('no steam api key');
   const [summary,level,bans]=await Promise.all([
    get('/ISteamUser/GetPlayerSummaries/v2/',{steamids:steamId}),
    get('/IPlayerService/GetSteamLevel/v1/',{steamid:steamId}),
    get('/ISteamUser/GetPlayerBans/v1/',{steamids:steamId})]);
   const p=summary?.response?.players?.[0],b=bans?.players?.[0];
   if(!p||!b)throw Error('steam profile not found');
   const value={visible:p.communityvisibilitystate===3,createdAt:Number.isFinite(p.timecreated)?p.timecreated*1000:null,
    level:Number.isInteger(level?.response?.player_level)?level.response.player_level:null,
    vacBans:Number(b.NumberOfVACBans)||0,gameBans:Number(b.NumberOfGameBans)||0,daysSinceLastBan:Number.isFinite(b.DaysSinceLastBan)?b.DaysSinceLastBan:null};
   cache.set(steamId,{until:t+ttlMs,value});if(cache.size>5000)for(const [k,v] of cache)if(v.until<=t)cache.delete(k);
   return value;
  },
 };
}

// Does the policy ask anything of the Steam account itself?
export const wantsSteamQuality=p=>p.steam_min_age_days>0||p.steam_min_level>0||p.steam_max_vac_bans>=0||p.steam_max_game_bans>=0||p.steam_min_days_since_ban>0;

// The first unmet threshold, or null. A hidden age or level counts as unmet only when that threshold is set.
export function steamQualityRefusal(p,profile,t=Date.now()){
 if(p.steam_min_age_days>0){if(profile.createdAt==null)return 'steam-profile-private';if(t-profile.createdAt<p.steam_min_age_days*DAY)return 'steam-account-too-new';}
 if(p.steam_min_level>0){if(profile.level==null)return 'steam-profile-private';if(profile.level<p.steam_min_level)return 'steam-level-too-low';}
 if(p.steam_max_vac_bans>=0&&profile.vacBans>p.steam_max_vac_bans)return 'steam-vac-banned';
 if(p.steam_max_game_bans>=0&&profile.gameBans>p.steam_max_game_bans)return 'steam-game-banned';
 if(p.steam_min_days_since_ban>0&&(profile.vacBans+profile.gameBans)>0&&profile.daysSinceLastBan!=null&&profile.daysSinceLastBan<p.steam_min_days_since_ban)return 'steam-recent-ban';
 return null;
}
