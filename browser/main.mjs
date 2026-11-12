import './asset-versions.mjs'; // first: versioned, cacheable URLs for everything below (tools/asset-versions.mjs)
import * as THREE from '/vendor/three.module.js';
import {sampleTriangle,worldToGrid} from './terrain.mjs';
import {createTerrainLOD} from './terrain-lod.mjs';
import {createTreeRenderer,treeSettings} from './trees.mjs';
import {legacyTerrainMaterial} from './legacy-materials.mjs';
import {createGrass} from './grass.mjs';
import {deathShot} from './ragdoll-death.mjs';
import {DroppedItems} from './dropped-items.mjs';
import {RenderSettings} from './render-settings.mjs';
import {createGameControls,createBootConsole} from './game-controls.mjs';
import {loadOriginalScene,loadSceneManifest,prepareOriginalScene,createAssetLoader} from './scene.mjs';
import {createTextureSource,useTextureSource,loadRecovered,setFlipY,textureStats} from './texture-source.mjs';
import {buildOriginalCollision,MovingBody,GridBody,solidLayerGroups} from './collision.mjs';
import {loadRockColliders} from './rock-colliders.mjs';
import {loadClips} from './clip-pack.mjs';
import {LegacyMotor,humanInputSample,isSprinting} from './motor.mjs';
import {FallTracker,fallSpeed,fallImpact,fallImpactMessage,injuryDuration,hurtSelf} from './fall-damage.mjs';
import {createInventoryUI} from './inventory-ui.mjs';
import {createDoors,LegacyDoor,deployableDoor,DoorState} from './doors.mjs';
import {LootSystem,populateLoot,RadialCheck} from './loot.mjs';
import {ResourceSystem,MeleeGather,meleeWears} from './resources.mjs';
import {WildlifeWorld,Wildlife,wildlifePhysics} from './animals.mjs';
import {loadNavMesh} from './navmesh.mjs';
import {WorldRules} from './world-rules.mjs';
import {completeRepair} from './repair.mjs';
import {saveWorld,loadWorld,saveSlot} from './persistence.mjs';
import {takeJoin,OnlineSession,STATE,entityTransform,applyEntityCall,OnlineContext,sceneDoorViews,applySceneDoorCall} from './online.mjs';
import {createAdminCapture} from './admin-capture.mjs';
import {HumanBody,Metabolism,menuOption,useItem} from './survival.mjs';
import {createItemMenu} from './item-menu.mjs';
import {beltUse,resourceRepair,lockpickNotice} from './belt-use.mjs';
import {DeployableSystem,checkPlacement,canPlace,component,hardpointsOf,unityMatrix as deployMatrix} from './deployables.mjs';
import {Capsule} from 'three/addons/math/Capsule.js';
import {ParticleEffect,linkSubEmitters,particleLightingFrom} from './particles.mjs';
import {lightDriver} from './light-style.mjs';
import {legacyEffects} from './legacy-particles.mjs';
import {createFxAssets} from './fx-assets.mjs';
import {StructureSystem} from './structures.mjs';
import {healthDimmerGrey,takeDamageData} from './take-damage.mjs';
import {TimeOfDay,radiationExposure,applySkyState} from './tod.mjs';
import {createSky} from './sky.mjs';
import {createWater4} from './water4.mjs';
import {waterRefresh,cameraLayerDistances,FrameLimiter,renderCommand,clamp01} from './render-convars.mjs';
import {createLayerCuller} from './layer-culling.mjs';
import {Recoil,GunState,StrikeGunState,BowState,ThrowState,Arrow,Grenade,heldItemPreFrame,aimSway,pelletDirection,lookRotation,arrowDamage,bulletDamage,grenadeHits,timedExplosiveHits,timedExplosivePoint,tryConditionLoss,isBroken,wornArmor} from './combat.mjs';
import {createAnimalRenderer,prefetchAnimalAssets} from './animal-view.mjs';
import {createViewModelRenderer} from './viewmodel.mjs';
import {createPlayerRenderer} from './player-view.mjs';
import {ServerWildlife} from './server-wildlife.mjs';
import {armorKeys,censorship} from './armor.mjs';
import {ServerInventory} from './server-inventory.mjs';
import {ServerVitals} from './server-vitals.mjs';
import {ServerFirearm,ServerBow,ServerMelee,serverGunRays,serverMeleeCast,serverBowImpact,onlinePullOut,offlinePullOut} from './server-combat.mjs';
import {ServerThrowables,FlareState} from './server-throwables.mjs';
import {ThrownFlare,flareThrow,consumeOne,holsterFlare} from './offline-flare.mjs';
import {ServerRigid} from './server-rigid.mjs';
import {ServerBuildings} from './server-buildings.mjs';
import {ServerHeldItems} from './server-held.mjs';
import {createLockEntryUI,clientUICommand} from './lock-entry.mjs';
import {createPopupUI} from './popup-ui.mjs';
import {ContextClient,offlineContextServer,createContextUI} from './context-ui.mjs';
import {createCrosshair} from './crosshair.mjs';
import {createChatUI,createLocalChatServer,LOCAL_PLAYER_NAME} from './chat.mjs';
import {forwardableConsoleText,serverConsoleLines} from './console-route.mjs';
import {noticeStyle,INFORMATION_NOTICE} from './notices.mjs';
import {doorMenu,canToggleDoor,enterCode,setLockActive,LOCKED_MESSAGE} from './locks.mjs';
import {createHud} from './hud.mjs';
import {createUseHover,lootTextPoint,spriteTextPoint,doorTextPoint,lootContextText,fireContextText,contextKind} from './use-hover.mjs';
import {CameraSway} from './camera-sway.mjs';
import {HeadBob,bobViewMatrix,withHeadBob} from './head-bob.mjs';
import {remoteBulletEnd} from './remote-weapon.mjs';
import {createCombatFeedback,shouldPlayHitNotification,isHeadshotPart,VitalsSender} from './combat-feedback.mjs';
import {itemEventSound,equipmentEvents,equipmentSnapshot} from './item-events.mjs';
import {createTracerEffects} from './tracer-effects.mjs';
import {MuzzleFlashes} from './muzzle-flash.mjs';
import {createItemModAssets} from './item-mods.mjs';
import {createWeaponModEffects} from './weapon-mod-effects.mjs';
import {meleeSwingSound,meleeImpact} from './melee-effects.mjs';
import {applyPanning,heldRepSounds,soundPoolAudible,sourceDistanceModel,sourcePlaysOnInstantiate} from './unity-audio.mjs';
import {createDeathScreen,deathReason} from './death-screen.mjs';
import {dropInventoryContents,hostileDeathDrop,DEATH_DROP_PREFAB} from './death-drop.mjs';
import {createFrontEnd,LEVEL_NAME} from './front-end.mjs';
import {ConVars,lookRadiansPerCount,pixelRatioForQuality} from './convars.mjs';
import {registerTexture,onTextureRegistered,textureAnisoLevel} from './quality.mjs';
import {createQualityController} from './quality-controller.mjs';
import {getGameInput,mouseKeyCode} from './key-bindings.mjs';
import {createContextSprites,doorStatus,sleepingBagStatus,SPRITE} from './context-sprites.mjs';
import {isTorch,torchActivated,torchServerFrame} from './torch-fuel.mjs';
import {spawnLook} from './net-client.mjs';
import {createNameTagLayer,GAME_TIP,tipAlpha,tipScale,lineOfSightBlocked} from './name-tags.mjs';
import {audioSettings} from './audio.mjs';
import {createWorldAudio} from './world-audio.mjs';
import {createVoiceChat} from './voice.mjs';
import {AirdropActors,OfflineAirdrops,ServerAirdrops,createAirdropRenderer,prefetchAirdropAssets,callTime,interpolationDelay,SEND_RATE,PosRotInterpolator} from './airdrops.mjs';
import {ServerCrates} from './server-crates.mjs';
import {ragdollEnvironment} from './ragdoll-environment.mjs';
import {ArrowTrail} from './arrow-trail.mjs';
import {createClientCommands,smoothDelta} from './client-commands.mjs';
import {FavouriteList} from './server-list.mjs';
import {tryConditionLoss as itemConditionLoss,armorConditionLoss,canActivate,CONDITION_LOSS} from './item-condition.mjs';
import {createPlacementPreview,gizmos as placementGizmos} from './placement-preview.mjs';
import {ThrownGrenade,LOOK_UP as THROW_ROTATION} from './thrown-physics.mjs';
import {prefetchWorld} from './world-prefetch.mjs';
import {webgl2Problem,startupMessage,showStartupError} from './webgl-support.mjs';
import {ADAPTIVE_NEAR_PLANE,adaptiveNearMask,adaptiveNearPlane,boundsTouchSphere} from './adaptive-near-plane.mjs';
import {deploySoundFor,explosionEffectFor,explosionLightIntensity,explosionPitch,EXPLOSION_LIFETIME,EXPLOSION_LIGHT_FADE} from './presentation-extras.mjs';
const base='/assets/recovered/', status=document.querySelector('#status');
let frontEnd=null;
const loadJson=async name=>{const r=await fetch(base+name);if(!r.ok)throw Error(`Missing ${name}; run the exporter.`);return r.json();};
// The join's JSON files are requested together when it starts (prefetchJson); the first json(name) call then takes that
// pending load (each consumer still gets its own parsed object), so the build below no longer waits for each in turn.
const earlyJson=new Map(),prefetchJson=names=>{for(const name of names)if(!earlyJson.has(name)){const p=loadJson(name);p.catch(()=>{});earlyJson.set(name,p);}};
const json=name=>{const p=earlyJson.get(name);if(!p)return loadJson(name);earlyJson.delete(name);return p;};
try {
 let renderStore=null;try{renderStore=localStorage;}catch{}
 // fullscreen: play-in-fullscreen default (game-controls.mjs); automation keeps windowed play unless it opts in.
 const renderSettings=new RenderSettings(renderStore,{fullscreen:!navigator.webdriver});let gameControls=null;
 // Normal entry: the original front end (front-end.mjs: MainMenu, Options, ServerBrowser, LoadingScreen). ?dev keeps the
 // developer explorer UI (every GPU harness opts in with it); it is a URL flag, never automation detection.
 const devMode=new URLSearchParams(location.search).has('dev');
 // ?dev&aerial: website map capture (tools/capture-aerial.mjs). Every tree in view is a full mesh, and aerialTile() pauses the loop.
 const aerialMode=devMode&&new URLSearchParams(location.search).has('aerial');let aerialHold=false;if(!devMode){document.body.classList.add('rlb-player');document.title='Rust Legacy';}
 // No WebGL 2: neither the menu background nor the island can draw. Say so before the menu (webgl-support.mjs).
 {const problem=webgl2Problem();if(problem){status.textContent=startupMessage(problem).text;if(!devMode)showStartupError(document,startupMessage(problem));
  throw Object.assign(Error('WebGL 2 unavailable ('+problem+')'),{startupShown:true});}}
 const convars=new ConVars(renderStore,{sound:audioSettings});
 // Original GameInput buttons (Options key rows, input.bind) and InputManager axes: every game key goes through this.
 const gameInput=getGameInput({storage:renderStore});
 if(!devMode)frontEnd=await createFrontEnd({convars,renderSettings,input:gameInput});
 // The F1 ConsoleWindow from boot (same GameUI scene as MainMenu/LoadingScreen, game-controls.mjs createBootConsole):
 // F1 works on the main menu and while loading, the LoadingScreen lines are logged into it, and its commands run
 // through localRoute (the client commands below until the game exists, then localConsoleCommand).
 // Before the game: RunCommand_Clientside for what exists yet (render.fov included); anything else would go to
 // SendCommandToServer, which does nothing without a server (no ConsoleNetworker yet), so there is no reply.
 const fovCommand=line=>line.trim().split(/\s+/)[0]==='render.fov'?renderSettings.command(line):null;
 let localRoute=line=>clientCommands.command(line)??convars.command(line)??gameInput.bindings.command(line,renderStore)??fovCommand(line);
 const bootConsole=await createBootConsole({route:line=>localRoute(line)});
 // Debug.Log lines (ConsoleWindow.CaptureLog: [color #eeeeee]> text) from the client commands and the loading screen.
 const consoleLog=text=>bootConsole.log(text);frontEnd?.setLog(consoleLog);
 // Client console commands the original client runs itself (client-commands.mjs): gui.*, censor.nudity, gametip.scale,
 // footsteps.quality, global.fpslog/echo/find, config.save/load, serverfavourite.*, net.connect/disconnect/reconnect.
 // gui.hide: GUIHide on the RPOS UI Root (HUD, belt, inventory windows) and on the GameUI Overlay (branding, name tags).
 const clientCommands=createClientCommands({convars,bindings:gameInput.bindings,storage:renderStore,censor:{get:()=>censorship.censored,set:v=>censorship.set(v)},gizmos:placementGizmos,
  favourites:frontEnd?.favourites??(()=>{const f=new FavouriteList(renderStore);f.load();return f;})(),net:frontEnd?.net??null,log:consoleLog,run:line=>localRoute(line),
  gui:{setVisible:v=>{document.body.classList.toggle('rlb-gui-hidden',!v);frontEnd?.setOverlayVisible(v);},setBrandingVisible:v=>frontEnd?.setBrandingVisible(v)}});
 // RunConsoleCommand buttons of the menu (front-end.mjs runCommand).
 frontEnd?.setConsole(line=>{const r=localRoute(line);if(r?.text)consoleLog(r.text);});
 // A one-use join ticket from the website (site/site.mjs) means online mode; read and removed at once.
 let sessionStore=null;try{sessionStore=window.sessionStorage;}catch{}
 // The front end hands over the server chosen in its browser, or the website's ticket at once (net.connect).
 // The island's files download into the browser cache once the menu background is up (world-prefetch.mjs), or at once
 // without a menu or when a server is chosen first; the load below then reads them from the cache.
 let worldPrefetch=null;const startPrefetch=()=>{worldPrefetch??=prefetchWorld();};frontEnd?.backgroundReady.then(startPrefetch);if(!frontEnd)startPrefetch();
 Object.defineProperty(window,'rlbPrefetch',{configurable:true,get:()=>worldPrefetch?{...worldPrefetch.state}:null});
 const choice=frontEnd?await frontEnd.choose():{join:takeJoin(sessionStore)},onlineJoin=choice.join??null;startPrefetch();
 // Connect straight away (join tickets are short-lived); the player is attached once the world has loaded.
 const online=onlineJoin?new OnlineSession({join:onlineJoin}):null;
 const onlineConnect=online?.connect();onlineConnect?.catch(()=>{});onlineConnect?.then(()=>frontEnd?.connected(),e=>frontEnd?.failed({reason:e.reason??e.message,error:e.error}));
 frontEnd?.loading('loading '+LEVEL_NAME); // RustLevel.LoadRoutine messages; the bar is LoadingScreen.Operations
 // The scene manifest and the JSON files are requested together now; once the renderer's texture source is in use, the
 // files the scene import awaits are queued too (prepareOriginalScene), so they load while the terrain textures (the
 // 4096² control normal map decode is the longest) come in.
 const sceneManifest=loadSceneManifest();sceneManifest.catch(()=>{});
 prefetchJson(['manifest.json','world-materials.json','quality/manifest.json','render-extras.json','trees.json','player.json','headbob.json','physics.json',
  'loot/manifest.json','resources/manifest.json','rockspawn/manifest.json','animals/manifest.json','deployables/manifest.json','placement/manifest.json','fx/manifest.json','players/ragdoll.json','airdrop/manifest.json','presentation/manifest.json']);
 const manifest=await json('manifest.json'), response=await fetch(base+manifest.heightFile);prefetchJson(manifest.models.map(m=>m.file));
 if(!response.ok)throw Error('Missing height data');
 const full=new Float32Array(await response.arrayBuffer());
 if(full.length!==manifest.size**2)throw Error('Invalid height data');
 const scene=new THREE.Scene();
 // Fog and background colour follow TOD_Sky.SampleFogColor each frame (sky.applyFog); range from the client
 // RenderSettings (linear, 0 to 4000 m). These are the values until the sky export has loaded.
 scene.background=new THREE.Color('#b8c6c5');scene.fog=new THREE.Fog('#b8c6c5',0,4000);
 const camera=new THREE.PerspectiveCamera(renderSettings.fov,innerWidth/innerHeight,0.05,24000);
 // QualitySettings.antiAliasing is 0 at every original level (Deferred Lighting): no MSAA; the AA is the FXAA image effect (gfx.ssaa).
 const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#world'),antialias:false,powerPreference:'high-performance'}); // checks use page screenshots, so the drawing buffer need not be preserved
 renderer.setPixelRatio(devMode?Math.min(devicePixelRatio,1.5):pixelRatioForQuality(convars.get('render.level'),devicePixelRatio));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.info.autoReset=false; // Count the world and viewmodel passes together.
 // GPU reset (driver update, sleep, GPU process crash): three keeps the context restorable and re-uploads everything when
 // the browser restores it (checked with WEBGL_lose_context: same frame after restore). If the browser does not restore
 // it within 10 s the picture would stay frozen, so the player is told and offered a reload (webgl-support.mjs).
 {let lostTimer=null;renderer.domElement.addEventListener('webglcontextlost',()=>{clearTimeout(lostTimer);lostTimer=setTimeout(()=>showStartupError(document,startupMessage('context-lost')),10000);});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{clearTimeout(lostTimer);lostTimer=null;document.querySelector('#startup-error')?.remove();});}
 // KTX2/Basis textures where encoded (tools/encode-ktx2.mjs), PNG otherwise; ?ktx2=0 forces the PNGs.
 {const q=new URLSearchParams(location.search);useTextureSource(createTextureSource(renderer,{enabled:q.get('ktx2')!=='0',webpEnabled:q.get('webp')!=='0'}));}
 const scenePrepared=prepareOriginalScene(sceneManifest);scenePrepared.catch(()=>{});
 const hemi=new THREE.HemisphereLight(0xe4efff,0x61563d,2);scene.add(hemi);const sun=new THREE.DirectionalLight(0xffe8c5,2.3);sun.position.set(-3000,5000,1500);scene.add(sun);
 const loader=new THREE.TextureLoader(), cache=new Map();
 // Pending loads are shared: the terrain textures now finish while the scene and trees load (a failed load is retried).
 function tex(name,color=true,repeat=false){ const key=name+color+repeat;if(!cache.has(key))cache.set(key,loadRecovered(base+name).then(t=>{t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;setFlipY(t,true);if(repeat)t.wrapS=t.wrapT=THREE.RepeatWrapping;registerTexture(t,name);return t;},e=>{cache.delete(key);throw e;}));return cache.get(key); } // anisotropy: QualitySettings.anisotropicTextures x the texture's own level
 // Original terrain material (Nature/Terrain/Facepunch Terrain, browser/legacy-materials.mjs) from world-materials.json
 // (tools/export_world_materials.py); without that export the older splat-only approximation is used.
 const worldMaterials=await json('world-materials.json').catch(()=>null);
 // The terrain material exists now (same creation order); its textures finish loading while the scene imports and are
 // awaited (terrainTextures) before anything can compile or draw it.
 const terrainMaterial=worldMaterials?legacyTerrainMaterial(worldMaterials.terrain,{texture:(file,o)=>tex(file,false,!o?.clamp),layers:manifest.layers.map(l=>l.file),control:manifest.alpha.file}):null,terrainTextures=terrainMaterial?.loaded;terrainTextures?.catch(()=>{});
 const material=terrainMaterial?.material??new THREE.MeshStandardMaterial({roughness:1});
 const layers=worldMaterials?null:await Promise.all(manifest.layers.map(l=>tex(l.file,true,true))),alpha=worldMaterials?null:await tex(manifest.alpha.file,false);
 if(!worldMaterials)material.onBeforeCompile=shader=>{
  shader.uniforms.splat={value:alpha};layers.forEach((t,i)=>shader.uniforms['layer'+i]={value:t});
  shader.fragmentShader='varying vec2 terrainUv; uniform sampler2D splat; uniform sampler2D layer0; uniform sampler2D layer1; uniform sampler2D layer2; uniform sampler2D layer3;\n'+shader.fragmentShader.replace('#include <map_fragment>',`vec4 w=texture2D(splat,terrainUv);w/=max(dot(w,vec4(1.)),0.0001);diffuseColor.rgb *= texture2D(layer0,terrainUv*${16000/60}).rgb*w.r+texture2D(layer1,terrainUv*800.).rgb*w.g+texture2D(layer2,terrainUv*1600.).rgb*w.b+texture2D(layer3,terrainUv*4000.).rgb*w.a;`);
 };
 // All 2049 x 2049 original height samples (7.8 m apart): buildings and roads sit on the same ground they were placed on.
 const terrainLOD=createTerrainLOD(full,manifest.size,material,{renderer,pixelError:manifest.treeRendering?.effective?.heightmapPixelError??30});scene.add(terrainLOD.group);

 // Render Quality data (tools/export_quality.py): QualitySettings, sun shadow settings, camera image effects, renderer shadow flags.
 const qualityManifest=await json('quality/manifest.json').catch(e=>{console.warn('Quality export missing:',e.message);return null;});let qualityController=null;
 // Textures are uploaded as they finish loading, one per task in the gaps while the join waits on downloads and
 // transcodes, instead of all in the first frames (renderer.initTexture is the upload the first draw would do). Only
 // textures with anisotropy level 1: the quality controller later raises the others' anisotropy, which uploads them again.
 const uploadQueue=[],anisoLevels=qualityManifest?.textureAniso?.levels??{};let uploadTimer=null;
 const uploadNext=()=>{uploadTimer=null;const t=uploadQueue.shift();if(t)renderer.initTexture(t);if(uploadQueue.length)uploadTimer=setTimeout(uploadNext,0);};
 const stopEarlyUploads=onTextureRegistered((t,file)=>{if(textureAnisoLevel(file,anisoLevels)!==1)return;uploadQueue.push(t);uploadTimer??=setTimeout(uploadNext,0);});
 const originalScene=await loadOriginalScene(scene,(count,total)=>{status.textContent=`Importing original scene · ${count} objects…`;frontEnd?.loading(null,count,total);},{shadowFlags:qualityManifest?.shadowFlags?.scene,prepared:scenePrepared});
 frontEnd?.loading('loading trees');
 // "loading shared" downloads start now that the scene import has drained the shared prefetch queue (scene.mjs): the loot,
 // tree-collider, resource, wildlife, deployable and airdrop files and textures are queued in the order the loops below
 // build, so they load while trees, collision and the GUI build. Wildlife clips, the navmesh and Rapier start too. No
 // three object is created here: the templates are still built later, one by one, in their old order.
 const sharedJson=name=>{const p=json(name);p.catch(()=>{});return p;};
 const lootManifestLoad=sharedJson('loot/manifest.json'),resManifestLoad=sharedJson('resources/manifest.json'),animalManifestLoad=sharedJson('animals/manifest.json'),deployManifestLoad=sharedJson('deployables/manifest.json'),airdropManifestLoad=sharedJson('airdrop/manifest.json');
 // LODGroup: draw only the full-detail mesh; layer 14 holds grass-displacement sprites; ContextSprite is the use-icon billboard.
 const drawnRenderer=r=>r.layer!==14&&!/_LOD_?(LOW|[1-9])/i.test(r.name);
 const templateRenderers=p=>p.renderers.filter(r=>drawnRenderer(r)&&!(p.components.ContextSprite??[]).some(c=>c.node===r.node));
 const sharedAssets=(async()=>{const [loot,res,animals,deploy,airdrop]=await Promise.all([lootManifestLoad,resManifestLoad,animalManifestLoad,deployManifestLoad,airdropManifestLoad].map(p=>p.catch(()=>null)));
  const a={loot:loot&&createAssetLoader(base+'loot/',loot),res:res&&createAssetLoader(base+'resources/',res),animals:animals&&createAssetLoader(base+'animals/',animals),deploy:deploy&&createAssetLoader(base+'deployables/',deploy),airdrop:airdrop&&createAssetLoader(base+'airdrop/',airdrop)};
  if(loot)for(const prefab of Object.values(loot.prefabs))for(const r of prefab.renderers)a.loot.prefetch(r.mesh,r.materials,r.materials.map((_,i)=>i));
  if(res){a.res.prefetchBinary(res.treeColliders.position,Float32Array);a.res.prefetchBinary(res.treeColliders.indices,Uint32Array);
   for(const p of Object.values(res.prefabs))for(const mesh of p.visualMeshes)a.res.prefetch(mesh,p.materials,p.materials.map((_,i)=>i));}
  if(animals)prefetchAnimalAssets(animals,a.animals);
  if(deploy)for(const p of Object.values(deploy.prefabs))for(const r of templateRenderers(p))a.deploy.prefetch(r.mesh,r.materials,r.materials.map((_,i)=>i));
  if(airdrop)prefetchAirdropAssets(airdrop,a.airdrop);
  return a;})();
 const animalClipsLoad=loadClips(base+'animals/clips.json'),navmeshLoad=loadNavMesh(new URL('navmesh/',new URL(base,location.href)));
 const rapierLoad=import('/vendor/rapier.mjs').then(async({default:engine})=>{await engine.init();return engine;});
 for(const p of [animalClipsLoad,navmeshLoad,rapierLoad])p.catch(()=>{});
 // Sea: the original FX/Water4 "Tile" plane (252.4 m, 50 km wide) and the TOD_Sky dome/clouds (tools/export_sky.py).
 // sea.setReflections(bool) is the original 'Water Reflections' option (water.reflection, default off).
 const water=originalScene.manifest.instances.find(i=>i.materials.some(k=>originalScene.manifest.materials[k].shader==='FX/Water4'));
 if(!water)throw Error('Original water plane missing from scene export');
 // Render data beyond the world/sky exports (tools/export_render_extras.py): WindZone, tree wind channels, moon rotation.
 const renderExtras=await json('render-extras.json').catch(e=>{console.warn('Render extras missing:',e.message);return null;});
 const sky=await createSky({renderer,moon:renderExtras?.moon}).catch(e=>{console.warn('Original sky not loaded:',e.message);return null;});
 let sea=null;
 // The Scene Camera's per-layer cull distances (CameraLayerDepths, spherical; CameraSettings raises CULL500 with
 // render.distance) over the original scene's renderers (browser/layer-culling.mjs); 0-distance layers keep the far clip.
 const cameraComponent=type=>qualityManifest?.camera?.components?.find(c=>c.type===type)?.params??null;
 const layerDepths=cameraComponent('CameraLayerDepths')??{layer11:5,layer12:600,spherical:1},viewDistanceLayers=cameraComponent('CameraSettings')?.ViewDistanceLayers??[{Name:'CULL500',MinimumValue:600,MaximumValue:1600}];
 const layerIndex=name=>{const e=Object.entries(sky?.manifest.layers??{12:'CULL500'}).find(([,n])=>n===name);return e?Number(e[0]):-1;};
 const layerCuller=createLayerCuller({far:qualityManifest?.camera?.far??6000,spherical:layerDepths.spherical!==0});layerCuller.addScene(originalScene.group);
 const frameLimiter=new FrameLimiter(convars.get('render.frames'));let renderRefresh=null;
 if(sky){scene.add(sky.group);sea=await createWater4({manifest:sky.manifest,bounds:water.worldBounds,renderer,sky,terrain:terrainLOD});scene.add(sea.mesh);if(sea.writeZ)scene.add(sea.writeZ);
  // PlanarReflection mask with reflections on: CULL500 (12), Terrain (19), MeshBatched (22) and Skybox (23) layers.
  sea.setReflected(terrainLOD.group);sea.setReflected(hemi);sea.setReflected(sun);originalScene.group.traverse(o=>{if([12,19,22,23].includes(o.userData.layer))sea.setReflected(o);});
  // The reflection camera has no layer cull distances: the main camera's CULL500 culling steps aside for that pass.
  sea.setReflectionHooks({before:()=>layerCuller.suspend(),after:()=>layerCuller.resume()});}
 else{const [wlo,whi]=water.worldBounds,flat=new THREE.Mesh(new THREE.PlaneGeometry(whi[0]-wlo[0],whi[2]-wlo[2]),new THREE.MeshStandardMaterial({color:0x426d79,roughness:0.4,transparent:true,opacity:0.85}));
  flat.rotation.x=-Math.PI/2;flat.position.set((wlo[0]+whi[0])/2,wlo[1],(wlo[2]+whi[2])/2);scene.add(flat);}
 // Original terrain trees (browser/trees.mjs): Unity 4 TreeRenderer semantics with the client's TerrainControl settings
 // (meshes for the nearest 60 within 214 m, squash cross-fade, runtime imposter billboards to 2000 m). The tree atlases
 // are m_WrapMode Repeat in the original (bark V runs to ~48 along the trunk), so they load with repeat wrapping.
 const placements=await json('trees.json'),treeModels=await Promise.all(manifest.models.map(m=>json(m.file)));
 const trees=await createTreeRenderer({renderer,scene,placements,models:treeModels,texture:name=>tex(name,false,true),materials:worldMaterials?.trees,settings:aerialMode?{treeDistance:3000,treeBillboardDistance:3000,treeCrossFadeLength:0,treeMaximumFullLODCount:12000}:treeSettings(manifest,{manual:convars.get('terrain.manual')}),wind:renderExtras,idleInterval:convars.get('terrain.idleinterval')}),vegetation=trees.vegetation;
 // Terrain trees are drawn by the Terrain (layer 19, in the reflection mask with water.reflection on).
 sea?.setReflected(trees.group);
 // GameEvent.QualitySettingsRefresh listeners (render.update() after any render.* set, the render.update command, level
 // load): WaterSettings (water quality / edge blend / reflection mask, water.level override), CameraSettings (CULL500
 // distance), and Application.targetFrameRate. water.level / water.reflection wait for the next refresh, as originally.
 renderRefresh=()=>{const w=waterRefresh(convars.get('render.level'),convars.get('water.level'),convars.get('water.reflection'));
  if(sea){sea.setQuality(w);if(!devMode)sea.setReflections(w.reflections);}
  layerCuller.setDistances(cameraLayerDistances(layerDepths,viewDistanceLayers,clamp01(convars.get('render.distance')),layerIndex));
  frameLimiter.target=convars.get('render.frames');};
 convars.addEventListener('set',e=>{if(['render.level','render.distance','render.frames','render.vsync'].includes(e.name))renderRefresh();});
 convars.addEventListener('change',e=>{if(e.name==='terrain.idleinterval')trees.setIdleInterval(e.value);});
 renderSettings.addEventListener('change',()=>renderRefresh()); // render.fov's setter also runs render.update()
 renderRefresh();
 const ground=(x,z)=>sampleTriangle(full,manifest.size,...worldToGrid(x,z,16000,manifest.size-1));
 // Original FPGrass GPU grass (browser/grass.mjs, tools/export_grass.py): follows grass.* convars and render.level (SoftVegetation).
 // Grass is off by default (owner decision), so its 8.6 MB of textures load only once grass.on is first set.
 let grass=null,grassLoad=null;
 const loadGrass=()=>grassLoad??=createGrass({renderer,base,heights:terrainLOD.texture,sampleHeight:(x,z)=>ground(x,-z),convars}).then(g=>{grass=g;scene.add(g.group);if(devMode)window.fpGrass=g;return g;}).catch(e=>{console.warn('Original grass not loaded:',e.message);return null;});
 if(convars.get('grass.on'))await loadGrass();else convars.addEventListener('change',e=>{if(e.name==='grass.on'&&convars.get('grass.on'))loadGrass();});
 const playerConfig=await json('player.json'),bobData=await json('headbob.json'),headBob=new HeadBob(bobData);let bobActive=false,bobFeet=null;
 const collisionWorld=await buildOriginalCollision(originalScene,ground,count=>{status.textContent=`Loading original collision · ${count} shapes…`;frontEnd?.loading('activating '+LEVEL_NAME,count,originalScene.manifest.colliders.length);});
 // physics.json (tools/export_physics.py): the controller layer's collision row, CCPusher door pushers, NavMeshObstacles.
 const physicsData=await json('physics.json').catch(()=>null);
 const motor=new LegacyMotor(playerConfig,collisionWorld,{collisionMask:physicsData?.player?.collisionMask});
 // Admin screenshots (browser/admin-capture.mjs): the gateway asks, the next rendered frame plus the HUD is sent back.
 const adminCapture=createAdminCapture({canvas:renderer.domElement,pose:()=>({feet:motor.feet.toArray(),yaw,pitch})});if(online)adminCapture.attach(online.client);
 // FallDamage.fIc is a transient server notification. Do not infer leg injury from an ordinary jump.
 online?.client.addEventListener('rpc',e=>{const r=e.detail;if(r.viewId===online.client.characterView&&r.name==='fIc'&&Number.isFinite(r.args?.values?.[0]))headBob.addEffect(bobData.bindings.fallbob);});
 let serverInventory=null;
 frontEnd?.loading('loading gui');
 // RPOS UIButtonSound/craftSound clips (rpos/layout.json `sounds`) play 2D on the listener like NGUITools.PlaySound.
 const rposSoundLog=[],rposSound=(file,volume,pitch)=>{rposSoundLog.push(file);if(rposSoundLog.length>20)rposSoundLog.shift();playLocal(file,volume,pitch,base+'rpos/');};
 const inventoryUI=await createInventoryUI(online?{inventoryFactory:c=>serverInventory=new ServerInventory(online,c),input:gameInput,playSound:rposSound}:{input:gameInput,playSound:rposSound});
 // Tab and the belt keys (inventory-ui.mjs setKeyGate): nothing polls before the controllable exists (controllable, set
 // with the game loop); HumanController.InputSample.Poll is default while the console, main menu, chat or a lock entry is
 // up; PollItemButtons also needs every cursor unlock node to allow the key subset (so no context popup and no death
 // screen either; RPOS's own node allows it). Typing in a text field never reaches GameInput.
 let controllable=false;const pollBlocked=()=>bootConsole.window.isVisible()||Boolean(frontEnd?.menuVisible())||Boolean(chat?.isOpen())||lockEntry.isOpen();
 inventoryUI.setKeyGate({inventory:()=>controllable&&!pollBlocked(),belt:()=>controllable&&!pollBlocked()&&playerVitals.alive&&!contextMenuOpen()});
 // LockEntry.OnEnable/OnDisable: its cursor unlock node on while shown; off again (the cursor relocks) when it hides. Held
 // keys stay held (GameButton.IsDown is Input.GetKey; InputSample.Poll is only default while it is up).
 const lockEntry=createLockEntryUI({onClose:()=>relock(),onOpen:()=>{fireHeld=fireClick=attack2=aimHeld=reloadHeld=false;devAttackUntil=0;pressAt=null;dragging=false;closeContextMenu();if(inventoryUI.isOpen())document.querySelector('#inventory').close();if(document.pointerLockElement)document.exitPointerLock();},popup:(text,icon,seconds)=>notice(text,'popup',{icon,seconds})});
 // Original HUD chat (chat.mjs): Return/T opens it while playing (HumanController.Poll); online lines go to the server as
 // "chat.say <quoted>" on ConsoleNetworker (view 997); the offline island is its own chat.say server.
 let chatReady=false;const localChat=online?null:createLocalChatServer({name:()=>frontEnd?.playerName?.()??LOCAL_PLAYER_NAME});
 const chat=await createChatUI({gameInput,canOpen:()=>chatReady&&playerVitals.alive&&!lockEntry.isOpen()&&!gameControls?.isOpen()&&!frontEnd?.menuVisible()&&(!online||online.state==='in-game'),
  send:command=>{if(online)online.client.rpc(997,'SV_RunConsoleCommand',[command]);else{const line=localChat(command);if(line)chat.consoleCommand(line);}},
  release:()=>gameControls?.release(),tryLock:()=>{if(navigator.userActivation&&!navigator.userActivation.isActive)return;gameControls?.capture();}}).catch(e=>{console.warn('ChatUI unavailable:',e.message);return null;});
 const inputBlocked=()=>inventoryUI.isOpen()||lockEntry.isOpen()||Boolean(gameControls?.isOpen())||Boolean(frontEnd?.menuVisible())||Boolean(chat?.isOpen()); // GameInput: no input while MainMenu.IsVisible() / ChatUI.IsVisible()
 // An unlock node turning off relocks the cursor (UnlockCursorNode.On = false / TryLock): RPOS closing (RPOS.SetRPOSModeNoChecks
 // -> unlocker.TryLock), LockEntry.OnDisable, DeathScreen.OutroAnimations (cursorLocker.On = false); the F1 console's is in
 // game-controls.mjs. A page may only lock with a recent user gesture; Escape is not one (and opens MainMenu anyway), and
 // capture() refuses while anything else keeps the cursor free.
 const relock=()=>{if(navigator.userActivation&&!navigator.userActivation.isActive)return false;if(!gameControls?.willCapture())return false;return gameControls.capture();};
 document.querySelector('#inventory').addEventListener('close',()=>{if(!inventoryUI.isOpen())relock();});
 const hud=await createHud();
 // RPOS use-hover text (use-hover.mjs); #use-hint stays as the accessible text.
 const useHover=await createUseHover().catch(e=>{console.warn('Use hover text unavailable:',e.message);return null;});if(useHover)document.body.classList.add('use-hover-native');let lastUseHover=null;
 serverInventory?.bindUI(inventoryUI);
 // Online belt keys: the client's own BeltUse gate before DoBeltUse (HeldItem.CanSetActivate(false) of the active item).
 if(serverInventory)serverInventory.canDeactivate=()=>canPutAway(resourceTime());
 // Original MovingDoors: rendering parts and colliders follow each door's displacement from its source pose.
 const clock=()=>Math.floor(performance.timeOrigin+performance.now());
 const doors=createDoors(originalScene.manifest),doorParts=doors.map(()=>[]);
 for(const container of originalScene.group.children)if(container.userData.door!==undefined)doorParts[container.userData.door].push(container);
 for(const [index,body] of collisionWorld.doorBodies)body.doorIndex=index;
 function applyDoor(door){for(const c of doorParts[door.index])c.matrix.multiplyMatrices(door.motion,c.userData.sourceMatrix);collisionWorld.doorBodies.get(door.index)?.setMotion(door.motion);door.changed=false;}
 doors.forEach(applyDoor);
 // CCPusher on the scene MovingDoors: the collider-to-world matrix is the door GameObject's current world matrix.
 collisionWorld.pushers=(physicsData?.ccPushers??[]).filter(p=>doors[p.door]).map(p=>({...p,matrix:()=>doors[p.door].world,body:collisionWorld.doorBodies.get(p.door)}));
 // SoundPool.Play defaults: linear rolloff; BasicDoor plays clips with volume 1, min 5 m, max 20 m.
 let listener=null;const audioLoader=new THREE.AudioLoader(),buffers=new Map();
 // sound.volume is AudioListener.volume: the listener's master gain scales every sound and the music (audio.mjs).
 function unlockAudio(){if(!listener){listener=new THREE.AudioListener();camera.add(listener);listener.setMasterVolume(audioSettings.master);audioSettings.onChange(()=>listener.setMasterVolume(audioSettings.master));}if(listener.context.state==='suspended')listener.context.resume().catch(()=>{});}
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,e=>{if(e.isTrusted)unlockAudio();},{capture:true});
 function playDoorSound(door,file){if(!listener||!file)return;if(!buffers.has(file))buffers.set(file,audioLoader.loadAsync(base+'scene/'+file));
  buffers.get(file).then(buffer=>{const sound=applyPanning(new THREE.PositionalAudio(listener));sound.setBuffer(buffer);sound.setDistanceModel('linear');sound.setRefDistance(5);sound.setMaxDistance(20);sound.setRolloffFactor(1);sound.position.setFromMatrixPosition(door.world);scene.add(sound);sound.onEnded=()=>{sound.disconnect();scene.remove(sound);};sound.play();}).catch(error=>console.warn(`Door sound unavailable: ${file}`,error));}
 for(const door of doors)door.onEvent(type=>playDoorSound(door,door.record.sounds?.[type]));
 // Looping positional AudioSource that follows an object until stopped (WorldArrow's flight sound; held reps' own sources,
 // where loop=false plays a one-shot clip once).
 function playLoop(file,object,min,max,pitch=1,volume=1,model='inverse',loop=true){let sound=null,stopped=false;const url=deployBase+file;if(!listener||!file)return ()=>{};if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));
  buffers.get(url).then(buffer=>{if(stopped)return;sound=applyPanning(new THREE.PositionalAudio(listener));sound.setBuffer(buffer);sound.setLoop(loop);sound.setVolume(volume);sound.setPlaybackRate(pitch);sound.setDistanceModel(model);sound.setRefDistance(min);sound.setMaxDistance(max);sound.setRolloffFactor(1);object.add(sound);sound.play();}).catch(()=>{});
  return ()=>{stopped=true;if(sound){if(sound.isPlaying)sound.stop();sound.disconnect();sound.removeFromParent();sound=null;}};}
 // SoundPool.Play (unity-audio.mjs): a world or attached sound is culled at start beyond max (Logarithmic: beyond 2 x max) by
 // its distance to the camera; a prefab's own AudioSource (pool:false) never is. parent: PlayLocal(transform, zero, ...), the
 // source follows that object while it plays. loop/life: a looping prefab source plays until its GameObject is destroyed
 // (life seconds), which also cuts a one-shot clip. Unity 4 pans in stereo (panLevel 1, spread 0): equal-power panner.
 function playFile(url,file,position,min,max,pitch=1,model='linear',volume=1,{parent=null,pool=true,loop=false,life=null}={}){if(!listener||!file)return;
  if(pool&&!soundPoolAudible(model,(parent?parent.getWorldPosition(new THREE.Vector3()):position).distanceTo(camera.position),max))return;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));
  buffers.get(url).then(buffer=>{const sound=applyPanning(new THREE.PositionalAudio(listener));sound.setBuffer(buffer);sound.setLoop(loop);sound.setPlaybackRate(pitch);sound.setVolume(volume);sound.setDistanceModel(model);sound.setRefDistance(min);sound.setMaxDistance(max);sound.setRolloffFactor(1);
   if(parent)parent.add(sound);else{sound.position.copy(position);scene.add(sound);}let ended=false;const end=()=>{if(ended)return;ended=true;if(sound.isPlaying)sound.stop();sound.disconnect();sound.removeFromParent();};sound.onEnded=end;sound.play();if(life!=null)setTimeout(end,life*1000);}).catch(()=>{});}
 // Original loot: 80 LootableObjectSpawners, four crate prefabs and recovered LootSpawnLists.
 frontEnd?.loading('loading shared');
 // ContextSprite use-icons (context-sprites.mjs): the ring on doors, crates, fires, boxes... within 5 m. The occlusion ray
 // uses layers Default/Static/Terrain only, so character, hitbox and debris bodies never block it.
 const spriteSkip=b=>Boolean(b&&(b.noCollide||(b.layer!=null&&!SPRITE.rayLayers.includes(b.layer))));
 const contextSprites=await createContextSprites({scene,renderer,raycast:(ray,range)=>collisionWorld.raycast(ray,range,spriteSkip)}).catch(e=>{console.warn('Context sprites unavailable:',e.message);return null;});
 // Scene doors: each ContextHint instance follows its door (MovingDoors); the door's own collider never hides it.
 {const spriteMaterials=new Set(Object.entries(originalScene.manifest.materials).filter(([,m])=>m.name===SPRITE.material).map(([k])=>k)),m=new THREE.Matrix4();
  for(const inst of originalScene.manifest.instances)if(inst.door!==undefined&&inst.materials.some(k=>spriteMaterials.has(k))){const door=doors[inst.door],source=new THREE.Matrix4().fromArray(inst.matrix);
   contextSprites?.addPoint({id:'door:'+door.index,matrix:()=>m.multiplyMatrices(door.motion,source),status:()=>doorStatus(door.busy),own:b=>b?.doorIndex===door.index});}}
 // Every download and texture the templates need was queued after the scene import (sharedAssets); the loop below still builds them one by one, in order.
 const lootManifest=await lootManifestLoad,lootAssets=(await sharedAssets).loot,crateTemplates=new Map();
 for(const [key,prefab] of Object.entries(lootManifest.prefabs)){const template=new THREE.Group();template.name=prefab.name;for(const r of prefab.renderers){const part=new THREE.Group();part.matrixAutoUpdate=false;part.matrix.fromArray(r.matrix);for(const mesh of await lootAssets.parts(r.mesh,r.materials,r.materials.map((_,i)=>i),null,r.name))part.add(mesh);if(part.children.length)template.add(part);if(contextSprites&&r.materials.some(k=>lootManifest.materials[k]?.name===SPRITE.material))template.add(contextSprites.anchor(r.matrix));}crateTemplates.set(key,template);}
 async function crateBody(crate){const body=new MovingBody(crate.prefab.name);for(const c of crate.prefab.colliders){const m=new THREE.Matrix4().fromArray(c.matrix);if(c.type==='BoxCollider')body.addBox(c.size,c.center,m);else{const md=lootManifest.meshes[c.mesh],positions=await lootAssets.binary(md.position,Float32Array);for(const part of md.parts)body.addGeometry(positions,await lootAssets.binary(part,Uint32Array),m);}}body.setMotion(crate.matrix);body.crate=crate;return body;}
 const lootTime=()=>performance.now()/1000;
 function openCrate(crate){if(!crate.useEnter('local',lootTime()))return;inventoryUI.openLoot({title:'Loot',get slots(){return crate.slots;}},()=>crate.useExit(lootTime()));}
 const loot=new LootSystem(lootManifest,inventoryUI.inventory.catalogue.items,(ray,range)=>collisionWorld.raycast(ray,range),{
  onSpawn(crate){const group=crateTemplates.get(crate.prefabKey).clone();group.matrixAutoUpdate=false;group.matrix.copy(crate.matrix);scene.add(group);contextSprites?.attach(group);crate.view={group,body:null};crate.target={kind:'crate',crate,contextText:()=>crate.contextText(),textPoint:()=>lootTextPoint(group,THREE.Vector3),use:()=>openCrate(crate)};crateBody(crate).then(body=>{if(crate.destroyed)return;crate.view.body=collisionWorld.addBody(body);});},
  onDestroy(crate){scene.remove(crate.view.group);if(crate.view.body)collisionWorld.removeBody(crate.view.body);},
  onEject(){inventoryUI.closeLoot();}});
 // Online the server spawns and fills the crates (ServerCrates below); local ones there would hold unmovable loot.
 if(!online)loot.start(lootTime());
 // Client TreeUnpack colliders ("Tree Collider"): solid trunks for walking and the source of tree wood.
 const resManifest=await resManifestLoad,resAssets=(await sharedAssets).res;
 {const tc=resManifest.treeColliders,trees=collisionWorld.addBody(new GridBody('Tree colliders',await resAssets.binary(tc.position,Float32Array),await resAssets.binary(tc.indices,Uint32Array)));trees.isTree=true;trees.layer=10;
  for(const c of tc.capsules){const b=new MovingBody('Tree capsule');b.addCapsule(c.radius,c.height,c.direction,c.center,new THREE.Matrix4().fromArray(c.matrix));b.setMotion(new THREE.Matrix4());b.isTree=true;collisionWorld.addBody(b);}}
 // Scene "RockSpawn" SlowSpawn: 8,344 rock and cliff MeshColliders spawned at run time (tools/export_rocks.py).
 await json('rockspawn/manifest.json').then(async m=>{const a=createAssetLoader(base+'rockspawn/',m);for(const b of await loadRockColliders(m,(d,T)=>a.binary(d,T)))collisionWorld.addBody(b);})
  .catch(e=>console.warn('Rock colliders unavailable:',e.message));
 // Original resource nodes from the 46 GenericSpawners; meshes follow ResourceObject's four depletion stages.
 const nodeVariants=new Map();
 for(const [key,p] of Object.entries(resManifest.prefabs)){const variants=[];for(const mesh of p.visualMeshes){const g=new THREE.Group();for(const m of await resAssets.parts(mesh,p.materials,p.materials.map((_,i)=>i),null,p.name))g.add(m);variants.push(g);}nodeVariants.set(key,variants);}
 async function nodeShapes(node,index){const md=resManifest.meshes[node.prefab.collisionMeshes[index]],positions=await resAssets.binary(md.position,Float32Array),shapes=[];for(const part of md.parts)shapes.push({positions,indices:await resAssets.binary(part,Uint32Array),matrix:new THREE.Matrix4()});return shapes;}
 function showNodeModel(node,index){node.view.group.clear();node.view.group.add(nodeVariants.get(node.prefab.ngcName)[index].clone());}
 // ResourceObject.modelindex (client side): clientMeshChangeEffect (Ore_Death / WoodPile_Death) at the node for 5 s,
 // except for the first index (_lastModelIndex -1) and at night when the local controllable is more than 20 m away.
 let lastResourceEffect=null;
 function resourceMeshChangeEffect(handle,matrix,lastIndex){const fx=deployManifest.resourceEffects?.[handle];if(!fx||lastIndex===-1)return null;
  const at=new THREE.Vector3(),q=new THREE.Quaternion();matrix.decompose(at,q,new THREE.Vector3());
  if(tod?.isNight&&walk&&playerVitals.alive&&motor.feet.distanceTo(at)>20)return null;
  showExplosion(unityOf(at),fx,{rotation:q,lifetime:5});lastResourceEffect={handle,effect:fx,at:unityOf(at).toArray(),time:resourceTime()};return fx;}
 const resourceTime=()=>performance.now()/1000;
 // Original island navmesh (tools/export_navmesh.py); optional, animals steer straight without it.
 const navmesh=await navmeshLoad.catch(e=>{console.warn('Navmesh unavailable:',e.message);return null;});
 const resources=new ResourceSystem(resManifest,(ray,range)=>collisionWorld.raycastTerrainOnly(ray,range),{
  onSpawn(node){const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.copy(node.matrix);scene.add(group);const body=new MovingBody(node.prefab.name);body.resourceNode=node;node.view={group,body};showNodeModel(node,node.modelIndex);node.shownModel=node.modelIndex;
   nodeShapes(node,node.modelIndex).then(shapes=>{if(node.destroyed)return;body.shapes=shapes;body.setMotion(node.matrix);collisionWorld.addBody(body);});},
  // The server swaps the collider at once; clients swap the visual mesh 0.15 s after the modelindex RPC.
  onModel(node,index){if(!node.view)return;nodeShapes(node,index).then(shapes=>{if(!node.destroyed)node.view.body.setShapes(shapes);});resourceMeshChangeEffect(';'+node.prefab.ngcName,node.matrix,node.shownModel??-1);
   setTimeout(()=>{if(!node.destroyed){showNodeModel(node,index);node.shownModel=index;}},150);},
  onDestroy(node){scene.remove(node.view.group);collisionWorld.removeBody(node.view.body);}});
 resources.navmesh=navmesh;
 if(!onlineJoin)resources.start(resourceTime()); // online, the server spawns resources and animals
 // Original wildlife (":" NetMainPrefab entries of the same GenericSpawners), simulated as the server did.
 const animalBase=base+'animals/',animalManifest=await animalManifestLoad,animalClips=await animalClipsLoad,animalAssets=(await sharedAssets).animals;
 const animalBuffers=new Map();
 function playAt(file,parent,volume,min,max){if(!listener)return;if(!animalBuffers.has(file))animalBuffers.set(file,audioLoader.loadAsync(animalBase+file));
  // BasicWildLifeAI.PlaySnd -> AudioClip.PlayLocal(transform, Vector3.zero, ...): the source is parented to the animal, so it
  // follows it while playing (a child of the view root at its origin; the root's matrix is rewritten every frame).
  animalBuffers.get(file).then(buffer=>{const s=applyPanning(new THREE.PositionalAudio(listener));s.setBuffer(buffer);s.setVolume(volume);s.setDistanceModel('linear');s.setRefDistance(Math.max(min,0.01));s.setMaxDistance(max);s.setRolloffFactor(1);parent.add(s);s.onEnded=()=>{s.disconnect();s.removeFromParent();};s.play();}).catch(()=>{});}
 const animalRenderer=await createAnimalRenderer(scene,animalManifest,animalClips,animalAssets,{playSound:playAt});
 const H=new THREE.Matrix4().makeScale(1,1,-1);
 function animalBodyMotion(a){return H.clone().multiply(new THREE.Matrix4().compose(a.position,a.rotation,new THREE.Vector3(1,1,1))).multiply(H);}
 // NavMeshObstacle cylinders (physics.json) for the agents' avoidance: placed structures/deployables/resource nodes by
 // prefab name, and doors only while closed (BasicDoor enables the obstacle on close, disables it once opened).
 let navObstacleList=[],navObstacleFrame=-1;const navCorner=new THREE.Vector3();
 function navObstacles(){if(navObstacleFrame===frames)return navObstacleList;navObstacleFrame=frames;const out=[],table=physicsData?.prefabObstacles??{};
  const add=(o,m)=>{navCorner.fromArray(o.local).applyMatrix4(m);const s=new THREE.Vector3().setFromMatrixScale(m);out.push({x:navCorner.x,y:navCorner.y,z:-navCorner.z,radius:o.radius*Math.max(o.scale[0]*s.x,o.scale[2]*s.z),height:o.height*o.scale[1]*s.y});};
  for(const b of collisionWorld.bodies){const list=table[b.surfacePrefab?.name??b.resourceNode?.prefab?.name];if(!list)continue;for(const o of list)if(o.enabled&&!o.door)add(o,b.motion);}
  for(const d of deployables.objects){if(!d.door)continue;const list=table[d.prefab?.name];if(list&&d.door.state===DoorState.Closed)for(const o of list)if(o.door)add(o,d.view?.body?.motion??d.matrix);}
  for(const o of physicsData?.doorObstacles??[]){const d=doors[o.door];if(d&&d.state===DoorState.Closed)add({...o,local:[0,0,0],scale:[1,1,1]},d.world);}
  return navObstacleList=out;}
 const wildlife=new WildlifeWorld({physics:Object.assign(wildlifePhysics(collisionWorld),{navmesh,navObstacles}),waterLine:originalScene.manifest.world?.waterLine??0,
  emit:(a,type,data)=>animalRenderer.event(a,type,data,resourceTime()),onRemove:a=>{if(a.body)collisionWorld.removeBody(a.body);},dropOnDeath:(a,key)=>dropHostileSack(a,key)});
 resources.spawnDynamic=(spawner,entry,position,rotation)=>{const key=entry.prefabName.slice(1),def=animalManifest.animals[key];if(!def)return null;
  const animal=wildlife.add(new Wildlife(wildlife,key,def,spawner,entry,position,rotation));
  if(!animal)return null;
  // Animal BoxCollider (layer 21): melee hits it; player movement does not collide with it.
  const c=def.collider,body=new MovingBody(def.name);body.addBox(c.size,[c.center[0],c.center[1],-c.center[2]],new THREE.Matrix4());body.animal=animal;body.noCollide=true;body.layer=def.layer;body.surfaceName=def.name;body.setMotion(animalBodyMotion(animal));animal.body=collisionWorld.addBody(body);return animal;};
 // Local player HumanBodyTakeDamage (recovered max health and bleed interval) and Metabolism (2 s ticks).
 const bodyData=playerConfig.takeDamage.data,metabolismTrait=playerConfig.traits.CharacterMetabolismTrait.data;
 let playerVitals=new HumanBody({maxHealth:bodyData._maxHealth,bleedInterval:bodyData._bleedInterval}),metabolism=new Metabolism({tickRate:metabolismTrait._tickRate}),vitalsLabel=document.querySelector('#vitals'),deathPanel=document.querySelector('#death');
 const playerTarget={character:true,get position(){return new THREE.Vector3(motor.feet.x,motor.feet.y,-motor.feet.z);},get alive(){return playerVitals.alive;},
  hurt(types,attacker){if(online||!walk)return {status:'IsAlive',amount:0};const t=resourceTime(),bleeding=playerVitals.bleedingLevel,r=playerVitals.hurtTyped(types,t);
   // HumanBodyTakeDamage.Hurt keeps the damage's attacker as bleedAttacker when it starts bleeding (spikes/explosions have no view).
   if(playerVitals.bleedingLevel>bleeding)bleedAttacker=attacker?.character?attacker:{unassigned:true};
   serverHurt(attacker?.character?attacker:null);metabolism.markDamageTime(t);
   // HumanBodyTakeDamage.Hurt: bullet/melee/explosion damage wears the worn armour (conditionloss.armorhealthmult).
   if(r.amount>0&&armorConditionLoss(inventoryUI.inventory,types,r.amount,{notice:(icon,text)=>notice(text,null,{icon}),drop:(slot,i)=>{try{droppedItems.toss(inventoryUI.inventory,i,unityOf(camera.position),unityOf(camera.getWorldDirection(new THREE.Vector3())));}catch(e){console.warn(e);}}}).length)inventoryUI.refresh();
   if(r.status==='WasKilled')playerDied(attacker);return r;}};
 // Offline the browser is both sides of ClientVitalsSync: the server's OnHurt (send on a rounded change) / OnRepair, and the
 // client's ClientHealthChange (combat-feedback.mjs: LocalDamageDisplay bob + overlays, HUDDirectionalDamage). Attackers:
 // null (no network view: spikes, explosions), {self:true} (HurtSelf: metabolism, falls, food, blood draw) or {character}.
 let combatFeedback=null,feedbackManifest=null,bleedAttacker,vitalsSender=new VitalsSender(),sentHealth=playerVitals.health,feedbackVitals=playerVitals,fallbackHealth=null;
 function serverHurt(attacker){sentHealth=playerVitals.health;if(vitalsSender.hurt(playerVitals.health))clientHealthChange(playerVitals.health,offlineAttacker(attacker));}
 function damageBob(before,after,melee=false){if(after<before&&after/playerVitals.maxHealth>=0.05)headBob.addEffect(bobData.bindings[melee?'meleeBob':'takeDamageBob']);}
 // Character attackers: eyesOrigin = _eyesTransform (exported eye offsets), Unity space in, browser space out.
 function characterEyes(name,positionU,rotationU){const e=new THREE.Vector3(...(feedbackManifest?.eyes?.[name]?.local??[0,0,0])).applyQuaternion(rotationU??new THREE.Quaternion()).add(positionU);return [e.x,e.y,-e.z];}
 function offlineAttacker(a){if(!a)return null;if(a.self)return {self:true};const c=a.character;return c?{eyes:characterEyes(c.def?.name,c.position,c.rotation),wildlife:Boolean(a.animal)}:null;}
 const victimPoints=()=>({eyes:camera.position.toArray(),origin:motor.feet.toArray()});
 // ClientVitalsSync.ClientHealthChange (amount = new absolute health) -> HeadBob effect.
 function clientHealthChange(health,attacker){let bob=null;if(combatFeedback)bob=combatFeedback.healthChange(health,attacker,victimPoints());else{damageBob(fallbackHealth??playerVitals.maxHealth,health,Boolean(attacker?.wildlife));fallbackHealth=health;}if(bob)headBob.addEffect(bobData.bindings[bob]);}
 // Metabolism/bleed self-damage also counts as being hurt (Metabolism.OnHurt) and can kill. DoBleed hurts as bleedAttacker
 // while that object still exists, else HurtSelf.
 function selfDamage(r,kind){const b=kind==='bleed'?bleedAttacker:null,a=b?(b.unassigned?null:b.character.destroyed?{self:true}:b):{self:true};
  serverHurt(a);metabolism.markDamageTime(resourceTime());if(r.status==='WasKilled')playerDied(null);}
 // Offline FallDamage: HumanController landing check + server FallDamage.FallImpact (fall-damage.mjs). Online the server
 // decides; its fIc RPC adds the fallbob above and legBreakSound for any character (world-audio block below).
 const fallTracker=new FallTracker();let legInjury=0,legInjuryUntil=0,fallTeleports=-1,lastFall=null;
 // Online the same landing rule sends FallDamage.fIm(lastFrameVelocity) to the server (SendFallImpact) and nothing else:
 // damage, bleeding and the leg injury come back as vitals, fIc and fIo.
 function fallFrame(){if(!walk||!playerVitals.alive||online&&online.state!=='in-game'){fallTracker.reset();return;}const t=resourceTime();
  if(online){if(motor.teleports!==fallTeleports){fallTeleports=motor.teleports;fallTracker.reset();}
   fallTracker.update(motor.grounded,motor.feet.y,motor.velocity.y,[motor.velocity.x,motor.velocity.y,-motor.velocity.z]);
   const message=fallImpactMessage(fallTracker.landingVelocity);if(message){online.client.rpc(online.client.characterView,'fIm',[message]);lastFall={sent:message,time:t};}return;}
  if(legInjury>0&&t>=legInjuryUntil)legInjury=0; // FallDamage.ClearInjury after ResetInjuryTime's delay
  if(motor.teleports!==fallTeleports){fallTeleports=motor.teleports;fallTracker.reset();}
  const speed=fallSpeed(fallTracker.update(motor.grounded,motor.feet.y,motor.velocity.y)??0);if(!speed)return;
  headBob.addEffect(bobData.bindings.fallbob);worldAudio?.fallImpact(motor.feet);const r=fallImpact(speed,{maxHealth:playerVitals.maxHealth,healthFraction:playerVitals.health/playerVitals.maxHealth});
  if(r.bleeding>0)playerVitals.setBleedingLevel(playerVitals.bleedingLevel+r.bleeding,t); // HumanBodyTakeDamage.AddBleedingLevel
  if(r.legInjury){legInjury+=1;legInjuryUntil=t+injuryDuration();} // AddLegInjury(1) -> ResetInjuryTime
  lastFall={speed,...r,time:t};selfDamage(hurtSelf(playerVitals,r.damage));}
 let playerDeaths=0;
 // DeathTransfer.Client_OnKilledShared (local): rposLimitFlags KeepOff|HideInventory|HideContext|HideSprites turn RPOS off
 // (loot windows close) and hide the belt/HUD, then DeathScreen.Show(). Offline also runs the server half: DeathTransfer.
 // SetDeathReason -> deathscreen.reason and DropHelper.DropInventoryContents (online the server sends/owns both).
 const deathScreen=createDeathScreen(),deathDrops=new Set();let openDeathDrop=null;
 // The local character's live PlayerAnimation input at death (DeathTransfer.CreateRagdoll links the animated pose):
 // state flags, the held representation's world group, the feet velocity (browser space).
 function localDeathPose(){let group=null;
  if(online){for(const h of online.held?.items.values()??[])if(h.parent===online.client.characterView)group=h.animationGroup??group;}
  else{const inv=inventoryUI.inventory,slot=inv.slots[inv.selected];group=slot?deployManifest.held?.[slot.item]?.animationGroup??null:null;}
  return {flags:localStateFlags(),group,velocity:motor.velocity.toArray()};}
 function playerDied(attacker=null){playerDeaths++;fireHeld=false;if(document.pointerLockElement)document.exitPointerLock();closeContextMenu();inventoryUI.setForceOff(true);document.body.classList.add('player-dead');
  // Offline ClientLocalDeath as online (main.mjs character rpc below): ragdoll with the worn armour, death camera.
  if(!online&&offlinePlayers){const armor=[39,38,37,36].map(index=>catalogue.items[inventoryUI.inventory.slots[index]?.item]?.data._uniqueID??0);
   offlinePlayers.localDeath({viewId:'offline'+playerDeaths,position:motor.feet.toArray(),rotation:[0,0,0,1],angles:{yaw,pitch},armor},resourceTime(),null,camera,localDeathPose());}
  if(!online){deathScreen.setReason(deathReason(attacker));dropDeathPack();inventoryUI.refresh();}
  deathScreen.show();}
 function deathAlive(){inventoryUI.setForceOff(false);document.body.classList.remove('player-dead');}
 // CharacterDeathDropPrefabTrait ";drop_lootsack" at GetGroundInfo under the character, LookRotationForcedUp(forward, normal).
 // Physics.Raycast down from a Unity-space origin against the world and terrain (GetGroundInfo for the sacks).
 const dropGround=(originU,range)=>{const ray=new THREE.Ray(browserOf(originU),new THREE.Vector3(0,-1,0)),exact=collisionWorld.raycast(ray,range,placeSkip),land=terrainRay(ray,range),hit=land&&(!exact||land.distance<exact.distance)?land:exact;return hit?{point:unityOf(hit.position),normal:unityOf(hit.normal)}:null;};
 function dropDeathPack(){const prefab=deployManifest.prefabs[DEATH_DROP_PREFAB],feetU=unityOf(motor.feet),forwardU=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw));
  const drop=dropInventoryContents(inventoryUI.inventory,prefab,{feetU,forwardU,ground:dropGround,now:lootTime()});return drop?placeDrop(drop,prefab,DEATH_DROP_PREFAB):null;}
 // HostileWildlifeAI.OnKilled (offline; online the server spawns the sack): the mutant wolf's or bear's
 // ";drop_lootsack_zombie" (AILootSack), filled from AILootList as it is created, 1.5 m from the body.
 function dropHostileSack(animal,key){const prefab=deployManifest.prefabs[key];if(online||!prefab)return null;
  // Wildlife positions and rotations are already Unity space (animalBodyMotion converts them with H).
  const items=inventoryUI.inventory.catalogue.items;
  const drop=hostileDeathDrop(prefab,{positionU:animal.position,forwardU:animal.forward,upU:new THREE.Vector3(0,1,0).applyQuaternion(animal.rotation),ground:dropGround,now:lootTime(),
   populate:(list,n)=>populateLoot(lootManifest.lists,list,n,items)});return drop?placeDrop(drop,prefab,key):null;}
 // A sack in the world: its original mesh, collision, the Search/Occupied context and the loot window.
 function placeDrop(drop,prefab,key){
  const group=deployTemplates.get(key)?.clone();if(group){group.matrixAutoUpdate=false;group.matrix.copy(drop.matrix);scene.add(group);contextSprites?.attach(group);}drop.view={group,body:null};
  drop.target={kind:'crate',crate:drop,contextText:()=>drop.contextText(),textPoint:()=>group?lootTextPoint(group,THREE.Vector3):null,use:()=>{if(!drop.useEnter('local',lootTime()))return;openDeathDrop=drop;inventoryUI.openLoot({title:'Loot',get slots(){return drop.slots;}},()=>{openDeathDrop=null;drop.useExit(lootTime());});}};
  drop.onDestroy=d=>{if(d.view.group)scene.remove(d.view.group);if(d.view.body)collisionWorld.removeBody(d.view.body);deathDrops.delete(d);if(openDeathDrop===d)inventoryUI.closeLoot();};
  prefabBody(prefab,drop.matrix,prefab.name).then(body=>{if(drop.destroyed)return;body.crate=drop;drop.view.body=collisionWorld.addBody(body);});deathDrops.add(drop);return drop;}
 // LootableObject DelayedDestroy / RadialCheck for death packs (second resolution is enough for 10 s / 600 s / 1800 s timers).
 setInterval(()=>{for(const d of [...deathDrops])if(d.update(lootTime(),walk?unityOf(motor.feet):null)==='eject'&&openDeathDrop===d)inventoryUI.closeLoot();},1000);
 // SpawnManager.GetRandomSpawn: a random original spawn point, randomised 10 m, scanned down from 2,000 m above.
 // DeathScreen.RequestRespawn_InCamp: the newest valid sleeping bag (or bed), else a random spawn as the server falls back.
 function respawn(useCamp=false){const camp=useCamp?deployables.campSpawn(resourceTime()):null;let spot;
  // SpawnPlayer -> Character.SummonCharacter(pos, rot): the new character looks level along the spawn rotation
  // (spawn point or DeployedRespawn.GetSpawnRot), net-client.mjs spawnLook.
  let rotationU;
  if(camp){spot=new THREE.Vector3(camp.position.x,camp.position.y,-camp.position.z);rotationU=camp.rotation;if(!camp.object.bed)setTimeout(()=>notice('You will not be able to spawn near here for 4 Minutes.'),0);}
  else {const points=originalScene.manifest.world.spawnPoints,point=points[Math.floor(Math.random()*points.length)],p=point.position;let x,z;do{x=Math.random()*2-1;z=Math.random()*2-1;}while(x*x+z*z>1);
  rotationU=new THREE.Quaternion();if(point.matrix)new THREE.Matrix4().fromArray(point.matrix).decompose(new THREE.Vector3(),rotationU,new THREE.Vector3());
  const start=new THREE.Vector3(p[0]+x*10,p[1]+2000,p[2]+z*10),hit=collisionWorld.raycast(new THREE.Ray(start,new THREE.Vector3(0,-1,0)),2500);
  spot=hit?hit.position.clone().add(new THREE.Vector3(0,hit.normal.y*0.25,0)):new THREE.Vector3(start.x,ground(start.x,start.z),start.z);}
  offlinePlayers?.resetDeathCamera(camera);playerVitals=new HumanBody({maxHealth:bodyData._maxHealth,bleedInterval:bodyData._bleedInterval});legInjury=0;metabolism=new Metabolism({tickRate:metabolismTrait._tickRate});inventoryUI.inventory.respawn();deathAlive();inventoryUI.refresh();walk=true;motor.teleport(spot);camera.position.copy(motor.cameraPosition());({yaw,pitch}=spawnLook([rotationU.x,rotationU.y,rotationU.z,rotationU.w]));deathScreen.outro();document.querySelector('#mode').textContent='Enter fly mode';}
 // DeathScreen.RequestRespawn / RequestRespawn_InCamp (dfEventBindings on btnRespawn / btnAtCamp): OutroAnimations, then the RPC.
 const requestRespawn=camp=>{if(!online){respawn(camp);relock();return;}if(online.respawn(camp))deathScreen.outro();};
 document.querySelector('#respawn').onclick=()=>requestRespawn(false);document.querySelector('#respawn-camp').onclick=()=>requestRespawn(true);
 // Original deployables: placement preview, DoAction1 placement, and the placed objects' behaviour.
 const deployBase=base+'deployables/',deployManifest=await deployManifestLoad,deployAssets=(await sharedAssets).deploy,deployTemplates=new Map();
 // Original placement preview (tools/export_placement.py): overrideMat (Custom/OutlineHover) + aim gizmo; null without the export.
 const placementBase=base+'placement/',placementManifest=await json('placement/manifest.json').catch(e=>{console.warn('Placement preview export missing:',e.message);return null;});
 // Draw sounds and the explosion flash (tools/export_presentation_extras.py); without the export: no draw sounds, old flash.
 const presentationBase=base+'presentation/',presentationManifest=await json('presentation/manifest.json').catch(e=>{console.warn('Presentation extras export missing:',e.message);return null;});
 const placementPreview=placementManifest?createPlacementPreview(placementManifest,{loader:createAssetLoader(placementBase,placementManifest),scene,cullingMask:qualityManifest?.camera?.cullingMask??null,
  texture:slot=>loadRecovered(placementBase+slot.file).then(t=>{t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;setFlipY(t,true);return registerTexture(t,slot.file);})}):null;
 // Effect extras (tools/export_fx.py): LightStylist/LightStyle, legacy flare particles, debris meshes, barrel-aim fields, WindZone.
 const fx=await createFxAssets(base,await json('fx/manifest.json').catch(()=>null),{deployManifest,deployBase}),fxTextureCache=new Map();
 const fxLegacyTexture=file=>{if(!file)return null;if(!fxTextureCache.has(file)){const t=new THREE.TextureLoader().load(base+'fx/'+file);t.colorSpace=THREE.SRGBColorSpace;fxTextureCache.set(file,t);}return fxTextureCache.get(file);};
 for(const [key,p] of Object.entries(deployManifest.prefabs)){const g=new THREE.Group();g.name=p.name;for(const r of templateRenderers(p)){const part=new THREE.Group();part.userData.armorSlot=r.armorSlot;part.matrixAutoUpdate=false;part.matrix.fromArray(r.matrix);for(const m of await deployAssets.parts(r.mesh,r.materials,r.materials.map((_,i)=>i),null,r.name))part.add(m);if(part.children.length)g.add(part);}
  if(contextSprites)for(const c of p.components.ContextSprite??[]){const r=p.renderers.find(r=>r.node===c.node);if(r)g.add(contextSprites.anchor(r.matrix));}deployTemplates.set(key,g);}
 const physicsEngine=await rapierLoad;
 // Offline thrown grenades, supply signals and flares are Rapier rigid bodies in the recovered PhysicsManager settings.
 const thrownPhysics={engine:physicsEngine,world:collisionWorld,physics:await json('players/ragdoll.json').then(r=>r.physics).catch(e=>{console.warn('PhysicsManager settings missing:',e.message);return null;})};
 // Offline the page's own character dies like the online one (DeathTransfer.ClientLocalDeath -> DeathRagdoll): the
 // MaleRagdoll corpse for 80 s and the camera on a temporary mount at its head. Online uses online.playerRenderer.
 let offlinePlayers=null;
 if(!online)Promise.all([json('players/manifest.json'),json('players/ragdoll.json')]).then(async([pm,ragdollData])=>{const pc=await loadClips(base+'players/'+pm.clipsFile);
  offlinePlayers=await createPlayerRenderer(scene,pm,pc,createAssetLoader(base+'players/',pm),{collisionWorld,heldManifest:deployManifest,heldTemplates:deployTemplates,ragdollData,physicsEngine});}).catch(e=>console.warn('Offline death ragdoll unavailable:',e.message));
 const characterRenderer=()=>online?.playerRenderer??offlinePlayers;
 // The tags callers put on a prefab body after it is built; its companions read them from it.
 const BODY_TAGS=['structure','deployed','crate','pickup','online','worldObject','onlineRoot','onlineDamage','onlineTarget','cosmeticRigid'];
 async function prefabBody(p,matrix,name){
  // The body holds only solid colliders, so it takes their layer when they share one. Spike walls keep a layer-26
  // trigger on the root and the solid box on layer 10; using the root layer let bullets and placement pass through.
  // Every query filters by a body's layer, so solid colliders on another layer get a companion body of that layer
  // (collision.mjs solidLayerGroups; it is added, removed and moved with this one). MetalBarsWindow: the layer-20 bars
  // mesh plus its "playercol" BoxCollider (2 x 2.5 x 0.3) on layer 29 PlayerClip, which the layer collision matrix lets
  // collide only with 16 (Character Collision): it stops the player motor but not bullets, arrows and melee (mask
  // 406721553 has no bit 29), grenades (row 18) or ragdolls (row 27).
  const {main,groups,layers}=solidLayerGroups(p.colliders,p.nodes[0].layer);
  const make=layer=>{const b=new MovingBody(name);b.surfacePrefab=p;b.surfaceName=p.name;b.layer=layer;b.solidLayers=layers.length?[layer]:[];return b;};
  const body=make(main),byLayer=new Map([[main,body]]);
  for(const c of [...groups.values()].flat()){let b=byLayer.get(c.layer);if(!b){b=make(c.layer);b.companionOf=body;for(const k of BODY_TAGS)Object.defineProperty(b,k,{get:()=>body[k],set:v=>{body[k]=v;},configurable:true});byLayer.set(c.layer,b);}
   const m=new THREE.Matrix4().fromArray(c.matrix);
   if(c.type==='BoxCollider')b.addBox(c.size,c.center,m);else if(c.type==='CapsuleCollider')b.addCapsule(c.radius,c.height,c.direction,c.center,m);else if(c.type==='SphereCollider')b.addCapsule(c.radius,2*c.radius,1,c.center,m);
   else if(c.type==='MeshCollider'){const md=deployManifest.meshes[c.mesh],pos=await deployAssets.binary(md.position,Float32Array);for(const part of md.parts)b.addGeometry(pos,await deployAssets.binary(part,Uint32Array),m);}}
  body.companions=[...byLayer.values()].filter(b=>b!==body);body.setMotion(matrix);return body;}
 const unityOf=v=>new THREE.Vector3(v.x,v.y,-v.z),browserOf=unityOf;
 const droppedItems=online?null:new DroppedItems({engine:physicsEngine,manifest:deployManifest,world:collisionWorld,items:inventoryUI.inventory.catalogue.items,now:resourceTime,
  onAdd:o=>{o.group=prefabGroup(deployManifest.pickup);o.group.matrix.copy(o.matrix);prefabBody(deployManifest.prefabs[deployManifest.pickup],o.matrix,'GenericItemPickup').then(body=>{if(!droppedItems.objects.has(o))return;o.body=collisionWorld.addBody(body);body.cosmeticRigid=true;body.pickup={object:o,target:{kind:'pickup',contextText:()=>droppedItems.text(o),use:()=>{droppedItems.take(o,inventoryUI.inventory);inventoryUI.refresh();}}};});},
  onPose:o=>{o.group.matrix.copy(o.matrix);o.group.matrixWorldNeedsUpdate=true;o.body?.setMotion(o.matrix);},onRemove:o=>{scene.remove(o.group);if(o.body)collisionWorld.removeBody(o.body);}});
 inventoryUI.setToss(index=>{if(online)return serverInventory.toss(index);const direction=unityOf(camera.getWorldDirection(new THREE.Vector3()));return droppedItems.toss(inventoryUI.inventory,index,unityOf(camera.position),direction);});
 // Airdrops (browser/airdrops.mjs): C130 + SupplyCrate presentation from server snapshots online; offline the page runs the
 // server half (SupplyDropTimer, drop zones, SupplyDropPlane, crate physics/KillZone/loot). Assets: tools/export_airdrop.py.
 const airdropManifest=await airdropManifestLoad.catch(e=>{console.warn('Airdrops unavailable:',e.message);return null;});
 const airdropActors=airdropManifest?new AirdropActors({manifest:airdropManifest}):null;let openAirdrop=null;
 const airdropRenderer=airdropManifest?await createAirdropRenderer({scene,manifest:airdropManifest,base:base+'airdrop/',assets:(await sharedAssets).airdrop,collisionWorld,MovingBody,camera,listener:()=>listener}):null;
 const offlineAirdrops=airdropManifest&&!online?new OfflineAirdrops({manifest:airdropManifest,lootManifest,items:inventoryUI.inventory.catalogue.items,engine:physicsEngine,actors:airdropActors,now:resourceTime,
  environment:p=>ragdollEnvironment(collisionWorld,new THREE.Vector3(p.x,p.y,-p.z)),hour:()=>tod?.hour??null,
  player:()=>walk&&playerVitals.alive?{feet:unityOf(motor.feet),height:motor.height,radius:motor.radius,alive:true}:null,
  // KillZone: TakeDamage.Kill by the crate; DeathTransfer.SetDeathReason has no case for a non-character attacker.
  onCrush:()=>{if(!walk||!playerVitals.alive)return;playerVitals.health=0;playerDied(null);deathScreen.setReason('TODO: Handle this death condition SupplyCrate(Clone) (SupplyCrate)');},
  ui:{open:(c,onClose)=>{openAirdrop=c;inventoryUI.openLoot({title:'Loot',get slots(){return c.slots;}},()=>{openAirdrop=null;onClose();});},close:c=>{if(openAirdrop===c){openAirdrop=null;inventoryUI.closeLoot();}}}}):null;
 function airdropFrame(dt){if(!airdropActors)return;offlineAirdrops?.update();const t=offlineAirdrops?offlineAirdrops.time():resourceTime(),landed=airdropActors.frame(t,dt);airdropRenderer?.frame(airdropActors,landed,t,dt);}
 // FireBarrel.fireLight and emitters: the prefab's Shuriken systems run while the fire burns.
 const fxTextures=new Map(),fxTexture=file=>{if(!file)return null;if(!fxTextures.has(file)){const t=new THREE.TextureLoader().load(deployBase+file);t.colorSpace=THREE.SRGBColorSpace;fxTextures.set(file,t);}return fxTextures.get(file);};
 function fireEffects(p){const out=[];for(const ps of p.components.ParticleSystem??[]){if(!p.nodes[ps.node].active)continue;const r=(p.components.ParticleSystemRenderer??[]).find(x=>x.node===ps.node);if(!r?.enabled)continue;
  // FX/HeatDistort: its only shipped user (Campfire "refract") is an inactive GameObject, skipped above like every inactive node.
  const mat=deployManifest.materials[r.materials[0]];if(!mat)continue;const e=Object.assign(new ParticleEffect(ps.data,r,mat,fxTexture(mat.textures?._MainTex?.file??mat.texture),new THREE.Matrix4().fromArray(p.nodes[ps.node].matrix),Math.random,fx.effectOptions(p,ps.node,r)),{id:ps.id??null});
  e.lighting=fx.lighting;e.wind=fx.wind;out.push(e);}return linkSubEmitters(out);}
 const muzzleFlashes=new MuzzleFlashes(deployManifest,scene,fireEffects);
 function attachFireEffects(o){o.view.effects=fireEffects(o.prefab);for(const e of o.view.effects)scene.add(e.mesh);const L=o.prefab.components.Light?.[0];if(L){o.view.light=L.data;
  // LightStylist (torches) or FireBarrel's flicker (campfire, furnace) sets the light intensity every frame.
  o.view.lightDriver=lightDriver({fx:fx.manifest,prefabKey:o.prefab.ngcName,lightNode:L.node,lightData:L.data,fireBarrel:Boolean(o.prefab.components.FireBarrel),startTime:fx.time});o.view.lightPosition=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(o.matrix,new THREE.Matrix4().fromArray(o.prefab.nodes[L.node].matrix)));}}
 function disposeFireEffects(view){for(const e of view?.effects??[]){scene.remove(e.mesh);e.dispose();}if(view?.audio){if(view.audio.isPlaying)view.audio.stop();scene.remove(view.audio);view.audio=null;}}
 // A small pool of point lights, kept in the scene so lighting a fire does not recompile materials.
 const fireLights=Array.from({length:4},()=>{const l=new THREE.PointLight(0xffffff,0,20,1);scene.add(l);return l;});
 const heldFires=new Map(),worldFlares=[];
 function updateHeldFires(){const live=new Set();for(const [parent,v]of online?.playerRenderer?.views??[])for(const h of v.reps?.values()??[]){if(!h?.lit)continue;const key=deployManifest.weapons[h.key]?.prefabs?.ThirdPersonLightPrefab,p=deployManifest.prefabs[key],m=online.playerRenderer.heldMuzzle(parent,h.rep);if(!p||!m)continue;m.multiply(new THREE.Matrix4().makeScale(p.rootScale.x,p.rootScale.y,p.rootScale.z));live.add(h.rep);
   // Per representation: an old torch stays lit on the character until its InterpDestroy (server-held.mjs).
   let o=heldFires.get(h.rep);if(!o){o={parent,rep:h.rep,prefab:p,matrix:m,view:{},fire:{isOn:true}};attachFireEffects(o);heldFires.set(h.rep,o);}else o.matrix.copy(m);
   const L=p.components.Light?.[0];if(L)o.view.lightPosition.setFromMatrixPosition(o.matrix.clone().multiply(new THREE.Matrix4().fromArray(p.nodes[L.node].matrix)));if(o.view.audio)o.view.audio.position.setFromMatrixPosition(o.matrix);}
  for(const [rep,o]of heldFires)if(!live.has(rep)){disposeFireEffects(o.view);heldFires.delete(rep);}}
 // Held representations' own AudioSources (unity-audio.mjs heldRepSounds; only uhatchet.irp ships one: the Uber Hatchet's
 // drum loop, Logarithmic 1..100 m at 0.577). Other players' reps play from their hand socket while attached; the holder's
 // own rep (online: the owner's ItemRepresentation until its network destroy; offline: the equipped item) from the hidden
 // rig's itemAttachment (player-view heldRig). Each starts with its rep and stops when the rep goes.
 const heldRepAudio=new Map(),ownRepNode=new THREE.Object3D();ownRepNode.matrixAutoUpdate=false;scene.add(ownRepNode);let ownRepRig=null,lastHeldRepSounds=[];
 function updateHeldRepAudio(dt){
  const remote=[];if(online&&online.state!=='closed')for(const v of online.playerRenderer?.views.values()??[])if(v.held?.root?.parent)remote.push({rep:v.held.rep,prefab:v.held.prefab,root:v.held.root});
  let own=null;
  if(online){if(online.state!=='closed')for(const h of online.held?.items.values()??[])if(h.parent===online.client.characterView&&online.client.views.has(h.rep)){own=h;break;}}
  else{const inv=inventoryUI.inventory,slot=walk&&playerVitals.alive?inv.slots[inv.selected]:null,h=slot&&deployManifest.held?.[slot.item];if(h)own={...h,rep:slot};}
  const sounds=heldRepSounds(deployManifest.prefabs,{remote,own}),players=online?online.playerRenderer:offlinePlayers;
  for(const s of sounds.values())if(s.local){if(ownRepRig?.prefab!==s.prefab)ownRepRig=players?.heldRig(s)??null;if(!ownRepRig){sounds.delete(s.rep);continue;}
   ownRepNode.matrix.copy(ownRepRig.update({feet:motor.feet.toArray(),yaw,pitch,flags:localStateFlags(),velocity:motor.velocity.toArray()},dt,resourceTime()));ownRepNode.matrixWorldNeedsUpdate=true;}
  for(const [rep,a]of heldRepAudio){const s=sounds.get(rep);if(!s||(s.local?ownRepNode:s.root)!==a.parent){a.stop();heldRepAudio.delete(rep);}}
  if(listener)for(const [rep,s]of sounds)if(!heldRepAudio.has(rep)){const c=s.source,parent=s.local?ownRepNode:s.root;heldRepAudio.set(rep,{parent,stop:playLoop(c.clip,parent,c.min,c.max,c.pitch,c.volume,c.model,c.loop)});}
  lastHeldRepSounds=[...sounds.values()].map(s=>({rep:s.local&&!online?'offline':s.rep,local:s.local,clip:s.source.clip,loop:s.source.loop,started:heldRepAudio.has(s.rep),position:new THREE.Vector3().setFromMatrixPosition((s.local?ownRepNode:s.root).matrixWorld).toArray()}));
 }
 function updateFireEffects(dt){const lit=[];fx.tick(dt);
  // VertexLit / Lit Colored particles: RenderSettings ambient, the sun or moon light and the pooled point lights.
  fx.updateLighting({ambient:hemi,directional:[sun],points:[...fireLights,torchWorldLight,muzzleFlashes.worldLight,...explosionLights.map(e=>e.light),...impactLights]});
  updateHeldFires();for(const o of [...deployables.objects,...(online?.worldObjects?.values()??[]),...heldFires.values(),...worldFlares]){if(!o.view?.effects)continue;for(const e of o.view.effects)e.update(dt,o.fire.isOn,o.matrix,camera);if(o.view.lightDriver)o.view.lightIntensity=o.view.lightDriver.intensity(dt,fx.time,o.fire.isOn);if(o.fire.isOn&&o.view.light)lit.push(o);
   // The light/fire prefab's own AudioSource with its rolloffMode and m_Volume: FlareLight3p (other players' held and thrown
   // flares) linear 3..20 m at 0.5, Campfire/Furnace logarithmic 1..500 m.
   const src=o.prefab.components.AudioSource?.[0];if(src?.clip&&listener){if(o.fire.isOn&&!o.view.audio){const a=applyPanning(new THREE.PositionalAudio(listener));a.setLoop(true);a.setDistanceModel(sourceDistanceModel(src.data.rolloffMode));a.setRolloffFactor(1);a.setRefDistance(src.data.MinDistance??1);a.setMaxDistance(src.data.MaxDistance??500);a.setVolume(src.data.m_Volume??1);a.setPlaybackRate(src.data.m_Pitch??1);a.position.setFromMatrixPosition(o.matrix);scene.add(a);o.view.audio=a;
     const url=deployBase+src.clip;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));buffers.get(url).then(b=>{if(o.view.audio===a&&o.fire.isOn){a.setBuffer(b);a.play();}}).catch(()=>{});}
    else if(!o.fire.isOn&&o.view.audio){if(o.view.audio.isPlaying)o.view.audio.stop();scene.remove(o.view.audio);o.view.audio=null;}}}
  lit.sort((a,b)=>a.view.lightPosition.distanceToSquared(camera.position)-b.view.lightPosition.distanceToSquared(camera.position));
  fireLights.forEach((l,i)=>{const o=lit[i];if(!o){l.intensity=0;return;}const d=o.view.light;l.color.setRGB(d.m_Color.r,d.m_Color.g,d.m_Color.b);l.distance=d.m_Range;l.position.copy(o.view.lightPosition);
   l.intensity=(o.view.lightIntensity??d.m_Intensity)*6;});}
 const deployables=new DeployableSystem(deployManifest,inventoryUI.inventory.catalogue.items,{now:resourceTime,
  onAdd(o){const group=deployTemplates.get(o.entry.prefab).clone();group.matrixAutoUpdate=false;group.matrix.copy(o.matrix);scene.add(group);o.view={group,body:null};contextSprites?.attach(group,{status:()=>o.door?doorStatus(o.door.busy):null});
   if(o.fire)attachFireEffects(o);o.target=deployTarget(o);
   // Deployable doors run the same MovingDoor port as the scene doors, rooted at the placement.
   if(o.kind==='door'){const md=o.prefab.components.MovingDoor[0];o.door=deployableDoor(o.prefab,o.position,o.rotation);
    const lockContext=()=>({lock:o.lock,isOwner:o.ownerId==='local',open:o.door.target===1,userId:'local'});
    o.door.onEvent(type=>playFile(deployBase+(md.sounds?.[type]??''),md.sounds?.[type],new THREE.Vector3().setFromMatrixPosition(o.matrix),5,20));o.target={kind:'deployable',deployed:o,contextText:()=>o.door.contextText(),textPoint:()=>doorTextPoint(o.door,THREE.Vector3),use:(eyes,ms)=>{if(!canToggleDoor(lockContext()))return notice(LOCKED_MESSAGE);rules.touched(o,resourceTime());return o.door.use(eyes,ms??clock());},menu:()=>doorMenu(lockContext()),menuAction:action=>{
     if(action==='Open'||action==='Close')return (action==='Open')===o.door.on?false:o.target.use(camera.position,clock());
     if(action==='Change Lock'||action==='Enter Code')return lockEntry.show(action==='Change Lock',(code,changing)=>{if(o.destroyed)return;const result=enterCode({...lockContext(),code,changing,time:resourceTime()});if(result.message)notice(result.message);});
     if(lockContext().isOwner&&o.lock&&(action==='Lock'||action==='Unlock'))notice(setLockActive(o.lock,action==='Lock'));}};}
   prefabBody(o.prefab,o.matrix,o.prefab.name).then(body=>{if(o.destroyed)return;body.deployed=o;o.view.body=collisionWorld.addBody(body);});},
  onRemove(o){scene.remove(o.view.group);disposeFireEffects(o.view);if(o.view.body)collisionWorld.removeBody(o.view.body);if(inventoryUI.lootOpen()&&openDeployed===o)inventoryUI.closeLoot();}});
 const campfireLabels=['Cooked','Cooked','Cooked','Raw','Raw','Raw','Fuel','Debris'];let openDeployed=null,openRadial=null;
 // RPOSRepairBenchWindow.RepairButtonClicked → RepairBench.DoRepair: the button (shown only for a damaged repairable item,
 // inventory-ui) always sends; CompleteRepair answers "Repaired Item!" or "could not repair item".
 function openContainer(o){openDeployed=o;openRadial=new RadialCheck(lootTime());inventoryUI.openLoot({title:o.prefab.name,layout:o.kind==='campfire'?'fire':o.kind==='repairbench'?'repair':null,get slots(){return o.slots;},accepts:o.kind==='campfire'?(i,d)=>o.fire.accepts(i,d):null,labels:o.kind==='campfire'?campfireLabels:null,action:o.kind==='repairbench'?{label:'Repair',run:()=>notice(completeRepair(o.slots[0],inventoryUI.inventory.catalogue,inventoryUI.inventory).message)}:null},()=>{openDeployed=null;openRadial=null;});}
 // LootableObject RadialCheck for placed boxes, stashes, fires, furnaces and repair benches (as crates and death packs).
 setInterval(()=>{if(openDeployed&&openRadial?.due(lootTime(),walk?unityOf(motor.feet):null,openDeployed.position))inventoryUI.closeLoot();},250);
 function deployTarget(o){const now=()=>resourceTime();
  // LootableObject.ContextText: "Search" (the local player's own window hides the label, so never "Occupied" here).
  if(o.kind==='storage'||o.kind==='repairbench')return {kind:'deployable',deployed:o,contextText:()=>lootContextText(null),textPoint:()=>lootTextPoint(o.view.group,THREE.Vector3),use:()=>openContainer(o)};
  // FireBarrel: quick use toggles the fire (or opens when unfuelled); the held menu offers Ignite/Extinguish/Open.
  // FireBarrel.ContextText is "Use" (Ignite/Extinguish/Open are the held menu's options).
  if(o.fire)return {kind:'deployable',deployed:o,contextText:()=>fireContextText(null),textPoint:()=>spriteTextPoint(o.view.group,THREE.Vector3),use:()=>{if(o.fire.quick(now())==='open')openContainer(o);},menu:()=>o.fire.menu(),
   menuAction:a=>{if(a==='Open')openContainer(o);else if(a==='Ignite')o.fire.trySetOn(true,now());else if(a==='Extinguish')o.fire.setOn(false,now());}};
  // SleepingBag.PlayerUse: picking up returns the item once the respawn cooldown has passed.
  // Only SleepingBag is contextual: a Bed (DeployedRespawn without Contextual) shows no text and cannot be used.
  // SleepingBag.ContextText: "Pick Up" for its creator, otherwise empty.
  if(o.kind==='respawn'&&!o.prefab.components.SleepingBag)return null;
  if(o.kind==='respawn')return {kind:'deployable',deployed:o,contextText:()=>o.ownerId==='local'?'Pick Up':'',textPoint:()=>spriteTextPoint(o.view.group,THREE.Vector3),use:()=>{const t=now();if(!o.canSpawn(t)){notice(`Wait ${o.cooldown(t).toFixed(0)} seconds`);return;}
   const items=inventoryUI.inventory.catalogue.items,key=Object.keys(items).find(k=>items[k].data.m_Name===o.giveItemName)??o.itemKey;
   if(inventoryUI.inventory.add(key,1)===1)notice('Your inventory is full');else {o.destroy();inventoryUI.refresh();}}};
  return null;}
 // Physics adapter for placement. Wildlife (layer 21) and trigger volumes are outside the original placement mask.
 const placeSkip=b=>Boolean(b&&(b.animal||b.onlineAnimal||b.layer===21||b.layer===26));
 function maskSkip(mask){return b=>{const layer=b===null?0:(b.layer??0);return Boolean(b?.animal)||!((mask>>>layer)&1);};}
 // The island terrain is a heightfield outside the octree: march the ray, then bisect the crossing.
 function terrainRay(ray,range){let prev=0;const p=new THREE.Vector3();const below=t=>{p.copy(ray.origin).addScaledVector(ray.direction,t);return p.y<ground(p.x,p.z);};if(below(0))return null;
  for(let t=0.25;t<=range+0.25;t+=0.25){const tt=Math.min(t,range);if(below(tt)){let a=prev,b=tt;for(let i=0;i<20;i++){const m=(a+b)/2;if(below(m))b=m;else a=m;}p.copy(ray.origin).addScaledVector(ray.direction,b);return {position:p.clone(),normal:collisionWorld.terrainNormal(p.x,p.z),distance:b,body:null,terrain:true};}prev=tt;if(tt===range)break;}return null;}
 const noPlacementZones=(originalScene.manifest.world.noPlacementZones??[]).map(z=>({position:unityOf(new THREE.Vector3(...z.position)),radius:z.radius}));
 // FitRequirements.Test: conditions are in prefab-local space (flt0/flt2 points, flt1 direction, .a distance/radius).
 function fitTest(fr,posU,rotU,scale){const m=new THREE.Matrix4().compose(posU,rotU,new THREE.Vector3(scale.x,scale.y,scale.z)),lin=new THREE.Matrix3().setFromMatrix4(m);
  const P=v=>browserOf(new THREE.Vector3(v.r,v.g,v.b).applyMatrix4(m)),V=v=>new THREE.Vector3(v.r,v.g,v.b).applyMatrix3(lin);
  for(const c of fr.conditions){const skip=maskSkip(c.mask);let hit=false;
   if(c.instruction<=2){const d=V(c.flt1),mag=d.length()/Math.max(1e-9,new THREE.Vector3(c.flt1.r,c.flt1.g,c.flt1.b).length()),dir=browserOf(d).normalize(),dist=mag*c.flt0.a;
    if(c.instruction===0)hit=Boolean(collisionWorld.raycast(new THREE.Ray(P(c.flt0),dir),dist,skip));
    else {const starts=c.instruction===1?[P(c.flt0)]:[P(c.flt0),P(c.flt2),P(c.flt0).add(P(c.flt2)).multiplyScalar(0.5)];
     // CapsuleCast approximated by sphere casts from both capsule ends and the middle.
     for(const p of starts)if(collisionWorld.sphereCast(new THREE.Ray(p,dir),mag*c.flt1.a,dist+mag*c.flt1.a,skip)){hit=true;break;}}}
   else {const r=scale.x*c.flt1.a;
    if(c.instruction===3)hit=Boolean(collisionWorld.capsuleHit(new Capsule(P(c.flt0),P(c.flt2),r),skip));else hit=Boolean(collisionWorld.sphereOverlap(P(c.flt0),r,skip));}
   if(hit===c.passOnFail)return false;}
  return true;}
 const onlineDeployments=()=>[...(online?.worldObjects?.values()??[])].map(o=>o.deployed).filter(Boolean);
 const placementWorld={zones:noPlacementZones,deployedNear:(p,r,tag)=>online?onlineDeployments().find(o=>o.tag===tag&&o.position.distanceTo(p)<r):deployables.near(p,r,tag),fit:fitTest,hardpoint:null,
  cast(rayU,range,radius){const rayB=new THREE.Ray(browserOf(rayU.origin),browserOf(rayU.direction).normalize());
   const solid=radius>0?collisionWorld.sphereCast(rayB,radius,range,placeSkip):null,exact=collisionWorld.raycast(rayB,range,placeSkip),land=terrainRay(rayB,range);
   let best=null;
   if(solid){const r=exact&&exact.body===solid.body?exact:null;best={point:r?r.position:solid.point,normal:r?r.normal:new THREE.Vector3(0,1,0),distance:solid.distance,body:solid.body};}
   else if(exact)best={point:exact.position,normal:exact.normal,distance:exact.distance,body:exact.body};
   if(land&&(!best||land.distance<best.distance))best={point:land.position,normal:land.normal,distance:land.distance,body:null,terrain:true};
   if(!best)return null;const body=best.body;
   return {point:unityOf(best.point),normal:unityOf(best.normal),terrain:Boolean(best.terrain),layer:body?.layer??0,deployed:body?.deployed??null,structure:body?.structure??null};}};
 // Original building: StructureMaster grid, StructureComponent.CheckLocation, hardpoints and carriers.
 const structureWorld={zones:noPlacementZones,
  raycast(rayU,range){const rayB=new THREE.Ray(browserOf(rayU.origin),browserOf(rayU.direction).normalize()),exact=collisionWorld.raycast(rayB,range,placeSkip),land=terrainRay(rayB,range);
   const best=land&&(!exact||land.distance<exact.distance)?land:exact;if(!best)return null;return {point:unityOf(best.position),normal:unityOf(best.normal),terrain:Boolean(best.terrain),structure:best.body?.structure??null,deployed:best.body?.deployed??null};},
  // TransformHelpers.GetGroundInfoTerrainOnly: ray down from 0.25 m above; the first thing hit must be the terrain.
  groundTerrainOnly(posU,range){const s=browserOf(posU);s.y+=0.25;return Boolean(collisionWorld.raycast(new THREE.Ray(s,new THREE.Vector3(0,-1,0)),range+0.25,placeSkip)?.terrain);},
  spikeWallNear(posU,r){for(const o of online?onlineDeployments():deployables.objects)if(o.prefab.components.SpikeWall&&o.position.distanceTo(posU)<=12&&Math.hypot(o.position.x-posU.x,o.position.z-posU.z)<r)return true;return false;}};
 const structures=new StructureSystem(deployManifest,inventoryUI.inventory.catalogue.items,structureWorld,{now:resourceTime,
  onAdd(c){const group=deployTemplates.get(c.prefab.ngcName).clone();group.matrixAutoUpdate=false;group.matrix.copy(c.matrix);scene.add(group);c.view={group,body:null};
   prefabBody(c.prefab,c.matrix,c.prefab.name).then(body=>{if(c.destroyed)return;body.structure=c;c.view.body=collisionWorld.addBody(body);});},
  onRemove(c){scene.remove(c.view.group);if(c.view.body)collisionWorld.removeBody(c.view.body);}});
 placementWorld.hardpoint=(rayU,type)=>(online?.buildings?.system??structures).hardpointFromRay(rayU,type);
 // Server rules for the offline world (browser/world-rules.mjs): ownership, code locks, decay, spike walls.
 // EnvDecay/StructureMaster decay rays hit the whole collision world (deployables, terrain, rocks…), first hit counts.
 const rules=new WorldRules({structures,deployables,raycast:(originU,dirU,range)=>structureWorld.raycast(new THREE.Ray(originU,dirU),range)});
 // Raid presentation, the client halves of the server's OnHurt/OnKilled: HealthDimmer on ClientHealthUpdate,
 // StructureComponent.ClientKilled / DeployableObject.Client_OnKilled death effects (destroyed after 5 s) and the
 // DeployableCorpse a killed door leaves (NetCull.InstantiateStatic, NetDestroy after 300 s).
 // HealthDimmer.UpdateHealthAmount: the first renderer material's _Color average, then a grey _Color in each
 // renderer's MaterialPropertyBlock (per-object material copies here).
 function healthDimmer(view,percent,structureStyle){const g=view?.group;if(!g)return;
  if(!view.dimmer){const meshes=[];g.traverse(m=>{if(m.isMesh&&m.material?.isLegacyMaterial)meshes.push(m);});
   if(!meshes.length){view.dimmer={valid:false};return;}const c=meshes[0].material.legacyUniforms.legacyColor.value;
   for(const m of meshes)m.material=m.material.clone();view.dimmer={valid:true,average:(c.x+c.y+c.z)/3,meshes,percent:null,structureStyle};}
  const d=view.dimmer;if(!d.valid||d.percent===percent)return;d.percent=percent;const b=healthDimmerGrey(percent,d.average,structureStyle);d.grey=b;
  for(const m of d.meshes)m.material.legacyUniforms.legacyColor.value.set(b,b,b,1);}
 let lastKilled=null;const killLog=[];
 function deathEffect(matrix,fx,name){const at=new THREE.Vector3(),q=new THREE.Quaternion();matrix.decompose(at,q,new THREE.Vector3());
  if(fx)showExplosion(unityOf(at),fx,{rotation:q,lifetime:5});lastKilled={name,deathEffect:fx??null,at:unityOf(at).toArray(),time:resourceTime()};killLog.push(lastKilled);if(killLog.length>16)killLog.shift();}
 const corpses=new Set();
 function spawnCorpse(key,positionU,rotationU,{onlineKey=null}={}){const p=deployManifest.prefabs[key],template=deployTemplates.get(key);if(!p||!template)return null;
  const matrix=deployMatrix(positionU,rotationU,p.rootScale),group=template.clone();group.matrixAutoUpdate=false;group.matrix.copy(matrix);scene.add(group);
  const c={key,name:p.name,position:positionU.clone(),matrix,group,body:null,until:onlineKey?Infinity:resourceTime()+300,onlineKey};corpses.add(c);
  prefabBody(p,matrix,p.name).then(b=>{if(!corpses.has(c))return;c.body=collisionWorld.addBody(b);});return c;}
 function removeCorpse(c){if(!corpses.delete(c))return;scene.remove(c.group);if(c.body)collisionWorld.removeBody(c.body);}
 structures.onHurt=c=>healthDimmer(c.view,c.health/c.maxHealth,true);
 deployables.onHurt=o=>healthDimmer(o.view,o.health/o.maxHealth,false);
 structures.onKilled=c=>deathEffect(c.matrix,c.prefab.components.StructureComponent?.[0]?.deathEffect,c.prefab.name);
 deployables.onKilled=(o,k)=>deathEffect(o.matrix,k.deathEffect,o.prefab.name);
 deployables.spawnCorpse=(key,p,q)=>spawnCorpse(key,p,q);
 for(const sys of [deployables,structures]){const add=sys.onAdd;sys.onAdd=o=>{add?.(o);rules.onPlaced(o,'local',resourceTime());};}
 // Bed.IsValidToSpawn: carried by a ceiling, or a structure within 12 m straight up.
 deployables.roofed=o=>{if(o.carrier?.type===3)return true;const s=browserOf(o.position);s.y+=0.25;return Boolean(collisionWorld.raycast(new THREE.Ray(s,new THREE.Vector3(0,1,0)),12,placeSkip)?.body?.structure);};
 // StructureComponentItem: right click or the mouse wheel turns the piece 90 degrees.
 let desiredRotation=new THREE.Quaternion(),attack2=false,lastAttack2=false;const turn90=sign=>desiredRotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),sign*Math.PI/2));
 function placementSlot(){const inv=inventoryUI.inventory;return inv.slots[online?inv.activeSlot:inv.selected];}
 function heldStructure(){const slot=placementSlot(),entry=slot?.uses>0&&deployManifest.structures[slot.item];return entry?.prefab?{key:slot.item,entry,prefab:deployManifest.prefabs[entry.prefab]}:null;}
 const ghostGood=new THREE.MeshBasicMaterial({color:0x56d364,transparent:true,opacity:0.45,depthWrite:false}),ghostBad=new THREE.MeshBasicMaterial({color:0xe5534b,transparent:true,opacity:0.45,depthWrite:false});
 let ghost=null,ghostKey=null,nextPlaceTime=0,lastPlacement=null;
 function heldDeployable(){const slot=placementSlot(),entry=slot?.uses>0&&deployManifest.deployables[slot.item];return entry?.prefab?{key:slot.item,entry,prefab:deployManifest.prefabs[entry.prefab]}:null;}
 function placementRay(){const d=camera.getWorldDirection(new THREE.Vector3());return new THREE.Ray(unityOf(camera.position),unityOf(d));}
 // DeployableItem: preview each frame, place on Fire (0.5 s apart, grounded), consuming one item.
 // StructureComponentItem.RenderPlacementHelpers / DeployableItem.RenderDeployPreview (placement-preview.mjs). The flat
 // green/red ghost below is only a fallback for asset sets without the placement export.
 function previewFrame(held,valid,position,rotation,carrier=null){
  if(placementPreview?.has(held.key)){if(ghost)ghost.visible=false;placementPreview.update(held.key,{valid,position,rotation,scale:held.prefab.rootScale??{x:1,y:1,z:1},t:resourceTime(),
   carrier:carrierPreview(carrier),camera,resolution:renderer.getDrawingBufferSize(previewResolution)});return;}
  showGhost(held.entry.prefab);ghost.matrix.copy(deployMatrix(position,rotation,held.prefab.rootScale));ghost.matrixWorldNeedsUpdate=true;const mat=valid?ghostGood:ghostBad;ghost.traverse(m=>{if(m.isMesh)m.material=mat;});}
 // GameGizmoWaveAnimationCarrier: the TransCarrier's own (root) MeshRenderer mesh, at its world matrix.
 const previewResolution=new THREE.Vector2(),carrierGeometry=new Map();
 function carrierPreview(c){const prefab=c?.prefab,r=prefab?.renderers?.find(x=>x.node===0);if(!r||!deployManifest.meshes[r.mesh])return null;
  return {key:r.mesh,matrix:deployMatrix(c.position,c.rotation,prefab.rootScale??{x:1,y:1,z:1}),geometries:()=>{if(!carrierGeometry.has(r.mesh))carrierGeometry.set(r.mesh,(async()=>{const a=await deployAssets.attributes(r.mesh),md=deployManifest.meshes[r.mesh],out=[];
   for(const part of md.parts){const g=new THREE.BufferGeometry();for(const [k,attr] of Object.entries(a))if(attr)g.setAttribute(k,attr);g.setIndex(new THREE.BufferAttribute(await deployAssets.binary(part,Uint32Array),1));if(!a.normal)g.computeVertexNormals();out.push(g);}return out;})());return carrierGeometry.get(r.mesh);}};}
 function showGhost(prefabKey){if(ghostKey!==prefabKey){if(ghost)scene.remove(ghost);ghost=deployTemplates.get(prefabKey).clone();ghost.matrixAutoUpdate=false;scene.add(ghost);ghostKey=prefabKey;}ghost.visible=true;}
 // StructureComponentItem.ItemPreFrame/DoPlace: Fire places when the preview is valid, 0.5 s apart.
 function structureFrame(held,attack){if(attack2&&!lastAttack2)turn90(1);lastAttack2=attack2;
  const r=(online?.buildings?.system??structures).placement(held.key,placementRay(),desiredRotation);lastPlacement={valid:r.valid,results:{},position:r.position,structure:true,master:r.master?.nativeViewId??0};
  previewFrame(held,r.valid,r.position,r.rotation);
  const t=resourceTime();if(!attack||!r.valid||t<nextPlaceTime)return;nextPlaceTime=t+0.5;
  if(online){const ray=placementRay();online.client.item(serverInventory.activeRep,'structure-place',{origin:browserOf(ray.origin).toArray(),direction:browserOf(ray.direction).toArray(),position:browserOf(r.placePosition).toArray(),rotation:[-r.placeRotation.x,-r.placeRotation.y,r.placeRotation.z,r.placeRotation.w],master:r.master?.nativeViewId??0});return;}
  if(!structures.place(held.key,placementRay(),r.placePosition,r.placeRotation,r.master))return;const inv=inventoryUI.inventory,slot=inv.slots[inv.selected];slot.uses-=1;if(slot.uses<=0)inv.slots[inv.selected]=null;inventoryUI.refresh();}
 function deployFrame(attack){const active=walk&&playerVitals.alive&&!inputBlocked()&&(!online||online.state==='in-game'&&serverInventory.activeRep!=null),building=active?heldStructure():null;if(building)return structureFrame(building,attack);
  const held=active?heldDeployable():null;
  if(!held){if(ghost)ghost.visible=false;placementPreview?.hide();lastPlacement=null;return;}
  const result=checkPlacement(held.entry,held.prefab,placementRay(),placementWorld);lastPlacement=result;previewFrame(held,result.valid,result.position,result.rotation,result.carrier);
  const t=resourceTime();if(!canPlace({attack,valid:result.valid,now:t,nextPlaceTime,grounded:motor.grounded}))return;nextPlaceTime=t+0.5;
  if(online){const ray=placementRay();online.client.item(serverInventory.activeRep,'deployable-place',{origin:browserOf(ray.origin).toArray(),direction:browserOf(ray.direction).toArray()});return;}
  deployables.place(held.key,result.position,result.rotation,t,result.carrier);const inv=inventoryUI.inventory,slot=inv.slots[inv.selected];slot.uses-=1;if(slot.uses<=0)inv.slots[inv.selected]=null;inventoryUI.refresh();}
 inventoryUI.setWorkbench(()=>online?serverInventory.atWorkbench:deployables.atWorkbench(playerTarget.position));
 // Original firearms, bows and grenades (decompiled WeaponItem family), explosions and explosive charges.
 const weaponAssets=deployManifest.weapons??{},itemKeyByPath=p=>p?Object.keys(catalogue.items).find(k=>k.endsWith(':'+p)):null;
 const recoil=new Recoil(),weaponStates=new WeakMap();let activeWeapon=null,activeWeaponActivation=0,aimHeld=false,reloadHeld=false,devAttackUntil=0,devReloadUntil=0,lastShot=null;const aim={sensitivity:1,sway:null,lastSway:null};
 function playLocal(file,volume=1,pitch=1,root=deployBase){if(!listener||!file)return;const url=root+file;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));buffers.get(url).then(b=>{const a=new THREE.Audio(listener);a.setBuffer(b);a.setVolume(volume);a.setPlaybackRate(pitch);a.play();a.onEnded=()=>a.disconnect();}).catch(()=>{});}
 function heldWeapon(){const inv=inventoryUI.inventory,slot=inv.slots[inv.selected],item=slot&&catalogue.items[slot.item];if(!item)return null;const c=item.class,d=item.data;
  const kind=c==='BulletWeaponDataBlock'||c==='ShotgunDataBlock'||c==='StrikeGunDataBlock'?'gun':c==='BowWeaponDataBlock'?'bow':c==='HandGrenadeDataBlock'&&weaponAssets[slot.item]?.prefabs?.throwObjectPrefab&&(deployManifest.prefabs[weaponAssets[slot.item].prefabs.throwObjectPrefab]?.components.TimedGrenade||deployManifest.prefabs[weaponAssets[slot.item].prefabs.throwObjectPrefab]?.components.SignalGrenade)?'grenade':c==='TorchItemDataBlock'&&deployManifest.prefabs[weaponAssets[slot.item]?.prefabs?.throwObjectPrefab]?.components.FlareObj?'flare':null;if(!kind)return null;
  let state=weaponStates.get(slot);if(!state){state=kind==='gun'?new (c==='StrikeGunDataBlock'?StrikeGunState:GunState)(d,itemKeyByPath(d.ammoType?.m_PathID)):kind==='bow'?new BowState(d,itemKeyByPath(d.defaultAmmo?.m_PathID)??Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name==='Arrow')):kind==='flare'?new FlareState(d):new ThrowState(d);weaponStates.set(slot,state);}
  return {slot,key:slot.item,d,kind,state,assets:weaponAssets[slot.item]??{sounds:{},prefabs:{}}};}
 // BulletWeaponDataBlock/ShotgunDataBlock.hitMask and ArrowMovement.layerMask 406721553 (layers 0, 4, 10, 12, 17-21, 27, 28):
 // no trigger volumes (26) and no PlayerClip (29). triggerSkip: Physics.Raycast's default layers (LockpickItem).
 const HIT_MASK=406721553,shotSkip=b=>Boolean(b&&!((HIT_MASK>>>(b.layer??0))&1)),triggerSkip=b=>Boolean(b&&b.layer===26);
 // The nearest thing a ray meets, including the heightfield terrain.
 function worldHit(rayB,range,skip=shotSkip){const hit=collisionWorld.raycast(rayB,range,skip),land=terrainRay(rayB,range);return land&&(!hit||land.distance<hit.distance)?land:hit;}
 // TakeDamage.Hurt on whatever the body belongs to (animals, deployables, structure pieces).
 function hurtBody(body,types){if(body?.animal&&!body.animal.destroyed){body.animal.hurt(types,playerTarget);return 'animal';}const o=body?.deployed??body?.structure;if(o&&!o.destroyed&&o.hurt){o.hurt(types,undefined,playerTarget);return o.destroyed?'destroyed':'object';}return null;}
 // Two pooled point lights for QuickLight impact flashes (MetalImpact sparks), like the explosion pool below.
 const impactLights=Array.from({length:2},()=>{const l=new THREE.PointLight(0xffffff,0,1,1);scene.add(l);return l;});
 const tracerEffects=await createTracerEffects(deployManifest,deployAssets,scene,{base:deployBase,raycast:worldHit,makeEffects:fireEffects,playSound:(file,position,min,max)=>playFile(deployBase+file,file,position,min,max),presentation:presentationManifest,lights:impactLights}),tracers=tracerEffects.flights;
 let lastTracer=null;function spawnTracer(from,to,assets,range,silenced=false){lastTracer={from:from.toArray(),to:to.toArray(),eye:camera.position.toArray()};return tracerEffects.spawn(assets.prefabs?.tracerPrefab,from,to,{range,silenced});}
 function updateTracers(dt){tracerEffects.frame(dt,camera);}
 // Original player/world audio (tools/export_audio.py, world-audio.mjs): footsteps, fall impact, vomit, geiger, ambience, music.
 const worldAudio=await json('audio/manifest.json').then(m=>createWorldAudio({manifest:m,base:base+'audio/',getListener:()=>listener,scene,camera,buffers,loader:audioLoader,collisionWorld,surfaceFor:tracerEffects.surfaceFor,deploySurfaces:deployManifest.surfaces,footstepQuality:()=>convars.get('footsteps.quality')})).catch(e=>{console.warn('World audio unavailable:',e.message);return null;});
 // Original combat feedback HUD/overlay (tools/export_feedback.py, combat-feedback.mjs). gfx.damage toggles GameFullscreen.
 feedbackManifest=await json('feedback/manifest.json').catch(e=>{console.warn('Combat feedback unavailable:',e.message);return null;});
 if(feedbackManifest)combatFeedback=await createCombatFeedback(renderer,feedbackManifest,base+'feedback/',{clock:resourceTime,enabled:()=>qualityController?qualityController.effects.active('GameFullscreen'):convars.get('gfx.damage')!==false,playLocal:url=>playLocal(url,1,1,'')}).catch(e=>{console.warn('Combat feedback unavailable:',e.message);return null;});
 // TakeDamage.ShouldPlayHitNotification on what the local ray hit, read before any damage applies (players, sleepers, wildlife).
 function hitNotifies(body){const flags=feedbackManifest?.playsHitNotification;if(!flags||!body)return false;
  if(body.animal)return shouldPlayHitNotification(flags,body.animal.def.name,body.animal.alive&&!body.animal.destroyed);
  if(body.onlineActor){const a=online?.wildlife?.actors.get(body.onlineActor.viewId);if(a)return shouldPlayHitNotification(flags,a.def.name,!a.dead);return body.bodyPart!=null&&shouldPlayHitNotification(flags,'MalePlayer',true);}
  return Boolean(body.deployed?.prefab?.components?.SleepingAvatar)&&shouldPlayHitNotification(flags,'MaleSleeper',true);}
 // WeaponDataBlock.PlayHitNotification: followPoint = !shooter || !shooter.stateFlags.aim (shotguns pass no shooter, bows and melee never aim).
 function hitNotification(point,aiming){combatFeedback?.hitNotification(point,{follow:!aiming});}
 const feedbackLog={localHeadshots:0,remoteHeadshots:0,lastHeadshot:null};
 const muzzle=()=>viewModels?.socketWorld('muzzle',camera)??camera.position.clone().add(new THREE.Vector3(0.15,-0.12,-0.4).applyQuaternion(camera.quaternion));
 const modFlagsByUID=new Map(Object.values(inventoryUI.inventory.catalogue.items).filter(i=>i.data.modFlag!=null).map(i=>[i.data._uniqueID,i.data.modFlag]));
 const weaponSilenced=w=>Boolean(w.slot.mods?.some(uid=>(modFlagsByUID.get(uid)??0)&8));
 function localMuzzleFlash(w){if(!viewModels||w.d.numPellets==null&&w.slot.mods?.some(uid=>(modFlagsByUID.get(uid)??0)&8))return;const key=viewModels.active;muzzleFlashes.start(w.assets.prefabs?.muzzleflashVM,()=>viewModels.active===key?viewModels.socketCameraMatrix('muzzle'):null,{viewScene:viewModels.scene});}
 // First-person viewmodels (HeldItemDataBlock._viewModelPrefab), loaded after the world.
 let crosshair=null;createCrosshair().then(c=>{crosshair=c;},e=>console.warn('Crosshair data unavailable:',e.message));
 let viewModels=null,vmManifest=null,viewZoom=0,lastViewIdentity=null,lastViewActivation=0,lastDeploySound=null,baseFov=renderSettings.fov;const cameraSway=new CameraSway();
 renderSettings.addEventListener('change',()=>{baseFov=renderSettings.fov;camera.fov=baseFov;camera.updateProjectionMatrix();});
 let heldTorch=null;const torchWorldLight=new THREE.PointLight(0xffffff,0,20,1);scene.add(torchWorldLight);
 const torchViewLight=new THREE.PointLight(0xffffff,0,20,1);
 let itemModAssets=null,weaponModEffects=null,lampSetting=true,laserSetting=true;
 try{lampSetting=localStorage.getItem('rlb-lamp')!=='0';laserSetting=localStorage.getItem('rlb-laser')!=='0';}catch{}
 const viewModelsReady=json('viewmodels/manifest.json').then(async m=>{vmManifest=m;const [clips,mods]=await Promise.all([loadClips(base+'viewmodels/'+m.clipsFile),json('item-mods/manifest.json')]);itemModAssets=await createItemModAssets(mods,createAssetLoader(base+'item-mods/',mods));weaponModEffects=await createWeaponModEffects(mods,scene,{base:base+'item-mods/',raycast:(ray,range,mask)=>{const skip=b=>Boolean(b&&!(mask&(1<<(b.layer??0))));return mask&1?worldHit(ray,range,skip):collisionWorld.raycast(ray,range,skip);},playSound:(file,position,anchor)=>playFile(base+'item-mods/'+file,file,position,1,4,1,'inverse',1,{parent:anchor??null})});viewModels=await createViewModelRenderer(m,clips,createAssetLoader(base+'viewmodels/',m),{aspect:camera.aspect,modAssets:itemModAssets,barrelExtras:fx.manifest?.viewmodels??null});viewModels.scene.add(torchViewLight);}).catch(e=>console.warn('Viewmodels unavailable',e));
 function activeModUIDs(){const inv=inventoryUI.inventory;return inv.slots[online?inv.activeSlot:inv.selected]?.mods??[];}
 // HumanController.ProcessInput state flags from the motor's last ProcessInput (motor.sample: after the airborne clear
 // and Crouchable's crouch block) and the frame's input sample: movement (64) = move keys held, not velocity.
 let moveInput=humanInputSample();
 function localStateFlags(){const s=motor.sample;return (s.aim?STATE.aim:0)|(s.sprint?STATE.sprint:0)|(s.crouch?STATE.crouch:0)|(moveInput.forward||moveInput.right?STATE.movement:0)|(s.airborne?STATE.airborne:0)|(s.sliding?STATE.slipping:0)|(s.crouchBlocked?STATE.crouchBlocked:0);}
 function localModFlags(){return (lampSetting?STATE.lamp:0)|(laserSetting?STATE.laser:0);}
 function updateModEffects(bobMatrix=null){if(!weaponModEffects)return;const records=[];
  if(walk&&playerVitals.alive&&viewModels?.active)records.push({id:'local:'+viewModels.active,local:true,mods:activeModUIDs(),flags:localModFlags(),matrix:name=>{const m=viewModels.socketCameraMatrix(name);if(m&&bobMatrix)m.premultiply(bobMatrix);return m?camera.matrixWorld.clone().multiply(m):null;}});
  if(online?.state!=='closed')for(const [id,v]of online?.playerRenderer?.views??[]){const h=online.held?.items.get(v.held?.rep);if(h)records.push({id:'remote:'+h.rep,local:false,mods:h.mods,flags:v.flags??0,matrix:()=>online.playerRenderer.heldMuzzle(id)});}
  weaponModEffects.sync(records,camera,{viewProjection:viewModels?.laserProjection(camera)??null});
  // Lamp radial lights reach the View Model layer too; re-mirror after the lamps moved this frame.
  viewModels?.mirrorLights([...fireLights,muzzleFlashes.worldLight,...weaponModEffects.viewLights()],camera,weaponModEffects.viewSpots());
 }
 // ViewModel.BarrelAim's eye ray: Physics2.Raycast2(eyesRay, noHitPlane, aimMask) hit distance, else noHitPlane.
 function barrelAimDistance(key){const s=vmManifest?.viewmodels[key]?.settings,x=fx.manifest?.viewmodels?.[key];if(!s?.barrelAiming&&!s?.barrelWhileZoom&&!s?.barrelWhileBowing)return null;
  const range=s.noHitPlane??20;if(!(range>0))return 0;const mask=x?.aimMask??0xffffffff,skip=b=>Boolean(b&&!(mask&(1<<(b.layer??0)))),ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3()));
  const hit=mask&1?worldHit(ray,range,skip):collisionWorld.raycast(ray,range,skip),at=hit?.position??hit?.point;return at?Math.min(range,at.distanceTo(camera.position)):range;}
 // ?dev only (explorerDev.lightHeldFlare): lights (true) or puts out (false) the held offline flare without the 0.8 s strike.
 let devFlareRequest=null;
 function torchFrame(slot,dt){
  // Scene point lights (fires, remote torches, remote muzzle flashes) also light the held item in its own view-model pass.
  viewModels.mirrorLights([...fireLights,muzzleFlashes.worldLight],camera);
  // BasicTorchItem.OnSetActive ignites on equip and extinguishes on holster. The client class has no fuel tick; the
  // server's burns a use per second (torch-fuel.mjs, playerServerFrame offline).
  const basic=slot&&catalogue.items[slot.item].class==='BasicTorchItemDataBlock',litFlare=online?serverThrowables.active?.kind==='flare'&&serverThrowables.active.state.lit:activeWeapon?.kind==='flare'&&activeWeapon.slot===slot&&activeWeapon.state.lit,key=(basic||litFlare)&&weaponAssets[slot.item]?.prefabs?.FirstPersonLightPrefab,slotKey=online?inventoryUI.inventory.activeRep:slot;
  if(heldTorch&&(heldTorch.slotKey!==slotKey||!key)){for(const e of heldTorch.effects){viewModels.scene.remove(e.mesh);e.dispose();}for(const e of heldTorch.legacy){scene.remove(e.mesh);e.dispose();}if(heldTorch.audio){if(heldTorch.audio.isPlaying)heldTorch.audio.stop();scene.remove(heldTorch.audio);}heldTorch=null;}
  torchWorldLight.intensity=torchViewLight.intensity=0;
  if(!key||viewModels.active!==vmManifest.items[slot.item])return;
  if(!heldTorch){const p=deployManifest.prefabs[key];if(!p)return;const effects=fireEffects(p);for(const e of effects){e.mesh.matrixAutoUpdate=false;viewModels.scene.add(e.mesh);}
   // FlareLightLegacy1P: legacy particle components with plain Particles/* shaders, drawn in the world pass at the eye proxy.
   const legacy=legacyEffects(fx.manifest?.prefabs?.[key],p,fx.manifest?.materials??{},fxLegacyTexture);for(const e of legacy)scene.add(e.mesh);
   const L=p.components.Light?.[0],driver=L?lightDriver({fx:fx.manifest,prefabKey:key,lightNode:L.node,lightData:L.data,startTime:fx.time}):null;
   // The light prefab's own looping AudioSource (torch fire crackle, flare burn), playing from its instantiation.
   heldTorch={slotKey,key,prefab:p,effects,legacy,driver,audio:null,audioSource:p.components.AudioSource?.find(a=>a.enabled&&a.clip)??null,eye:new THREE.PerspectiveCamera()};}
  // Created once the audio listener exists (after the first trusted input), like the fire loops.
  if(!heldTorch.audio&&heldTorch.audioSource&&listener){const src=heldTorch.audioSource,audio=applyPanning(new THREE.PositionalAudio(listener));audio.setLoop(Boolean(src.data.Loop));audio.setDistanceModel(sourceDistanceModel(src.data.rolloffMode));audio.setRefDistance(src.data.MinDistance??1);audio.setMaxDistance(src.data.MaxDistance??500);audio.setVolume(src.data.m_Volume??1);audio.setPlaybackRate(src.data.m_Pitch??1);scene.add(audio);heldTorch.audio=audio;
   const url=deployBase+src.clip;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));buffers.get(url).then(b=>{if(heldTorch?.audio===audio){audio.setBuffer(b);audio.play();}}).catch(()=>{});}
  const socket=viewModels.socketInstanceMatrix('muzzle');if(!socket)return;const p=heldTorch.prefab,s=p.rootScale;
  const matrix=socket.clone().multiply(new THREE.Matrix4().makeScale(s.x,s.y,s.z));
  // BasicTorchItemDataBlock.Ignite: muzzle socket InstantiateAsChild puts TorchFire in the world at the eye proxy (Socket.CameraSpace),
  // so its moveWithTransform=false systems simulate in world space; its "View Model/Particles" shaders draw with the view-model
  // projection (CameraFX V_MUNITY_MATRIX_P). Simulate at the eye-relative world pose, then draw in the view-model pass's camera space.
  const eye=heldTorch.eye;eye.position.copy(camera.position);eye.quaternion.copy(camera.quaternion);eye.fov=viewModels.camera.fov;eye.aspect=viewModels.camera.aspect;eye.updateMatrixWorld();
  const world=eye.matrixWorld.clone().multiply(matrix),toView=eye.matrixWorld.clone().invert();
  for(const e of heldTorch.effects){e.update(dt,true,world,eye);e.mesh.matrix.copy(toView);}for(const e of heldTorch.legacy)e.update(dt,true,world,camera);
  const L=p.components.Light?.[0];if(L){const d=L.data,local=new THREE.Vector3().setFromMatrixPosition(matrix.clone().multiply(new THREE.Matrix4().fromArray(p.nodes[L.node].matrix)));
   const intensity=heldTorch.driver?heldTorch.driver.intensity(dt,fx.time):d.m_Intensity;heldTorch.intensity=intensity;
   for(const l of [torchViewLight,torchWorldLight]){l.color.setRGB(d.m_Color.r,d.m_Color.g,d.m_Color.b);l.distance=d.m_Range;l.intensity=intensity*6;}
   torchViewLight.position.copy(local);torchWorldLight.position.copy(local).applyMatrix4(camera.matrixWorld);}
  if(heldTorch.audio)heldTorch.audio.position.setFromMatrixPosition(world);
 }
 function viewModelFrame(t,dt){if(!viewModels)return;const inv=inventoryUI.inventory,slot=walk&&playerVitals.alive?inv.slots[online?inv.activeSlot:inv.selected]:null,key=slot&&vmManifest.items[slot.item];
  // Offline a re-activation of the same item (a mod attached to the held gun: ItemModItem.TryCombine → OnBeltUse) is a
  // fresh deploy too: new view model, draw animation and deploySound (inventory.activations).
  const activation=online?0:inv.activations??0,identity=slot?(online?serverInventory.activeRep:slot):null,fresh=identity!==lastViewIdentity||(Boolean(slot)&&activation!==lastViewActivation);lastViewIdentity=identity;lastViewActivation=activation;
  if(key!==viewModels.active||fresh){if(key){viewModels.show(key,{force:fresh});const s=deploySoundFor(presentationManifest,slot.item);if(s){playLocal(s,1,1,presentationBase);lastDeploySound={item:slot.item,file:s,time:t};}}else viewModels.hide();}
  viewModels.setMods(slot?.mods??[]);
  // ViewModel.LateUpdate reads Character.stateFlags (ProcessInput, after its airborne clear): aim (the weapon allows
  // it; dropped off the ground, so the ADS zoom/FOV drop in a jump), bow = sprint && movement (keys held).
  const w=activeWeapon,flags=localStateFlags(),aiming=weaponAiming(t)&&!motor.sample.cleared;
  // Idle mixer channels (AnimationBlender): Character.stateFlags grounded/crouch/movement and eyesAngles in degrees.
  viewZoom=viewModels.update(dt,t,{aim:aiming,bow:Boolean(flags&STATE.sprint)&&Boolean(flags&STATE.movement),aimDistance:barrelAimDistance(key),grounded:!(flags&STATE.airborne),crouch:Boolean(flags&STATE.crouch),movement:Boolean(flags&STATE.movement),slipping:Boolean(flags&STATE.slipping),look:[pitch*180/Math.PI,yaw*180/Math.PI]},camera,{hemi,sun});
  // ViewModel.OnGUI crosshair (crosshair.mjs): the held view model's flags decide; the shipped ones never draw one.
  crosshair?.update({viewModel:viewModels.active,zoom:viewZoom,rposOpen:inventoryUI.isOpen(),cameraEnabled:playerVitals.alive,hit:()=>Boolean(collisionWorld.rayHit(new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),5000))});
  torchFrame(slot,dt);
  // CameraFX.SetFieldOfView(zoomFieldOfView, zoom fraction).
  const zf=vmManifest.viewmodels[viewModels.active]?.settings.zoomFieldOfView;const fov=zf&&viewZoom>0?baseFov+(zf-baseFov)*viewZoom:baseFov;if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}}
 // ShotgunDataBlock.Local_FireWeapon: MakeTracer(ray.origin, ray.origin + ray.direction * range) per pellet, so pellet
 // tracers start at the eyes; BulletWeaponDataBlock.DoWeaponEffects starts the single bullet's at the muzzle socket.
 const tracerStart=(w,rayB)=>w.d.numPellets!=null?rayB.origin.clone():muzzle(),tracerEnd=(w,rayB,range,end)=>w.d.numPellets!=null?rayB.at(range,new THREE.Vector3()):end;
 // BulletWeaponDataBlock.PlayFireSound: fireSound at Random.Range(0.92, 1.08) pitch, first person too (shotguns share it).
 const playOwnFireSound=(w,silenced)=>playLocal(w.assets.sounds?.[silenced?'fireSound_Silenced':'fireSound'],1,0.92+Math.random()*0.16);
 // BulletWeaponDataBlock.Local_FireWeapon + ApplyDamage: eyes ray per bullet/pellet, bullet damage.
 function fireGun(w,ev){const eyesU=unityOf(camera.getWorldDirection(new THREE.Vector3())),silenced=weaponSilenced(w),range=ev.range*(silenced?0.75:1);let firstHit=null,firstEnd=null,hits=0;
  for(const spread of ev.spread){const dirU=pelletDirection(eyesU,spread),rayB=new THREE.Ray(camera.position.clone(),browserOf(dirU).normalize()),hit=worldHit(rayB,range),end=hit?hit.position.clone():rayB.at(range,new THREE.Vector3());
   if(hit?.body&&hitNotifies(hit.body))hitNotification(hit.position,!w.d.numPellets&&weaponAiming(resourceTime()));
   // WriteHitInfo sends a miss as ray.GetPoint(1000), the server's endPos.
   if(hit?.body&&hurtBody(hit.body,bulletDamage(ev.damage(),{silenced})))hits++;firstHit??=hit;firstEnd??=hit?hit.position.clone():rayB.at(1000,new THREE.Vector3());spawnTracer(tracerStart(w,rayB),tracerEnd(w,rayB,range,end),w.assets,range,silenced&&!w.d.numPellets);}
  localMuzzleFlash(w);headBob.addEffect(bobData.shotEffects[String(w.d._uniqueID)]);recoil.add(ev.recoil.duration,ev.recoil.pitch,ev.recoil.yaw);playOwnFireSound(w,silenced);conditionLoss(inventoryUI.inventory.slots.indexOf(w.slot),...ev.conditionLoss);
  // Server BulletWeaponDataBlock.DoAction1 (gunshots.aiscared): AudibleMessage(20, HearDanger) at the shooter and (10) at the
  // endPos. ShotgunDataBlock.DoAction1 overrides it without either, so shotguns and the HandCannon scare no wildlife.
  if(w.d.numPellets==null){const pos=playerTarget.position,endU=unityOf(firstEnd);wildlife.audible(null,pos,20,'hearDanger',pos);wildlife.audible(null,endU,10,'hearDanger',endU);}
  lastShot={hits,distance:firstHit?.distance??null,body:firstHit?.body?.name??null,time:resourceTime()};}
 const arrows=[],grenades=[],explosionFx=[];
 // WorldArrow (ArrowMovement): TrailRenderer and looping AudioSource while flying, both disabled on impact; the
 // surface's Bullet impact effect for 1.5 s at the hit (rotation LookRotation(normal)); non-kinematic rigidbodies
 // (corpses) get AddForceAtPosition(up * 200) + (ray * 1000). Shared by own, own-online and remote arrows.
 const trailManifest=await json('trails/manifest.json').catch(e=>{console.warn('Arrow trails unavailable:',e.message);return null;});
 const arrowLog={trails:0,impacts:0,lastImpact:null,flightSounds:0};
 function arrowEffects(a,key){const t=trailManifest?.trails[key]?.trails?.[0];if(t){a.trail=new ArrowTrail(t,trailManifest.materials[t.materials[0]],scene);arrowLog.trails++;}
  const source=deployManifest.prefabs[key]?.components.AudioSource?.find(x=>x.enabled&&x.data.Loop);if(source?.clip){a.stopSound=playLoop(source.clip,a.view,source.data.MinDistance??1,source.data.MaxDistance??20,source.data.m_Pitch??1,source.data.m_Volume??1,source.data.rolloffMode===1?'linear':'inverse');arrowLog.flightSounds++;}}
 function arrowImpact(a,hit){a.trail?.disable();a.stopSound?.();a.stopSound=null;const point=browserOf(hit.point),normal=hit.normal?hit.normal.clone().normalize():browserOf(a.forward).normalize().negate(),dir=browserOf(a.forward).normalize();
  hit.body?.rigidImpact?.(point,dir);const surface=tracerEffects.surfaceFor({point:point.toArray(),body:hit.body??null,terrain:Boolean(hit.terrain)}),keys=surface?.bulletEffects??[],key=keys[Math.floor(Math.random()*keys.length)];
  const fx=key?tracerEffects.impact(key,point,new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),normal),1.5):null;arrowLog.impacts++;arrowLog.lastImpact={surface:surface?.name??null,effect:key??null,sound:fx?.sound??null,particles:fx?.particles??0,remote:Boolean(a.remote)};}
 function removeArrow(a){scene.remove(a.view);a.trail?.dispose();a.stopSound?.();}
 let lastRemoteAttack=null,remoteAttackCount=0;
 function remoteWeaponEffect(h,type,event){
  if(type==='swing'||type==='hit'){online.playerRenderer.melee(h.parent,catalogue.items[h.key].data,type,resourceTime(),h.rep);if(type==='hit')remoteMeleeEffects(h,event);return;}
  const assets=weaponAssets[h.key],d=catalogue.items[h.key].data,silenced=Boolean(h.modFlags&8);
  if(type==='gun'){
   // ItemRepresentation.RunAction -> DoAction1 on THIS representation: its own muzzle, also for an old one still shown
   // until its InterpDestroy.
   const matrix=online.playerRenderer.heldMuzzle(h.parent,h.rep);if(!matrix)return;const start=new THREE.Vector3().setFromMatrixPosition(matrix),ends=event.hits.map(hit=>remoteBulletEnd(hit,collisionWorld.bodies,online.client));
   for(const end of ends)spawnTracer(start,end,assets,d.bulletRange*(silenced?0.75:1),silenced&&d.numPellets==null);
   // BulletWeaponDataBlock.DoAction1: a head body part on a character plays headshotSound at its root (1, 4 m, 30 m); shotguns don't.
   if(d.numPellets==null)for(const hit of event.hits){const v=hit.target&&!hit.target.p1&&isHeadshotPart(hit.part)?hit.target.viewId:null,view=v!=null&&online.playerRenderer.views.get(v);
    const at=v==null?null:v===online.client.characterView?motor.feet.clone():view?new THREE.Vector3().setFromMatrixPosition(view.root.matrix):null,f=assets.sounds?.headshotSound;
    if(at&&f){playFile(deployBase+f,f,at,4,30);feedbackLog.remoteHeadshots++;feedbackLog.lastHeadshot={remote:true,viewId:v,at:at.toArray(),file:f};}}
   if(!silenced||d.numPellets!=null){
    muzzleFlashes.start(assets.prefabs?.muzzleFlashWorld,()=>online.state!=='closed'?online.playerRenderer.heldMuzzle(h.parent,h.rep):null);}
   // BulletWeaponDataBlock.PlayFireSound -> clip.PlayLocal(rep.transform.parent, zero, ...): both clips follow the shooter.
   const root=online.playerRenderer.views.get(h.parent).root,origin=new THREE.Vector3().setFromMatrixPosition(root.matrix),file=assets.sounds?.[silenced?'fireSound_Silenced':'fireSound'];
   playFile(deployBase+file,file,origin,2,60*(silenced?1.5:1),0.92+Math.random()*0.16,'linear',1,{parent:root});
   if(!silenced&&origin.distanceTo(camera.position)>30){const far=assets.sounds?.fireSound_Far;playFile(deployBase+far,far,origin,0,d.fireSoundRange,0.9+Math.random()*0.2,'linear',1,{parent:root});}
   lastRemoteAttack={type,rep:h.rep,silenced,sound:file,from:start.toArray(),ends:ends.map(p=>p.toArray())};
  }else if(type==='bow'){
   const key=assets.prefabs?.arrowPrefab,am=deployManifest.prefabs[key]?.components.ArrowMovement?.[0]?.data;
   const a=new Arrow(new THREE.Vector3(...event.origin),new THREE.Quaternion(...event.rotation).normalize(),d.arrowSpeed,am?.dropDegreesPerSec??5,am?.maxRange??1000);
   a.remote=true;a.view=prefabGroup(key);a.stuckUntil=null;arrowEffects(a,key);arrows.push(a);const file=assets.sounds?.fireArrowSound;playFile(deployBase+file,file,browserOf(a.position),2,10);
   lastRemoteAttack={type,rep:h.rep,origin:event.origin};
  }remoteAttackCount++;
 }
 // MeleeWeaponDataBlock.DoAction1 on other clients: only a hit whose NetEntityID resolves to an object runs
 // DoMeleeEffects, i.e. SurfaceInfo.DoImpact(Melee) at the world point with LookRotation(repPosition - point).
 // Tree hits carry no entity (no effect); the swing itself has no remote sound (SwingSound is owner-only).
 const remoteMeleeLog={hits:0,effects:0,last:null};
 function remoteMeleeEffects(h,event){remoteMeleeLog.hits++;if(!event?.target)return;const t=event.target,client=online.client,point=new THREE.Vector3(event.point[0],event.point[1],-event.point[2]);
  let body=null;if(!t.p1&&t.viewId===client.characterView)body={surfaceName:'MalePlayer'};
  else body=collisionWorld.bodies.find(b=>t.p1?b.online?.innerID===t.p2&&client.views.get(b.online.carrier)?.group===t.p1:b.onlineActor?.viewId===t.viewId)??null;
  if(!body)return;const surface=tracerEffects.surfaceFor({point:point.toArray(),body}),list=surface?.meleeEffects??[],key=list[Math.floor(Math.random()*list.length)];if(!key)return;
  const rep=online.playerRenderer.views.get(h.parent)?.reps?.get(h.rep)?.root,from=rep?new THREE.Vector3().setFromMatrixPosition(rep.matrixWorld):point.clone().add(new THREE.Vector3(0,0,1)),dir=from.sub(point).normalize();
  const fx=tracerEffects.impact(key,point,new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),dir),1);remoteMeleeLog.effects++;remoteMeleeLog.last={surface:surface.name,effect:key,sound:fx?.sound??null,particles:fx?.particles??0,point:point.toArray()};}
 function prefabGroup(key){const t=key&&deployTemplates.get(key);const g=t?t.clone():new THREE.Group();g.matrixAutoUpdate=false;scene.add(g);return g;}
 // BowWeaponDataBlock.Local_FireArrow plays vm.Play("fire_1", StopSameLayer) (callers): no view-model punch, which only
 // ViewModel.PlayFireAnimation (guns, melee) sets.
 function fireArrow(w,ev){const eyesU=unityOf(camera.getWorldDirection(new THREE.Vector3())),key=w.assets.prefabs?.arrowPrefab,am=deployManifest.prefabs[key]?.components.ArrowMovement?.[0]?.data;
  const a=new Arrow(unityOf(camera.position),lookRotation(eyesU),ev.speed,am?.dropDegreesPerSec??5,am?.maxRange??1000);a.view=prefabGroup(key);a.stuckUntil=null;arrowEffects(a,key);
  if(online){a.native={rep:w.rep,character:online.client.characterView};online.client.item(w.rep,'bow-fire',{origin:camera.position.toArray(),rotation:camera.quaternion.toArray()});}
  arrows.push(a);playLocal(w.assets.sounds?.fireArrowSound);}
 function updateArrows(t,dt){for(let i=arrows.length-1;i>=0;i--){const a=arrows[i];
  if(a.remote&&online.state==='closed'){removeArrow(a);arrows.splice(i,1);continue;}
  if(a.native&&(online.client.characterView!==a.native.character||!online.client.views.has(a.native.rep)||online.state==='closed')){removeArrow(a);arrows.splice(i,1);continue;}
  if(!a.done){const hit=a.step(dt,(rayU,len)=>{const h=worldHit(new THREE.Ray(browserOf(rayU.origin),browserOf(rayU.direction).normalize()),len);return h&&{point:unityOf(h.position),body:h.body,normal:h.normal,terrain:h.terrain};});
   if(hit)arrowImpact(a,hit);
   if(hit){if(a.native){const report=serverBowImpact(hit.body,online.client);if(report)online.client.item(a.native.rep,'bow-hit',report);if(report&&hitNotifies(hit.body))hitNotification(browserOf(hit.point),false);if(hit.body)a.attached={body:hit.body,local:hit.body.motion.clone().invert().multiply(deployMatrix(a.position,a.rotation,{x:1,y:1,z:1}))};}
    else if(a.remote){if(hit.body)a.attached={body:hit.body,local:hit.body.motion.clone().invert().multiply(deployMatrix(a.position,a.rotation,{x:1,y:1,z:1}))};}
    else if(hit.body){if(hitNotifies(hit.body))hitNotification(browserOf(hit.point),false);hurtBody(hit.body,arrowDamage());}a.stuckUntil=t+20;if(!a.remote)lastShot={arrow:true,online:Boolean(a.native),body:hit.body?.name??null,time:t};}
   else if(a.done){if(a.native)online.client.item(a.native.rep,'bow-miss',{position:browserOf(a.position).toArray()});a.stuckUntil=t;}}
  if(a.attached&&!collisionWorld.bodies.includes(a.attached.body))a.stuckUntil=t;
  a.view.matrix.copy(a.attached?a.attached.body.motion.clone().multiply(a.attached.local):deployMatrix(a.position,a.rotation,{x:1,y:1,z:1}));a.view.matrixWorldNeedsUpdate=true;
  if(a.trail&&!a.done)a.trail.update(new THREE.Vector3().setFromMatrixPosition(a.view.matrix),t,camera);
  if(a.stuckUntil!==null&&t>=a.stuckUntil){removeArrow(a);arrows.splice(i,1);}}}
 function throwGrenade(w){const eyesU=unityOf(camera.getWorldDirection(new THREE.Vector3())).normalize(),key=w.assets.prefabs.throwObjectPrefab,p=deployManifest.prefabs[key],signal=!p.components.TimedGrenade&&Boolean(p.components.SignalGrenade),tg=p.components.TimedGrenade?.[0]??p.components.SignalGrenade?.[0],col=p.colliders.find(c=>c.type==='SphereCollider'),rb=p.components.Rigidbody?.[0]?.data;
  // HandGrenadeDataBlock.ThrowItem: eyes + forward * 0.5, LookRotation(up), forward * 20 m/s.
  const g=new ThrownGrenade(physicsEngine,p,{position:unityOf(camera.position).addScaledVector(eyesU,0.5),rotation:THROW_ROTATION,velocity:eyesU.clone().multiplyScalar(20),...thrownPhysics});
  g.view=prefabGroup(key);g.prefab=p;g.signal=signal;g.explosion=tg.explosion;g.bounceSound=tg.sounds?.bounceSound;grenades.push(g);w.slot.uses-=1;const inv=inventoryUI.inventory;if(w.slot.uses<=0)inv.slots[inv.selected]=null;inventoryUI.refresh();}
 // Sphere contact against solids and the terrain heightfield (Unity space in/out).
 function sphereContact(centerU,r){const c=browserOf(centerU);let best=null;const h=collisionWorld.sphereOverlap(c,r,b=>Boolean(b?.animal||b?.layer===26));if(h)best={normal:unityOf(h.normal),depth:h.depth};
  const gy=ground(c.x,c.z);if(c.y-r<gy){const d=gy+r-c.y;if(!best||d>best.depth)best={normal:unityOf(collisionWorld.terrainNormal(c.x,c.z)),depth:d};}return best;}
 function updateGrenades(dt){for(let i=grenades.length-1;i>=0;i--){const g=grenades[i],{boom,bounces}=g.step(dt);
  // ClientBounce: bounceSound.Play(rigidbody.position, 0.25, Random.Range(0.85, 1.15), 1, 18).
  for(let k=0;k<bounces.length;k++){playFile(deployBase+(g.bounceSound??''),g.bounceSound,browserOf(g.position),1,18,0.85+Math.random()*0.3,'linear',0.25);}
  g.view.matrix.copy(deployMatrix(g.position,g.rigid.rotation,g.prefab.rootScale??{x:1,y:1,z:1}));g.view.matrixWorldNeedsUpdate=true;
  // SignalGrenade.OnDone: no damage; the client's smoke at transform.position (LookRotation(up), 60 s) and the server's
  // SupplyDropZone.CallAirDropAt(rigidbody.position + (Range(-20,20), 75, Range(-20,20))).
  if(boom&&g.signal){scene.remove(g.view);grenades.splice(i,1);const at=g.position;g.dispose();showExplosion(at.clone(),g.explosion,{signal:true});lastExplosion={at:at.toArray(),hits:[],signal:offlineAirdrops?.signal(at.clone())??null};}
  // TimedGrenade.OnDone: the server's damage at rigidbody.position + 0.3 m up; the client's explosionEffect and the corpse
  // AddExplosionForce at rigidbody.position itself.
  else if(boom){scene.remove(g.view);grenades.splice(i,1);const point=g.explosionPoint,at=g.position;g.dispose();explode(point,g.explosionRadius,g.damage,{effect:g.explosion,effectAt:at});characterRenderer()?.explosionForce(at,g.explosionRadius);}}updateWorldFlares(dt);}
 // Offline thrown flares (offline-flare.mjs): WorldFlare_New with its parented FlareObj.lightPrefab (FlareLight3p: Shuriken
 // particles, the pooled fire light, its looping burn sound), destroyed 90 s after the throw.
 const mirrorZ=new THREE.Matrix4().makeScale(1,1,-1),browserMatrix=m=>mirrorZ.clone().multiply(m).multiply(mirrorZ);
 function poseWorldFlare(o){o.group.matrix.copy(browserMatrix(o.flare.matrix()));o.group.matrixWorldNeedsUpdate=true;const s=o.prefab.rootScale??{x:1,y:1,z:1};o.matrix.copy(browserMatrix(o.flare.lightMatrix(s)));
  const L=o.prefab.components.Light?.[0];if(L&&o.view.lightPosition)o.view.lightPosition.setFromMatrixPosition(o.matrix.clone().multiply(new THREE.Matrix4().fromArray(o.prefab.nodes[L.node].matrix)));if(o.view.audio)o.view.audio.position.setFromMatrixPosition(o.matrix);
  // FlareLight3p's AudioSource rolls off linearly (rolloffMode 1) between its 3 m and 20 m distances.
  const src=o.prefab.components.AudioSource?.[0]?.data;if(o.view.audio&&src&&o.view.audioModel!==o.view.audio){o.view.audio.setDistanceModel(src.rolloffMode===1?'linear':'inverse');o.view.audioModel=o.view.audio;}}
 function throwFlare(w){const key=w.assets.prefabs.throwObjectPrefab,p=deployManifest.prefabs[key],lightKey=p.components.FlareObj[0].light,lp=deployManifest.prefabs[lightKey];
  // TorchItemDataBlock.DoActualThrow: eyesOrigin + eyesAngles.forward to the server's ThrowFlare; Extinguish; Consume(1).
  const t=flareThrow(unityOf(camera.position),unityOf(camera.getWorldDirection(new THREE.Vector3()))),o={flare:new ThrownFlare(p,t.position,t.velocity,t.rotation,thrownPhysics),key,group:prefabGroup(key),prefab:lp??{name:'',components:{},nodes:[]},matrix:new THREE.Matrix4(),view:{},fire:{isOn:Boolean(lp)}};
  poseWorldFlare(o);if(lp){attachFireEffects(o);const L=lp.components.Light?.[0];if(L)o.view.lightDriver=lightDriver({fx:fx.manifest,prefabKey:lightKey,lightNode:L.node,lightData:L.data,startTime:fx.time});poseWorldFlare(o);}
  worldFlares.push(o);if(consumeOne(inventoryUI.inventory,w.slot))inventoryUI.refresh();}
 function updateWorldFlares(dt){for(let i=worldFlares.length-1;i>=0;i--){const o=worldFlares[i];
  // FlareObj.DestroyTime -> RigidObj.MakeDoneAndDestroy (OnDone does nothing for a flare).
  if(o.flare.step(dt,sphereContact)){o.flare.dispose();scene.remove(o.group);o.fire.isOn=false;disposeFireEffects(o.view);o.view.effects=[];worldFlares.splice(i,1);continue;}poseWorldFlare(o);}}
 // ExplosionHelper targets: animals, deployables, structure pieces and the player, by their collider bounds (Unity).
 const toUnityBox=b=>new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,-b.max.z),new THREE.Vector3(b.max.x,b.max.y,-b.min.z));
 function explosionTargets(except){const out=[];
  for(const a of wildlife.animals)if(!a.destroyed&&a.body?.box)out.push({id:a,body:a.body,bounds:toUnityBox(a.body.box),apply:types=>a.hurt(types,null)});
  // Collider.bounds: the body box without collision.mjs's 0.05 m margin. Objects without a TakeDamage (charges) are
  // surfaces whose Hurt fails, so they are left out.
  for(const o of [...deployables.objects,...structures.components])if(o!==except&&!o.destroyed&&o.takeDamage&&o.view?.body?.box)out.push({id:o,body:o.view.body,bounds:toUnityBox(o.view.body.box.clone().expandByScalar(-0.05)),apply:types=>o.hurt(types)});
  if(walk&&playerVitals.alive){const f=motor.feet;out.push({id:'player',body:null,bounds:toUnityBox(new THREE.Box3(new THREE.Vector3(f.x-0.4,f.y,f.z-0.4),new THREE.Vector3(f.x+0.4,f.y+motor.height,f.z+0.4))),apply:types=>playerTarget.hurt(types,null)});}
  return out;}
 // Surface.blocked: another collider lies between the blast point and the target along the ray.
 // ExplosionHelper.SurfaceForCollider: blocked only when the ray towards the bounds centre meets the target's own collider
 // within rayDistance (collider.Raycast) AND the nearest collider up to that hit (Physics.Raycast, all layers incl.
 // terrain) is a different one. The exploding object's collider is already disabled.
 let blastSkipBody=null;
 function occluded(pointU,dirU,dist,target){const ray=new THREE.Ray(browserOf(pointU),browserOf(dirU).normalize());
  if(!target.body){const hit=worldHit(ray,dist,b=>Boolean(b?.layer===26||b===blastSkipBody));return Boolean(hit)&&hit.distance<dist-0.5;}
  const own=collisionWorld.raycast(ray,dist,b=>b!==target.body);if(!own)return false;
  const first=worldHit(ray,own.distance,b=>Boolean(b?.layer===26||b===blastSkipBody));return Boolean(first)&&first.body!==target.body;}
 const explosionLights=Array.from({length:2},()=>{const l=new THREE.PointLight(0xffffff,0,20,1);scene.add(l);return {light:l,until:0};});
 function explode(pointU,radius,damage,{effect=null,carrier=null,except=null,effectAt=null,effectRotation=null}={}){
  blastSkipBody=except?.view?.body??null;
  const targets=explosionTargets(except),hits=carrier!==undefined&&except?timedExplosiveHits(pointU,radius,damage,targets,occluded,carrier):grenadeHits(pointU,radius,damage,targets,occluded);
  blastSkipBody=null;
  const name=id=>id==='player'?'player':id?.prefab?.name??id?.key??'?',before=hits.map(h=>h.target.id?.health);
  structures.deferring(()=>{for(const h of hits)h.target.apply(h.types);});
  showExplosion(effectAt??pointU,effect,{rotation:effectRotation});
  lastExplosion={at:pointU.toArray(),radius,damage,hits:hits.map((h,i)=>({id:name(h.target.id),damage:h.damage,distance:h.distance??null,blocked:h.blocked??false,carrier:Boolean(h.carrier),
   center:h.target.bounds.getCenter(new THREE.Vector3()).toArray(),healthBefore:before[i]??null,healthAfter:h.target.id?.health??null,destroyed:Boolean(h.target.id?.destroyed)}))};
  explosionLog.push(lastExplosion);if(explosionLog.length>16)explosionLog.shift();return hits;}
 const explosionLog=[];
 // StrikeGunDataBlock.Local_BeginStrikes: viewmodel "strike<n>" (PlayMode.StopAll) + strikeSounds[n-1] at the camera, pitch
 // Random.Range(0.96, 1.03); Local_CancelStrikes cross-fades back to idle in 0.15 s.
 function strikeEvent(w,ev){if(ev.type==='strike'){viewModels?.play('strike'+ev.strikes);playLocal(w.assets.strikeSounds?.[ev.strikes-1],1,ev.pitch);lastStrike={strikes:ev.strikes,time:resourceTime()};return true;}
  if(ev.type==='cancel'){viewModels?.crossFade('idle',0.15);lastStrike={cancelled:true,time:resourceTime()};return true;}return false;}
 let lastStrike=null;
 function showExplosion(pointU,effect,{signal=false,rotation=null,lifetime=null}={}){
  const p=deployManifest.prefabs[effect],at=browserOf(pointU);
  // ExplosionEffect (presentation-extras.mjs): the light fades from initialLightIntensity in 0.25 s, pitch 0.9-1, gone after 3 s.
  const t=resourceTime(),ee=explosionEffectFor(presentationManifest,effect);
  if(p){const root=new THREE.Matrix4().compose(at,rotation??(signal?new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2):new THREE.Quaternion()),new THREE.Vector3(1,1,1));for(const fx of fireEffects(p)){scene.add(fx.mesh);explosionFx.push({fx,root,until:lifetime!=null?t+lifetime:signal?t+60:ee?t+EXPLOSION_LIFETIME:Infinity});}
   const light=p.components.Light?.[0],L=light?.data,slot=explosionLights.find(s=>s.until<t)??explosionLights[0];
   if(L&&ee){slot.light.color.setRGB(L.m_Color.r,L.m_Color.g,L.m_Color.b);slot.light.distance=L.m_Range;slot.light.position.setFromMatrixPosition(root.clone().multiply(new THREE.Matrix4().fromArray(p.nodes[light.node].matrix)));Object.assign(slot,{effect:ee,start:t,until:t+EXPLOSION_LIGHT_FADE});slot.light.intensity=explosionLightIntensity(ee,0)*6;}
   else if(L){slot.light.color.setRGB(L.m_Color.r,L.m_Color.g,L.m_Color.b);slot.light.distance=L.m_Range;slot.light.position.copy(at);slot.light.intensity=L.m_Intensity*8;Object.assign(slot,{effect:null,until:t+0.4,peak:L.m_Intensity*8});}
   // The prefab's AudioSource (unity-audio.mjs), never SoundPool-culled: Explosion1 is played by ExplosionEffect.Start (pitch
   // Random.Range(0.9, 1), PlayOnAwake off; logarithmic 20..200 m, gone with Destroy(gameObject, 3)); SignalSmokeGreen plays on
   // awake and loops (logarithmic 1..30 m) until SignalGrenade.OnDone's Destroy(obj, 60); a disabled source (WoodPile_Death) is silent.
   const src=p.components.AudioSource?.[0],pitch=ee?explosionPitch():src?.data.m_Pitch??1,life=lifetime??(signal?60:ee?EXPLOSION_LIFETIME:null),plays=sourcePlaysOnInstantiate(src,{scripted:Boolean(ee)}),model=sourceDistanceModel(src?.data.rolloffMode),loop=Boolean(src?.data.Loop)&&life!=null;
   if(plays)playFile(deployBase+src.clip,src.clip,at,src.data.MinDistance??20,src.data.MaxDistance??200,pitch,model,src.data.m_Volume??1,{pool:false,loop,life});
   lastExplosionEffect={effect:ee?.prefab??null,pitch,light:Boolean(L),lightPeak:slot.light.intensity,sound:plays?{clip:src.clip,model,loop,life,min:src.data.MinDistance,max:src.data.MaxDistance}:null};}
  }
 let lastExplosionEffect=null;
 let lastExplosion=null,lastServerExplosion=null;
 function updateExplosionFx(dt){for(let i=explosionFx.length-1;i>=0;i--){const e=explosionFx[i];e.fx.update(dt,true,e.root,camera);if(e.fx.finished||resourceTime()>=e.until){scene.remove(e.fx.mesh);e.fx.dispose();explosionFx.splice(i,1);}}
  const t=resourceTime();for(const s of explosionLights)s.light.intensity=s.until<=t?0:s.effect?explosionLightIntensity(s.effect,t-s.start)*6:s.peak*(s.until-t)/0.4;}
 // TimedExplosive: the explosive charge ticks and explodes fuseLength after placement; its carrier takes the full damage.
 function updateCharges(t){
  for(const c of [...corpses])if(t>=c.until)removeCorpse(c); // DeployableCorpse.Awake: Invoke("NetDestroy", 300)
  // Online charges: TimedExplosive.Awake InvokeRepeating("TickSound", 0, 1) on every client until ClientExplode cancels it.
  for(const o of online?.worldObjects?.values()??[]){const te=o.timedExplosive;if(!te||o.exploded||t<o.nextTick)continue;o.nextTick=t+1;playFile(deployBase+(te.sounds?.tickSound??''),te.sounds?.tickSound,new THREE.Vector3().setFromMatrixPosition(o.matrix),3,20);o.ticks=(o.ticks??0)+1;}
  for(const o of [...deployables.objects]){const te=o.prefab.components.TimedExplosive?.[0];if(!te||o.destroyed)continue;
  o.fuseAt??=t+te.data.fuseLength;if(t>=(o.nextTick??0)&&t<o.fuseAt){o.nextTick=t+1;playFile(deployBase+(te.sounds?.tickSound??''),te.sounds?.tickSound,browserOf(o.position),3,20);}
  if(t>=o.fuseAt){const q=new THREE.Quaternion();o.matrix.decompose(new THREE.Vector3(),q,new THREE.Vector3());
   explode(timedExplosivePoint(o.position,o.rotation,o.prefab.rootScale),te.data.explosionRadius,te.data.damage,{effect:te.explosion,carrier:o.carrier??null,except:o,effectAt:o.position.clone(),effectRotation:q});o.destroy();}}}
 // One HumanController input sample for the held weapon.
 const serverFirearm=new ServerFirearm(),serverBow=new ServerBow(),serverThrowables=new ServerThrowables();
 function weaponAiming(t){const w=activeWeapon;if(w?.kind==='flare')return false;if(online&&w?.kind==='bow')return Boolean(w.state.aiming);if(online&&w?.kind!=='gun')return false;return Boolean(aimHeld&&w&&(w.kind!=='gun'||heldItemPreFrame(w.d,aimHeld,w.state.canAim(t)).aim))||Boolean(w?.kind==='bow'&&w.state.aiming);}
 function onlineWeaponFrame(attack,input){const t=resourceTime(),inv=inventoryUI.inventory,enabled=walk&&playerVitals.alive&&!inputBlocked(),gun=serverFirearm.held(inv,catalogue,d=>itemKeyByPath(d.ammoType?.m_PathID),weaponAssets,t,enabled),bow=serverBow.held(inv,catalogue,d=>itemKeyByPath(d.defaultAmmo?.m_PathID),weaponAssets,t,enabled),throwable=serverThrowables.held(inv,catalogue,weaponAssets,t,walk&&playerVitals.alive),w=gun??bow??throwable;activeWeapon=w;aim.sensitivity=1;if(!w||isBroken(w.slot))return;
  const sample={attack,aim:aimHeld,crouch:moveInput.crouch,sprinting:input.sprinting,reload:reloadHeld};
  if(w.kind==='gun'){const pre=heldItemPreFrame(w.d,aimHeld,w.state.canAim(t));sample.aim=pre.aim;aim.sensitivity=pre.sensitivity;if(pre.aim)aim.sway={d:w.d,crouch:sample.crouch};}
  if(throwable){for(const ev of serverThrowables.frame(w,t,{...sample,attack:attack&&!inputBlocked(),attack2:attack2&&!inputBlocked()})){
    if(ev.type==='pullpin'){viewModels?.play('pull_pin');playLocal(w.assets.sounds?.pullPinSound);}
    else if(ev.type==='ignite-animation')viewModels?.play('ignite');
    else if(ev.type==='ignite'){online.client.item(w.rep,'torch-toggle');if(w.kind==='flare')playLocal(w.assets.sounds?.StrikeSound);}
    else if(ev.type==='throw-animation')viewModels?.play('throw');
    else if(ev.type==='throw'){viewModels?.play('throw');viewModels?.playQueued('deploy');online.client.item(w.rep,'grenade-throw',{origin:camera.position.toArray(),velocity:camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(ev.strength).toArray()});}
    else if(ev.type==='flare-throw'){viewModels?.playQueued('deploy');online.client.item(w.rep,'torch-throw',{origin:camera.position.toArray(),forward:camera.getWorldDirection(new THREE.Vector3()).toArray()});}
   }return;}
  if(w.kind==='bow'){const r=w.state.frame(t,sample,w.inventory);w.state.aiming=r.aim;if(r.aim)aim.sensitivity=w.d.aimSensitivtyPercent;
   for(const ev of r.events){if(ev.type==='draw'){viewModels?.play('drawarrow');playLocal(w.assets.sounds?.drawArrowSound);}else if(ev.type==='tired')viewModels?.crossFade('tiredloop',5);else if(ev.type==='cancel'){viewModels?.crossFade('cancelarrow',0.15);playLocal(w.assets.sounds?.cancelArrowSound);}else if(ev.type==='noarrows')notice('No Arrows!');else if(ev.type==='fire'){viewModels?.play('fire_1');fireArrow(w,ev);}}return;
  }
  for(const ev of w.state.frame(t,sample,w.slot,w.inventory)){
   if(ev.type==='fire'){const silenced=weaponSilenced(w),range=ev.range*(silenced?0.75:1),rays=serverGunRays({...ev,range},camera,worldHit,online.client);online.client.item(w.rep,'bullet-fire',{hits:rays.map(r=>r.record)});
    for(const r of rays){if(r.hit?.body&&hitNotifies(r.hit.body))hitNotification(r.hit.position,!w.d.numPellets&&weaponAiming(t));
     if(w.d.numPellets==null&&r.hit?.body?.onlineActor&&isHeadshotPart(r.hit.body.bodyPart)&&w.assets.sounds?.headshotSound){playLocal(w.assets.sounds.headshotSound);feedbackLog.localHeadshots++;feedbackLog.lastHeadshot={remote:false,part:r.hit.body.bodyPart,file:w.assets.sounds.headshotSound};}}
    viewModels?.fire(t);localMuzzleFlash(w);headBob.addEffect(bobData.shotEffects[String(w.d._uniqueID)]);for(const r of rays){const rayB=new THREE.Ray(camera.position.clone(),r.end.clone().sub(camera.position).normalize());spawnTracer(tracerStart(w,rayB),tracerEnd(w,rayB,range,r.end),w.assets,range,silenced&&!w.d.numPellets);}recoil.add(ev.recoil.duration,ev.recoil.pitch,ev.recoil.yaw);playOwnFireSound(w,silenced);lastShot={online:true,hits:rays.filter(r=>r.record.target).length,body:rays[0]?.hit?.body?.name??null,time:t};}
   else if(ev.type==='reload'){online.client.item(w.rep,'bullet-reload');viewModels?.reload();playLocal(w.assets.sounds?.reloadSound);}
   else if(ev.type==='dryfire')playLocal(w.assets.sounds?.dryFireSound);
   else strikeEvent(w,ev);
  }
 }
 function weaponFrame(attack,input){aim.sway=null;if(online){onlineWeaponFrame(attack,input);return;}
  // A window (RPOS, chat, console, lock entry) does not put the held item away: HumanController (~421-447) still runs
  // InvokeInputItemPreFrame every frame with InputSample.Poll's empty sample (no attack, attack2, aim or reload), so
  // closing it neither restarts the deployLength lockout nor puts a bow away; a drawn arrow fires or cancels as on release.
  const t=resourceTime(),blocked=inputBlocked(),w=walk&&playerVitals.alive?heldWeapon():null;
  // A re-activation of the held item (inventory.activations: a mod attached to it) runs OnSetActive again, so the gun
  // waits its deployLength once more (WeaponItem.OnSetActive).
  const activation=inventoryUI.inventory.activations??0;
  if(w?.slot!==activeWeapon?.slot||(w&&activation!==activeWeaponActivation)){activeWeaponActivation=activation;if(activeWeapon?.kind==='bow')activeWeapon.state.deactivate(t);
   // TorchItem.OnHolstered: putting away a lit flare burns it out (Extinguish, Consume 1).
   if(activeWeapon?.kind==='flare'&&holsterFlare(activeWeapon.state)&&consumeOne(inventoryUI.inventory,activeWeapon.slot))inventoryUI.refresh();
   if(w)w.state.activate(t);activeWeapon=w;}
  if(w?.kind==='flare'&&devFlareRequest!==null){w.state.lit=devFlareRequest;if(!devFlareRequest)w.state.igniteAt=w.state.throwAt=w.state.secondaryAt=null;devFlareRequest=null;}
  aim.sensitivity=1;if(!w||isBroken(w.slot))return;const sample={attack:attack&&!blocked,attack2:attack2&&!blocked,aim:aimHeld&&!blocked,crouch:moveInput.crouch,sprinting:input.sprinting,reload:reloadHeld&&!blocked};
  // TorchItemDataBlock (client) + TorchItem.ItemPreFrame: strike / light / throw (FlareState, server-throwables.mjs).
  if(w.kind==='flare'){for(const ev of w.state.frame(t,sample)){if(ev.type==='ignite-animation')viewModels?.play('ignite');else if(ev.type==='ignite')playLocal(w.assets.sounds?.StrikeSound);
   else if(ev.type==='throw-animation')viewModels?.play('throw');else if(ev.type==='flare-throw'){viewModels?.playQueued('deploy');throwFlare(w);}}return;}
  if(w.kind==='gun'){const pre=heldItemPreFrame(w.d,sample.attack2,w.state.canAim(t));Object.assign(sample,{aim:pre.aim,attack2:pre.attack2});aim.sensitivity=pre.sensitivity;if(pre.aim)aim.sway={d:w.d,crouch:sample.crouch};
   for(const ev of w.state.frame(t,sample,w.slot,inventoryUI.inventory)){if(ev.type==='fire'){viewModels?.fire(t);fireGun(w,ev);}else if(ev.type==='dryfire')playLocal(w.assets.sounds?.dryFireSound);else if(ev.type==='reload'){viewModels?.reload();playLocal(w.assets.sounds?.reloadSound);inventoryUI.refresh();}else strikeEvent(w,ev);}}
  else if(w.kind==='bow'){const r=w.state.frame(t,sample,inventoryUI.inventory);w.state.aiming=r.aim;if(r.aim)aim.sensitivity=w.d.aimSensitivtyPercent;
   for(const ev of r.events){if(ev.type==='draw'){viewModels?.play('drawarrow');playLocal(w.assets.sounds?.drawArrowSound);}else if(ev.type==='tired')viewModels?.crossFade('tiredloop',5);else if(ev.type==='cancel'){viewModels?.crossFade('cancelarrow',0.15);playLocal(w.assets.sounds?.cancelArrowSound);}else if(ev.type==='noarrows')notice('No Arrows!');else if(ev.type==='fire'){viewModels?.play('fire_1');fireArrow(w,ev);inventoryUI.refresh();}}}
  else for(const ev of w.state.frame(t,sample)){if(ev.type==='pullpin'){viewModels?.play('pull_pin');playLocal(w.assets.sounds?.pullPinSound);}else if(ev.type==='throw'){viewModels?.play('throw');viewModels?.playQueued('deploy');throwGrenade(w);}}}
 function weaponHud(){const w=activeWeapon;if(!w)return null;const inv=inventoryUI.inventory;if(w.kind==='gun')return `${w.d.m_Name} ${(online?inv.slots[inv.activeSlot]:w.slot)?.uses??0}/${inv.count(w.state.ammoKey)}`;if(w.kind==='bow')return `Arrows ${inv.count(w.state.arrowKey)}`;return null;}
 // HumanController.ServerFrame (once per client move send, sendrate 5): footsteps and scent for wildlife.
 let lastServerFrame=0;
 // Original time of day (TOD_Sky + EnvironmentControlCenter). The sun and ambient take the original light values;
 // see browser/legacy-materials.mjs for how surfaces use them. Sky, fog colour and sea follow TOD in the render
 // step (sky.update / sky.applyFog / sea.beforeRender) because SampleFogColor depends on the camera direction.
 const tod=originalScene.manifest.world.tod?new TimeOfDay(originalScene.manifest.world.tod):null,dayBackground=new THREE.Color('#b8c6c5'),nightBackground=new THREE.Color('#0b0f17');
 function applyTimeOfDay(){if(!tod)return;const L=tod.lerpValue;
  // TOD_Sky.SetupLightSource drives the sun Light (colour, intensity) and RenderSettings.ambientLight (AmbientColor); the
  // original shaders (legacy-materials.mjs) read these in Unity units: flat ambient = hemisphere with equal colours.
  sun.color.copy(tod.lightColor);sun.intensity=tod.lightIntensity;const d=tod.lightDirection;sun.position.set(d.x*5000,d.y*5000,-d.z*5000);
  hemi.color.copy(tod.ambientColor);hemi.groundColor.copy(tod.ambientColor);hemi.intensity=1;
  if(!sky){scene.background.copy(nightBackground).lerp(dayBackground,Math.sqrt(L));scene.fog.color.copy(scene.background);}}
 applyTimeOfDay();
 const radiationZones=(originalScene.manifest.world.radiationZones??[]).map(z=>({...z,position:new THREE.Vector3(z.position[0],z.position[1],-z.position[2])}));
 // The held item the offline server sees (Inventory._activeItem still in its slot); a Torch starting to be held is
 // BasicTorchItem.OnSetActive(true) (torch-fuel.mjs).
 let torchFuelItem=null;
 const serverHeldItem=()=>{const inv=inventoryUI.inventory;return inv.selected>=0&&inv.activeItem&&inv.slots[inv.selected]===inv.activeItem?inv.activeItem:null;};
 function torchActivationFrame(t){const held=!online&&walk&&playerVitals.alive?serverHeldItem():null;if(held===torchFuelItem)return;torchFuelItem=held;if(held&&isTorch(catalogue.items[held.item]))torchActivated(held,t);}
 function playerServerFrame(t,input){if(online||!walk||!playerVitals.alive){lastServerFrame=t;return;}if(t-lastServerFrame<0.2)return;const frameDelta=lastServerFrame?t-lastServerFrame:0;lastServerFrame=t;
  // InventoryHolder.ServerFrame -> BasicTorchItem.ServerFrame: the held Torch burns a use per second; empty, it leaves its
  // slot (Inventory.RemoveItem; activeItemFrame then puts it away).
  // InventoryItem.Consume marks the slot dirty: the cell's uses label follows each burnt use.
  {const inv=inventoryUI.inventory,held=serverHeldItem();if(held&&isTorch(catalogue.items[held.item])){const uses=held.uses;if(torchServerFrame(held,t))inv.slots[inv.selected]=null;if(held.uses!==uses||!inv.slots[inv.selected])inventoryUI.refresh();}}
  // Radiation.CalculateExposure (radiation armour counts) applied per server frame; WaterLine drowning.
  metabolism.addRads(radiationExposure(radiationZones,playerTarget.position,playerVitals.armor[4])*frameDelta/60);
  const waterLine=originalScene.manifest.world?.waterLine??0;if(waterLine!==0&&playerTarget.position.y<=waterLine){selfDamage(hurtSelf(playerVitals,playerVitals.health*2));return;}
  // (drowning: TakeDamage.Hurt(idMain, idMain, health * 2) with a float, no armour)
  const pos=playerTarget.position,moving=Math.hypot(motor.velocity.x,motor.velocity.z)>0.1&&(input.forward||input.right);
  // Also sets Metabolism's target activity level: crouch 0.15, sprint 0.9, walk 0.4, still 0.
  let scent=10;metabolism.setTargetActivityLevel(0);if(moving){if(motor.crouched){metabolism.setTargetActivityLevel(0.15);scent=5;}else if(input.sprint){metabolism.setTargetActivityLevel(0.9);wildlife.audible(null,pos,10,'hearFootstep',pos);scent=30;}else {metabolism.setTargetActivityLevel(0.4);wildlife.audible(null,pos,5,'hearFootstep',pos);scent=20;}}
  wildlife.audible(null,pos,scent,'scent',playerTarget);}
 // Held melee tool (selected belt slot): original swing timing, 0.3 m sphere cast and gather rules.
 // Right-click item menu (Eat/Drink/Consume/Use) and belt keys for medical items, as ConsumableDataBlock/BasicHealthKitDataBlock.
 const itemStates=new Map();
 // Every RetreiveMenuOptions entry (Split, Study, Unload, Eat/Drink/Consume, Use incl. Blood Draw Kit): browser/item-menu.mjs.
 inventoryUI.setItemActions(createItemMenu({inventory:()=>inventoryUI.inventory,online:()=>Boolean(online),metabolism:()=>metabolism,body:()=>playerVitals,now:resourceTime,notice:text=>notice(text),onDamage:selfDamage,refresh:()=>inventoryUI.refresh(),states:itemStates,onItemEvent:(event,key)=>playItemEvent(event,key)}));inventoryUI.setNotice(text=>notice(text));
 // Belt keys offline (belt-use.mjs): InventoryHolder.BeltUse -> DoBeltUse -> OnBeltUse, played here as the server.
 // HeldItem.CanSetActivate(false) of the active item: melee, guns and bows only after their next attack time, a bow
 // also not while one of its arrows flies.
 function canPutAway(t){const inv=inventoryUI.inventory,slot=inv.slots[inv.selected];if(!slot)return true;if(catalogue.items[slot.item]?.class==='MeleeWeaponDataBlock')return melee.next<=t;
  const w=activeWeapon?.slot===slot?activeWeapon:null;if(w?.kind==='bow'&&arrows.some(a=>!a.remote&&!a.done))return false;return !(w?.kind==='gun'||w?.kind==='bow')||w.state.nextPrimaryAttackTime<=t;}
 // ResourceTypeItemDataBlock.UseItem: MeshBatchPhysics.SphereCast(eyesRay, 0.5, 4 m); the hit's RepairReceiver + TakeDamage.
 function repairTarget(){const eyes=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),a=collisionWorld.sphereSweep(eyes,0.5,4),b=collisionWorld.terrainSphereCast(eyes,0.5,4),hit=!a?b:!b?a:b.distance<a.distance?b:a;
  const o=hit?.body?.structure??hit?.body?.deployed,rr=o&&!o.destroyed?o.prefab?.components?.RepairReceiver?.[0]:null;return rr&&o.takeDamage?{object:o,repairAmmo:rr.repairAmmo,resForMaxHealth:rr.data.ResForMaxHealth,takeDamage:o.takeDamage}:null;}
 const resourceUseStates=new WeakMap();
 inventoryUI.setBeltUse(index=>{if(online||!playerVitals.alive)return null;const inv=inventoryUI.inventory,t=resourceTime(),run=i=>Boolean((inventoryUI.itemActions(i)??[]).find(a=>a.label!=='Split')?.run());
  return beltUse(inv,index,{canDeactivate:()=>canPutAway(t),useItem:run,study:run,
   repair:i=>{const slot=inv.slots[i],state=resourceUseStates.get(slot)??{},target=repairTarget();resourceUseStates.set(slot,state);if(resourceRepair(state,slot.item,target,t,text=>notice(text))==null)return false;
    target.object.system.onHurt?.(target.object);slot.uses-=1;if(slot.uses<=0)inv.slots[i]=null;inventoryUI.refresh();return true;},
   lockpick:i=>{const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),hit=worldHit(ray,5,triggerSkip),b=hit?.body;
    const text=lockpickNotice(hit&&{idBase:Boolean(b&&(b.structure||b.deployed||b.animal||b.crate||b.pickup||b.doorIndex!==undefined))});if(text)notice(text);}});});
 const catalogue=inventoryUI.inventory.catalogue,woodKey=Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name==='Wood');
 const melee=new MeleeGather(),noticeLog=document.querySelector('#notices'),notices=[];let fireHeld=false,fireClick=false,lastSwing=null;
 // Original PopupUI (popup-ui.mjs): notice.inventory -> PopupInventory; every other notice is Rust.Notice.Popup ->
 // notice.popup -> PopupNotice with the source's icon and duration (notices.mjs; online the server's command gives them).
 let popupUI=null;createPopupUI().then(ui=>{popupUI=ui;},e=>console.warn('PopupUI unavailable:',e.message));
 // notices: the QA log (explorerState.resources.notices); trimmed so a server flooding notices cannot grow it without bound.
 function notice(text,kind,{icon,seconds}={}){notices.push(text);if(notices.length>200)notices.splice(0,notices.length-100);if(kind==='inventory'&&popupUI){popupUI.inventory(text);return;}
  const style=noticeStyle(text);if(popupUI){popupUI.notice(seconds??style.seconds,icon??style.icon,text);return;}
  const p=document.createElement('p');p.textContent=text;noticeLog.append(p);setTimeout(()=>p.remove(),4000);while(noticeLog.children.length>5)noticeLog.firstChild.remove();}
 // HeldItem.CanSetActivate: a broken tool is never held.
 // Inventory.RemoveItem → DeactivateItem: the active item leaving its slot (moved, stacked away, tossed, used up) is put
 // away; heldWeapon/heldTool/viewModelFrame then see empty hands. Online the server's ITDE does it (server-inventory.mjs).
 // The client's own Metabolism as MeleeWeaponItem.PrimaryAttack reads it (GetCalorieLevel): the server's last
 // RecieveNetwork values; offline the offline server's last tick (Metabolism.shown).
 const clientMetabolism=()=>online?metabolism:metabolism.shown;
 function activeItemFrame(){if(!online&&inventoryUI.inventory.syncActive())inventoryUI.refresh();}
 function heldTool(){const inv=inventoryUI.inventory,slot=inv.slots[inv.selected],item=slot&&catalogue.items[slot.item];return item?.class==='MeleeWeaponDataBlock'&&canActivate(slot)?{key:slot.item,data:item.data}:null;}
 // InventoryItem.TryConditionLoss on the offline inventory (item-condition.mjs): the active item breaking is put away with
 // the original popup, a nearly worn-out item (maxCondition < 0.15) may be destroyed, broken armour leaves its slot.
 function conditionContext(index){const inv=inventoryUI.inventory;return {active:index===inv.selected,notice:(icon,text)=>notice(text,null,{icon}),deactivate:()=>inv.deactivate(),
  drop:(slot,i)=>{const direction=unityOf(camera.getWorldDirection(new THREE.Vector3()));try{droppedItems.toss(inv,i,unityOf(camera.position),direction);}catch(e){console.warn(e);}}};}
 function conditionLoss(index,probability,percentLoss){if(index<0)return null;const r=itemConditionLoss(inventoryUI.inventory,index,probability,percentLoss,conditionContext(index));if(r)inventoryUI.refresh();return r;}
 const serverMelee=new ServerMelee();
 function onlineMeleeFrame(sprinting,attack){const t=resourceTime(),w=serverMelee.held(inventoryUI.inventory,catalogue,weaponAssets,t,walk&&playerVitals.alive);if(!w)return;
  for(const ev of w.state.frame(t,{attack:attack&&!inputBlocked(),attack2:attack2&&!inputBlocked(),sprinting,starving:clientMetabolism().caloricLevel<=0})){
   if(ev.type==='swing'){online.client.item(w.rep,'melee-swing');viewModels?.fire(t);}
   else if(ev.type==='sound')playLocal(w.assets.sounds?.swingSound,1,0.85+Math.random()*0.15);
   else{const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),hit=serverMeleeCast(collisionWorld,ray,w.d.range,(c,r)=>online.playerRenderer?.hitBroadphase?.(c,r)??null),record=serverMelee.record(hit,ray,w.d.range,online.client,t,w.d,notice);online.client.item(w.rep,'melee-hit',record);if(hit?.body&&hitNotifies(hit.body))hitNotification(hit.point,false);
    playMeleeImpact(hit,ray,w.d.range,w.assets.sounds,w.assets.prefabs);
    if(onlinePullOut(hit?.body,record))viewModels?.crossFade('pull_out',0.05,1.1);
    lastSwing={online:true,kind:record.target?'network':hit?.body?.isTree?'tree':hit?'world':'miss',target:record.target??null,point:record.point,treeAllowed:record.flag,time:t};
   }
  }
 }
 // MeleeWeaponDataBlock.DoMeleeEffects (client side, any cast hit): a tree plays impactSoundWood, anything else the SurfaceInfo
 // melee effect's EffectSoundPlayer clip (terrain via SurfaceInfoTerrain, actors/prefabs via their SurfaceInfo, else default).
 // The effect prefab is instantiated at the hit with Quaternion.LookRotation(normal) (Unity +Z, browser -Z, along the normal):
 // WoodImpact (impactEffectWood) for 1.5 s, else the random SurfaceInfoObject.meleeEffects prefab for 1 s (SurfaceInfo.DoImpact),
 // each with its EffectSoundPlayer clip; a tree also plays impactSoundWood.
 let lastMeleeImpact=null;
 function playMeleeImpact(hit,ray,range,sounds,prefabs){if(!hit)return null;const body=hit.body??null,terrain=!body&&Boolean(hit.terrain||collisionWorld.raycastTerrainOnly(ray,range+0.35));
  const impact=meleeImpact({tree:Boolean(body?.isTree),point:hit.point.toArray(),body,terrain},{sounds,prefabs,surfaceFor:tracerEffects.surfaceFor,manifest:deployManifest});if(!impact)return null;
  const normal=(hit.normal??ray.direction.clone().negate()).clone().normalize(),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),normal);
  const fx=impact.effect?tracerEffects.impact(impact.effect,hit.point.clone(),rotation,impact.life):null;
  if(fx&&impact.kind==='surface')impact.sound=fx.sound?{...impact.sound,file:fx.sound}:null;
  else if(impact.sound)playFile(deployBase+impact.sound.file,impact.sound.file,hit.point.clone(),impact.sound.min,impact.sound.max);
  lastMeleeImpact={kind:impact.kind,surface:impact.surface,effect:impact.effect,life:impact.life,particles:fx?.particles??0,effectSound:fx?.sound??null,sound:impact.sound?.file??null,point:hit.point.toArray()};return impact;}
 function meleeFrame(sprinting,attack){if(online){onlineMeleeFrame(sprinting,attack);return;}const t=resourceTime(),tool=heldTool();
  // MeleeWeaponItem.OnSetActive: changing the held item clears the queued mid-swing and swing sound; equipping one also
  // waits its deployLength (WeaponItem.OnSetActive), as MeleeState online.
  const toolSlot=tool?inventoryUI.inventory.slots[inventoryUI.inventory.selected]:null;
  if(toolSlot!==melee.heldSlot){melee.heldSlot=toolSlot;if(tool)melee.activate(t,tool.data);else melee.cancelQueued();}
  if(!walk||!tool||inputBlocked()||!playerVitals.alive)return;
  if(melee.frame(t,{attack,attack2,sprinting,starving:clientMetabolism().caloricLevel<=0},tool.data,tool.key))viewModels?.fire(t);
  const swingSound=melee.dueSwingSound(t),swingClip=swingSound&&meleeSwingSound(weaponAssets[swingSound.toolKey]?.sounds);if(swingClip)playLocal(swingClip.file,swingClip.volume,swingClip.pitch);
  const swing=melee.dueSwing(t);if(!swing)return;
  const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3()));
  const hit=collisionWorld.physics2SphereCast(ray,0.3,swing.tool.range);if(hit?.body&&hitNotifies(hit.body))hitNotification(hit.point,false);const result=melee.resolve(t,swing.tool,swing.toolKey,hit,inventoryUI.inventory,woodKey,motor.feet,notice,playerTarget);
  // MeleeWeaponDataBlock.DoAction1: each swing costs caloriesPerSwing * Random.Range(0.8, 1.2), after the 6 m entity check
  // (a swing it rejects there costs nothing).
  if(!result.far)metabolism.subtractCalories(swing.tool.caloriesPerSwing*(0.8+Math.random()*0.4));
  const impact=playMeleeImpact(hit,ray,swing.tool.range,weaponAssets[swing.toolKey]?.sounds,weaponAssets[swing.toolKey]?.prefabs);
  // MeleeWeaponDataBlock.DoAction1: a hit on a network entity (deployable, structure, animal, resource, crate, sack,
  // supply crate, pickup) within 6 m wears the tool (resources.mjs meleeWears).
  if(meleeWears(result)){const inv=inventoryUI.inventory;if(inv.slots[inv.selected]?.item===swing.toolKey)conditionLoss(inv.selected,...CONDITION_LOSS.melee);}
  if(offlinePullOut(result))viewModels?.crossFade('pull_out',0.05,1.1);
  lastSwing={kind:result.kind,gathered:result.gathered??null,time:t,impact:impact&&{kind:impact.kind,surface:impact.surface,sound:impact.sound?.file??null}};if(result.kind!=='miss')inventoryUI.refresh();}
 // ContextProbe: eyes ray of the recovered CharacterContextProbeTrait length; first solid hit decides the target.
 const useRange=playerConfig.traits.CharacterContextProbeTrait.data._rayLength,useHint=document.querySelector('#use-hint'),useRay=new THREE.Ray();
 let useTarget=null,onlineContext=null,contextUI=null;
 // Context targets: {contextText(), use(eyes, ms)} (IContextRequestableQuick) and, for Quick|Menu objects, menu() /
 // menuAction(text). Scene doors are BasicDoor: Quick|Menu with the single Open/Close option (no lock, no owner).
 const doorTargets=doors.map(door=>({kind:'door',index:door.index,contextText:()=>door.contextText(),textPoint:()=>doorTextPoint(door,THREE.Vector3),use:(eyes,now)=>door.use(eyes??camera.position,now??clock()),
  menu:()=>doorMenu({lock:null,isOwner:false,open:door.on,userId:'local'}),menuAction:action=>{
   // BasicDoor.ContextRespondMenu: Open/Close only when it changes the state; Enter Code sends lockentry.show false (no
   // PasswordLockableObject here, so lockentry.passwordentry then finds nothing to unlock).
   if(action==='Open'||action==='Close')return (action==='Open')===door.on?false:door.use(camera.position,clock());
   if(action==='Enter Code'){lockEntry.show(false,()=>{});return true;}return false;}}));
 // ContextProbe.ClientCheckUse on server entities: only Contextual objects (doors, LootableObject, FireBarrel/Furnace,
 // SleepingBag) are highlighted, with their client ContextText; structures and resource nodes have no Contextual.
 function onlineEntityTarget(body){const o=body.worldObject,kind=contextKind(o?.prefab);if(!kind)return null;
  const looterName=()=>online?.playerClients.get(o.looter)?.name??null,creator=()=>online?.entityCalls.get(o.key)?.get('GetOwnerInfo')?.args?.[0]??0;
  return {kind:'online',online:body.online,contextText:()=>kind==='door'?o.door?.contextText()??'':kind==='loot'?lootContextText(o.looter,looterName()):kind==='fire'?fireContextText(o.looter,looterName()):
    online?.localUserId!=null&&String(online.localUserId)===String(creator())?'Pick Up':'',
   textPoint:()=>kind==='door'?doorTextPoint(o.door,THREE.Vector3):kind==='loot'?lootTextPoint(o.group,THREE.Vector3):spriteTextPoint(o.group,THREE.Vector3)};}
 function probe(){if(!walk||inputBlocked())return null;camera.getWorldDirection(useRay.direction);useRay.origin.copy(camera.position);const hit=collisionWorld.rayHit(useRay,useRange);if(!hit||hit.distance>useRange)return null;if(hit.body?.online)return hit.body.onlineTarget??onlineEntityTarget(hit.body);if(hit.body?.doorIndex!==undefined)return doorTargets[hit.body.doorIndex];return hit.body?.pickup?.target??hit.body?.crate?.target??hit.body?.deployed?.target??null;}
 // Original ContextUI (context-ui.mjs): Context.ButtonDown -> BeginQuery (Context:A), ButtonUp -> EndQuery (quick tap
 // B within 300 ms, else cancel D); the server's menu shows (after the Invoke delay) while WorldUse is held, with the
 // cursor unlocked without resetting input, and a click sends the choice (C). Offline the island answers as the server.
 createContextUI().then(ui=>{contextUI=ui;ui.render(activeContext());}).catch(e=>console.warn('ContextUI unavailable:',e.message));
 // The browser can also be left with a free cursor and no window open (Escape / release key): the menu only relocks a
 // cursor it freed itself.
 let contextFreedCursor=false;
 const contextHooks={unlock:()=>{contextFreedCursor=document.pointerLockElement===canvas;gameControls?.release({keepInput:true});},onChange:()=>contextUI?.render(activeContext()),
  // clientUnlock.TryLock: relock unless something else keeps the cursor free (a page needs a recent user gesture).
  tryLock:()=>{const freed=contextFreedCursor;contextFreedCursor=false;if(!freed||(navigator.userActivation&&!navigator.userActivation.isActive))return false;return Boolean(gameControls?.capture());}};
 const offlineContext=new ContextClient({...contextHooks,send:offlineContextServer({reply:(name,values)=>offlineContext.reply(name,values,clock()),eyes:()=>camera.position.clone(),now:clock})});
 const activeContext=()=>onlineContext?.working?onlineContext:offlineContext.working||!onlineContext?offlineContext:onlineContext;
 const contextMenuOpen=()=>Boolean(offlineContext.enabled||onlineContext?.enabled);
 function useKey(down){const now=clock();
  // ContextProbe.Update: ButtonUp ends the query whatever else is open.
  if(!down){offlineContext.release(now);onlineContext?.release(now);return;}
  if(!walk||inputBlocked()||!useTarget)return;unlockAudio();
  if(useTarget.online)onlineContext?.press(useTarget.online,now);else offlineContext.press(useTarget,now);}
 // Death / UI takeovers end a running query like a released key.
 function closeContextMenu(){const now=clock();offlineContext.release(now);onlineContext?.release(now);}
 let yaw=0,pitch=-0.3,walk=false,lastTrees=new THREE.Vector3(Infinity,0,Infinity),visible=0;
 // GameInput (key-bindings.mjs): btn(name) = GameButton.IsDown as HumanController.InputSample.Poll reads it: the sample is
 // default (nothing held) while the console, main menu, chat or lock entry is up, or the cursor is unlocked (RPOS, the
 // context popup), and a dead body polls nothing; the keys themselves stay held (Input.GetKey), so W/Shift held through a
 // window move again the moment it closes. keys.clear() (dev teleports only) releases every held key and mouse button.
 const sampleDefault=()=>inputBlocked()||contextMenuOpen()||(walk&&!playerVitals.alive);
 const keys={clear:()=>gameInput.clear()},btn=name=>!sampleDefault()&&gameInput.isDown(name),dummy=new THREE.Object3D();
 // GameTip name tags (name-tags.mjs) for remote players: GameTip node under the animated pelvis, + positionOffset; shown while
 // the body is in the camera frustum, within 20 m and with a clear line of sight (own hitboxes and the last .5 m excepted).
 const nameTags=createNameTagLayer(),tipLocal=new THREE.Matrix4().compose(new THREE.Vector3(...GAME_TIP.node.position),new THREE.Quaternion(...GAME_TIP.node.rotation),new THREE.Vector3(...GAME_TIP.node.scale));
 const tipFrustum=new THREE.Frustum(),tipSphere=new THREE.Sphere(),tipM=new THREE.Matrix4(),tipP=new THREE.Vector3(),tipQ=new THREE.Vector3(),tipRay=new THREE.Ray();let pelvisBone=-1;
 function nameTagFrame(){const views=online?.playerRenderer?.views,tips=[];
  if(views&&!frontEnd?.menuVisible()){if(pelvisBone<0)pelvisBone=views.values().next().value?.bones.findIndex(b=>/_RustPlayer_Pelvis$/.test(b.name))??-1;
   tipFrustum.setFromProjectionMatrix(tipM.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
   for(const [id,v] of views){if(typeof id!=='number'||pelvisBone<0)continue;const name=online.remote.get(id)?.userName??GAME_TIP.text;
    // Bones are Unity-space under the reflected root: world = pelvis.matrixWorld * node local, back through H for the point.
    tipP.setFromMatrixPosition(tipM.multiplyMatrices(v.bones[pelvisBone].matrixWorld,tipLocal));const d=tipP.distanceTo(camera.position);if(d>GAME_TIP.maxDistance)continue;
    tipSphere.center.setFromMatrixPosition(v.root.matrix);tipSphere.center.y+=0.9;tipSphere.radius=1.1;if(!tipFrustum.intersectsSphere(tipSphere))continue; // OnWillRenderObject: body drawn
    tipQ.copy(tipP).add(new THREE.Vector3(...GAME_TIP.testOffset));tipRay.origin.copy(camera.position);tipRay.direction.copy(tipQ).sub(camera.position).normalize();
    if(GAME_TIP.lineOfSight&&lineOfSightBlocked(collisionWorld.raycast(tipRay,d),d,h=>h.body?.onlineActor?.viewId===id))continue;
    tipQ.copy(tipP).add(new THREE.Vector3(...GAME_TIP.positionOffset)).project(camera);if(tipQ.z>1||tipQ.z<-1)continue;
    tips.push({target:id,text:name,screenX:(tipQ.x+1)/2*innerWidth,screenY:(1-tipQ.y)/2*innerHeight,alpha:tipAlpha(d),scale:tipScale(d,camera.fov),color:GAME_TIP.textColor});}}
  nameTags.frame(tips);}
 function reset(){walk=false;camera.position.set(-700,ground(-700,900)+850,900);yaw=0;pitch=-0.45;document.querySelector('#mode').textContent='Enter walk mode';}
 reset();
 const locationSelect=document.querySelector('#location');
 originalScene.locations.forEach((place,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${place.name} · ${place.pathID}`;locationSelect.append(option);});
 function visitLocation(index){const place=originalScene.locations[index];if(!place)return;const [lo,hi]=place.bounds;const center=new THREE.Vector3(...lo).add(new THREE.Vector3(...hi)).multiplyScalar(0.5),extent=Math.max(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2],20);camera.position.copy(center).add(new THREE.Vector3(extent*0.8,extent*0.65,extent*1.25));camera.position.y=Math.max(camera.position.y,ground(camera.position.x,camera.position.z)+12);const direction=center.clone().sub(camera.position).normalize();yaw=Math.atan2(-direction.x,-direction.z);pitch=Math.asin(direction.y);walk=false;document.querySelector('#mode').textContent='Enter walk mode';lastTrees.set(Infinity,0,Infinity);}
 locationSelect.onchange=()=>{if(locationSelect.value!=='')visitLocation(Number(locationSelect.value));};locationSelect.disabled=false;
 function showOriginalCompound(){reset();const index=originalScene.locations.findIndex(p=>p.name==='Warehouse1');if(index>=0){visitLocation(index);locationSelect.value=String(index);}}
 showOriginalCompound();
 function updateTrees(){trees.update(camera);visible=trees.visibleCount;lastTrees.copy(camera.position);}
 // Context.ButtonDown/ButtonUp read the InputManager "WorldUse" button (e / mouse 2), not the rebindable Use GameButton.
 gameInput.addEventListener('axis-press',e=>{if(e.detail.axis==='WorldUse')useKey(true);});gameInput.addEventListener('axis-release',e=>{if(e.detail.axis==='WorldUse')useKey(false);});
 const canvas=renderer.domElement;let dragging=false;canvas.addEventListener('pointerdown',e=>{if(inputBlocked()||document.pointerLockElement===canvas)return;dragging=true;canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);addEventListener('pointermove',e=>{if(!inputBlocked()&&(dragging||document.pointerLockElement===canvas)){const look=devMode?0.002:lookRadiansPerCount(convars.get('input.mousespeed')),flip=convars.get('input.flipy')?-1:1;yaw-=e.movementX*look*aim.sensitivity;pitch=THREE.MathUtils.clamp(pitch-flip*e.movementY*look*aim.sensitivity,playerConfig.player.data._minPitch*Math.PI/180,playerConfig.player.data._maxPitch*Math.PI/180);}});
 // Mouse buttons on the game view are GameInput keys Mouse0..Mouse4 (default binds: Fire Mouse0, AltFire Mouse1).
 // Right-click uses items in game, so the browser's own menu never opens on the game page, except in text boxes (chat).
 document.addEventListener('contextmenu',e=>{if(!e.target?.closest?.('input,textarea,[contenteditable]'))e.preventDefault();});for(const t of ['mousedown','mouseup'])canvas.addEventListener(t,e=>{if(e.button>=3)e.preventDefault();}); // Mouse3/4 are keys, not browser back/forward
 // HumanController.Poll: Flashlight / Laser toggle on GameButton IsPressed (saved.GetLamp / GetLaser).
 gameInput.addEventListener('press',e=>{const name=e.detail.button;if((name!=='Flashlight'&&name!=='Laser')||inputBlocked()||!walk||!playerVitals.alive)return;const flags=activeModUIDs().reduce((bits,uid)=>bits|(modFlagsByUID.get(uid)??0),0);
  if(name==='Flashlight'&&(flags&1)){lampSetting=!lampSetting;try{localStorage.setItem('rlb-lamp',lampSetting?'1':'0');}catch{}}
  if(name==='Laser'&&(flags&2)){laserSetting=!laserSetting;try{localStorage.setItem('rlb-laser',laserSetting?'1':'0');}catch{}}});
 canvas.addEventListener('wheel',e=>{if(walk&&heldStructure()){e.preventDefault();turn90(e.deltaY<0?1:-1);}},{passive:false});
 // Captured: a press is held until released. Free cursor: the left button drags the view (?dev fly mode) and a short
 // click is one tap of Mouse0; other buttons press as usual.
 let pressAt=null;canvas.addEventListener('pointerdown',e=>{const code=mouseKeyCode(e.button);if(!code)return;if(document.pointerLockElement===canvas||e.button!==0)gameInput.press(code,e);else pressAt={x:e.clientX,y:e.clientY};});
 addEventListener('pointerup',e=>{if(e.button!==0)return;if(pressAt&&Math.hypot(e.clientX-pressAt.x,e.clientY-pressAt.y)<5&&!gameControls?.willCapture())gameInput.tap('Mouse0');pressAt=null;});
 // ConsoleSystem.RunCommand_Clientside: the client's own [Client] commands (null: not one of them).
 function localConsoleCommand(line){return clientCommands.command(line)??chat?.command(line)??convars.command(line)??renderCommand(line,{refresh:()=>renderRefresh?.(),flushTrees:()=>trees.refreshImposters()})??gameInput.bindings.command(line,renderStore);}
 // global.suicide [User] (server global.cs): TakeDamage.Kill(character, character), so DeathTransfer reports the self kill.
 function offlineUserCommand(line){const name=String(line??'').trim().split(' ')[0].toLowerCase();if(name!=='suicide'&&name!=='global.suicide')return null;
  if(!walk||!playerVitals.alive)return {ok:true,text:'You dead!'};selfDamage(hurtSelf(playerVitals,Infinity));return {ok:true,text:'You suicided!'};}
 // Pointer capture/release reset the latched fire/aim state; held keys stay held (LockCursorManager only ResetInputAxes).
 const clearControls=()=>{fireHeld=fireClick=attack2=aimHeld=reloadHeld=false;devAttackUntil=0;pressAt=null;dragging=false;};
 gameControls=await createGameControls({canvas,settings:renderSettings,canPlay:()=>playerVitals.alive,blocked:()=>contextMenuOpen()||inventoryUI.isOpen()||lockEntry.isOpen()||Boolean(frontEnd?.menuVisible())||Boolean(chat?.isOpen()),onEscapeKey:frontEnd?()=>frontEnd.escapeKey():null,command:(line,{trusted=false,raw=line}={})=>{const local=localConsoleCommand(line);if(local)return local;
  // Offline the page is the server: its [Admin] airdrop.drop / airdrop.min_players answer here (online they are forwarded).
  if(!online){const a=offlineAirdrops?.command(line)??offlineUserCommand(line);if(a)return a;}
  // ConsoleWindow.RunCommand: what the client does not run itself goes to the server as typed (online only, typed input only).
  const forward=online?.state==='in-game'?forwardableConsoleText(raw,{trusted}):null;if(forward!==null){online.client.rpc(997,'SV_RunConsoleCommand',[forward]);return {ok:true,text:''};}
  // A blank line: the server's RunCommand_Serverside fails on it and answers nothing.
  if(line.trim()==='')return {ok:true,text:''};
  return renderSettings.command(line);},onCapture:clearControls,onRelease:clearControls,bootConsole});
 localRoute=localConsoleCommand;
 document.querySelector('#options-toggle').onclick=()=>gameControls.showSettings();
 document.querySelector('#look').onclick=()=>gameControls.capture();document.querySelector('#reset').onclick=showOriginalCompound;
 document.querySelector('#mode').onclick=()=>{walk=!walk;keys.clear();if(walk){const floor=collisionWorld.support(camera.position.x,camera.position.z,camera.position.y,ground(camera.position.x,camera.position.z)-1);motor.teleport(new THREE.Vector3(camera.position.x,(floor?.height??ground(camera.position.x,camera.position.z))+0.002,camera.position.z),{settle:true});camera.position.copy(motor.cameraPosition());pitch=0;}document.querySelector('#mode').textContent=walk?'Enter fly mode':'Enter walk mode';};
 document.querySelectorAll('button').forEach(b=>b.disabled=false);
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;if(viewModels)viewModels.camera.aspect=camera.aspect;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
 // Offline item event sounds (item-events.mjs) and the ClientVitalsSync heal path; then HUDIndicator.Step, LocalDamageDisplay
 // overlays (GameFullscreen) and the indicator layer over the finished frame.
 let lastOfflineItemEvent=null,equipBaseline=null,equipInventory=null;
 function playItemEvent(event,key){if(online)return;const file=itemEventSound(deployManifest.itemSounds,key,event);lastOfflineItemEvent={event,item:catalogue.items[key]?.data.m_Name??null,file};if(file)playLocal(file,1);}
 function combatFeedbackFrame(){
  if(!online){if(feedbackVitals!==playerVitals){feedbackVitals=playerVitals;combatFeedback?.reset(playerVitals.maxHealth);vitalsSender=new VitalsSender();sentHealth=playerVitals.health;bleedAttacker=undefined;fallbackHealth=null;}
   if(walk&&playerVitals.alive&&playerVitals.health>sentHealth+1e-9&&vitalsSender.repair(playerVitals.health))clientHealthChange(playerVitals.health,null);sentHealth=playerVitals.health;
   const inv=inventoryUI.inventory,snap=equipmentSnapshot(inv.slots);inv.onItemEvent=playItemEvent;
   if(equipInventory===inv&&equipBaseline)for(const e of equipmentEvents(equipBaseline,snap))playItemEvent(e.event,e.key);equipBaseline=snap;equipInventory=inv;}
  if(combatFeedback){combatFeedback.frame(camera,walk&&playerVitals.alive);combatFeedback.render();}}
 let last=performance.now(),frames=0,stateHooked=false,lastHint='';
 let fpsSmooth=0,fpsPrev=null;
 // CameraFX.PostPreCull (after LazyCam/HeadBob moved the camera): the PlayerCamera's AdaptiveNearPlane while playing
 // (adaptive-near-plane.mjs). Candidates: colliders whose bounds touch the eye sphere, minus layers 16 and 17 (the
 // port's hit-box shapes are layer 17); the static scene has no per-collider bounds here, so all of it is a candidate.
 // Dev free-fly keeps 0.05 m; a dead player's camera keeps the near plane it had (death camera).
 const nearMask=adaptiveNearMask(),nearRadius=ADAPTIVE_NEAR_PLANE.minNear+ADAPTIVE_NEAR_PLANE.maxNear;let nearState={near:0.05,hits:0,nearest:null};
 function adaptNearPlane(){if(walk&&!playerVitals.alive)return;let near=0.05;const t0=performance.now();
  if(walk){camera.updateMatrixWorld();const eye=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld),ray=new THREE.Ray();
   const skip=b=>Boolean(b&&(b.bodyPart!=null||(b.layer!=null&&!((nearMask>>>b.layer)&1))||(b.box&&!boundsTouchSphere(b.box,eye,nearRadius))));
   // One triangle gather over the segments' bounds, then each segment against those triangles and the terrain.
   let triangles=[];const area=new THREE.Box3(),point=new THREE.Vector3();
   nearState=adaptiveNearPlane(camera,(origin,direction,length)=>{ray.origin.fromArray(origin);ray.direction.fromArray(direction);let best=null;
    for(const t of triangles){const hit=ray.intersectTriangle(t.a,t.b,t.c,true,point);if(hit){const d=hit.distanceTo(ray.origin);if(d<=length&&(best==null||d<best))best=d;}}
    const land=terrainRay(ray,best??length);return land&&(best==null||land.distance<best)?land.distance:best;},ADAPTIVE_NEAR_PLANE,(lo,hi)=>{area.min.fromArray(lo);area.max.fromArray(hi);triangles=collisionWorld.bodyTriangles(area,skip).map(e=>e.triangle);});near=nearState.near;}
  else nearState={near,hits:0,nearest:null};
  nearState.ms=performance.now()-t0;if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}}
 function animate(now){if(aerialHold||!frameLimiter.shouldRun(now)){requestAnimationFrame(animate);return;} // render.frames (Application.targetFrameRate)
 const dt=Math.min((now-last)/1000,0.05),worldDt=Math.min((now-last)/1000,1/3);last=now;const speed=220*(btn('Sprint')?3:1)*dt; // worldDt: Unity's deltaTime (default maximum timestep 1/3 s) for the world clocks (EnvironmentControlCenter, TOD_Animation, Water4, AmbientAudioPlayer, MusicPlayer); the 0.05 s cap is only for movement and physics
 inventoryUI.update(now);if(inputBlocked()&&document.pointerLockElement)document.exitPointerLock();
 // HumanController.InputSample.Poll: Up/Down/Right/Left, Jump, Duck, Sprint, Fire, AltFire, Reload GameButtons.
 fireHeld=btn('Fire');attack2=aimHeld=btn('AltFire');reloadHeld=btn('Reload')||performance.now()<devReloadUntil;if(!sampleDefault()&&gameInput.isPressed('Fire'))fireClick=true;
 const forward=Number(btn('Up'))-Number(btn('Down')),right=Number(btn('Right'))-Number(btn('Left'));
 // HumanController.UpdateInput: one sample for the held item (ItemPreFrame: aim, is_sprinting fire lockout) and the
 // motor (ProcessInput), with the original sprint cancels and MovementScale (crafting x0.5, leg injury x0.5).
 moveInput=humanInputSample({forward,right,sprint:btn('Sprint'),crouch:btn('Duck'),jump:btn('Jump'),attack2},{crafting:Boolean(inventoryUI.inventory.work),injured:legInjury>0});
 moveInput.aim=walk&&playerVitals.alive&&weaponAiming(resourceTime());
 if(walk){motor.update(dt,moveInput,yaw);yaw+=motor.takeYawDelta();camera.position.copy(motor.cameraPosition());fallFrame();}
 else {const norm=Math.max(1,Math.hypot(forward,right));camera.position.x+=(-Math.sin(yaw)*forward+Math.cos(yaw)*right)*speed/norm;camera.position.z+=(-Math.cos(yaw)*forward-Math.sin(yaw)*right)*speed/norm;
 camera.position.x=THREE.MathUtils.clamp(camera.position.x,-7999,7999);camera.position.z=THREE.MathUtils.clamp(camera.position.z,-7999,7999);
 camera.position.y=Math.max(ground(camera.position.x,camera.position.z)+3,camera.position.y+(sampleDefault()?0:Number(gameInput.state.isHeld('E'))-Number(gameInput.state.isHeld('Q')))*speed);}
 camera.rotation.set(pitch,yaw,0,'YXZ');camera.updateMatrixWorld();
 contextSprites?.update(camera,dt,{hidden:inventoryUI.isOpen()}); // RPOS.hideSprites while the inventory is open
 const doorTime=clock();for(const door of doors){door.update(doorTime);if(door.changed)applyDoor(door);}loot.update(lootTime(),walk?motor.feet:camera.position);resources.update(resourceTime());{const attack=fireHeld||fireClick||performance.now()<devAttackUntil,sprinting=isSprinting(moveInput);fireClick=false;activeItemFrame();meleeFrame(sprinting,attack);deployFrame(attack);weaponFrame(attack,{sprinting});viewModelFrame(resourceTime(),dt);
  const r=recoil.extract(dt);if(r.pitch||r.yaw){pitch=THREE.MathUtils.clamp(pitch+r.pitch*Math.PI/180,playerConfig.player.data._minPitch*Math.PI/180,playerConfig.player.data._maxPitch*Math.PI/180);yaw-=r.yaw*Math.PI/180;}
  // BulletWeaponItem aim sway (combat.mjs aimSway), added to the look input like mouse movement.
  const sway=aim.sway&&aimSway(aim.sway.d,{aim:true,crouch:aim.sway.crouch},resourceTime(),dt);if(sway){pitch=THREE.MathUtils.clamp(pitch+sway.pitch*Math.PI/180,playerConfig.player.data._minPitch*Math.PI/180,playerConfig.player.data._maxPitch*Math.PI/180);yaw-=sway.yaw*Math.PI/180;aim.lastSway=sway;}}
  {const t=resourceTime();wildlife.update(t,dt);for(const a of wildlife.animals)if(a.body&&!a.destroyed)a.body.setMotion(animalBodyMotion(a));if(online?.wildlife)online.wildlife.frame(camera,t,dt);else animalRenderer.update(wildlife.animals,camera,t,dt);online?.held?.frame(t);online?.vitals?.frame(t);online?.deathFrame?.(t);characterRenderer()?.update(t,dt);nameTagFrame();
  droppedItems?.frame(t,dt);if(!playerVitals.alive)characterRenderer()?.applyDeathCamera(camera);
  playerVitals.armor=inventoryUI.inventory.armorValues??wornArmor(inventoryUI.inventory.slots,catalogue.items);
  torchActivationFrame(t);playerServerFrame(t,{forward,right,sprint:motor.sample.sprint});
  if(tod){tod.update(worldDt);metabolism.night=tod.isNight;applyTimeOfDay();}
  worldAudio?.frame(t,worldDt,{local:{active:walk&&playerVitals.alive,online:Boolean(online),origin:motor.feet.toArray(),grounded:motor.grounded,crouch:motor.crouched,teleports:motor.teleports},remotes:online?.playerRenderer?.views,animals:animalRenderer.views,night:Boolean(tod?.isNight),radiation:walk&&playerVitals.alive?radiationExposure(radiationZones,playerTarget.position,0):0});
  online?.voice?.update(dt);
  deployables.update(t);if(!online){rules.tick(t);for(const h of rules.spikeContacts(t,walk&&playerVitals.alive?[playerTarget]:[]))playerTarget.hurt([0,0,h.damage,0,0,0],null);}else online.frame();updateFireEffects(dt);updateHeldRepAudio(dt);updateTracers(dt);updateArrows(t,dt);updateGrenades(dt);updateExplosionFx(dt);online?.rigid?.frame(resourceTime(),dt);airdropFrame(dt);updateCharges(t);
  {const ms=clock();if(online?.worldObjects)for(const o of online.worldObjects.values())if(o.door){o.door.update(ms);if(o.door.changed){const m=o.door.motion.clone().multiply(o.matrix);o.group.matrix.copy(m);o.body?.setMotion(m);o.door.changed=false;}}
   for(const o of deployables.objects)if(o.door){o.door.update(ms);if(o.door.changed){const m=o.door.motion.clone().multiply(o.matrix);o.view.group.matrix.copy(m);o.view.body?.setMotion(m);o.door.changed=false;}}}if(!online&&walk&&deployables.warm(playerTarget.position))metabolism.markWarm(t);
  if(!online&&walk&&playerVitals.alive){metabolism.update(t,playerVitals,{damage:selfDamage,vomit:()=>{worldAudio?.vomit();}});playerVitals.update(t,metabolism.isWarm(t),selfDamage);}
  // RPOS.DoMetabolismUpdate runs only from Metabolism.RecieveNetwork (the server's 2 s tick): food, rads and the
  // hunger/cold/warm/radiation/poison plaques show the last tick's values (offline: metabolism.shown), not live ones.
  const mv=online?{...metabolism,warm:Boolean(metabolism.plaqueWarm)}:metabolism.shown;
  hud.update({health:playerVitals.health,calories:mv.caloricLevel,radiation:mv.radiationLevel,bleeding:playerVitals.bleedingLevel,poison:mv.poisonLevel,temperature:mv.coreTemperature,warm:mv.warm,workbench:online?serverInventory.atWorkbench:deployables.atWorkbench(playerTarget.position),crafting:Boolean(inventoryUI.inventory.work),injured:legInjury>0},walk&&playerVitals.alive);
  const status=[`Health ${Math.ceil(playerVitals.health)}`,`Calories ${Math.floor(metabolism.caloricLevel)}`];if(playerVitals.isBleeding())status.push('Bleeding');if(metabolism.isPoisoned())status.push('Poisoned');if(metabolism.radiationLevel>0)status.push(`Rads ${Math.floor(metabolism.radiationLevel)}`);
  if(metabolism.coreTemperature<0)status.push('Cold');else if(online?metabolism.plaqueWarm:metabolism.isWarm(t))status.push('Warm');
  if(tod){const h=Math.floor(tod.hour),m=Math.floor((tod.hour-h)*60);status.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}${tod.isNight?' night':''}`);}
  {const ammo=weaponHud();if(ammo)status.push(ammo);}const health=status.join(' · ');if(vitalsLabel.textContent!==health)vitalsLabel.textContent=health;}
 useTarget=probe();{const now=clock(),held=gameInput.axisDown('WorldUse');offlineContext.frame(now,held);onlineContext?.frame(now,held);}const hint=lastHint=useTarget?.contextText()??'';if(useHint.textContent!==hint)useHint.textContent=hint;
 updateTrees();renderer.info.reset(); // per frame: mesh-tree cap/cross-fade and billboard images follow the camera
 // Shipped CameraFX order: LazyCam, HeadBob. All gameplay above uses the true eye.
 {const eye=camera.quaternion.clone(),sway=cameraSway.update(eye,dt,viewModels?.lazyState()??{angle:0,allow:false});
  const active=walk&&playerVitals.alive;if(active!==bobActive||(bobFeet&&bobFeet.distanceTo(motor.feet)>10))headBob.reset();bobActive=active;bobFeet=motor.feet.clone();
  const bob=headBob.update(dt,{position:camera.position,quaternion:eye,yaw,input:active?(motor.inputDirection??[0,0,0]):[0,0,0],grounded:active&&motor.grounded,allow:active,...viewModels?.bobState()});
  const vmBobMatrix=bobViewMatrix(bob,bobData.config.antiOutputs);
  try{camera.quaternion.copy(sway.view);withHeadBob(camera,eye,bob,()=>{adaptNearPlane();
   // RPOS.BeforeSceneRender (end of CameraFX.PostPreCull): UseHoverTextThink projects the point with the scene camera as
   // LazyCam/HeadBob left it. Hidden while the context menu is up (OnContextMenuVisible), while RPOS is open and when dead.
   lastUseHover=useHover?.update({text:lastHint,point:useTarget?.textPoint?.()??null,camera,hidden:contextMenuOpen()||inventoryUI.isOpen()||!playerVitals.alive||Boolean(frontEnd?.menuVisible()),viewport:{width:canvas.clientWidth,height:canvas.clientHeight}})??null;updateModEffects(vmBobMatrix);muzzleFlashes.frame(dt,camera);if(sky&&tod){sky.update(camera,tod,worldDt);sky.applyFog(scene);sea.beforeRender(scene,camera,worldDt);}terrainLOD.update(camera);grass?.update(camera);layerCuller.apply(camera);if(qualityController){qualityController.frame(camera,{tod,radiation:walk&&playerVitals.alive?radiationExposure(radiationZones,playerTarget.position,playerVitals.armor[4]):0});
    qualityController.render(camera,()=>renderer.render(scene,camera),()=>viewModels?.render(renderer,sway.counter,vmCamera=>muzzleFlashes.frame(dt,vmCamera,true),vmBobMatrix));}
   else {renderer.render(scene,camera);viewModels?.render(renderer,sway.counter,vmCamera=>muzzleFlashes.frame(dt,vmCamera,true),vmBobMatrix);}});}
  finally{camera.quaternion.copy(eye);camera.updateMatrixWorld(true);}}
 combatFeedbackFrame();adminCapture.frame(); // same task as the render: the WebGL buffer is still readable
 frames++;
 // global.fpslog (NetPreUpdate.LateUpdate): Time.frameCount and 1 / Time.smoothDeltaTime.
 fpsSmooth=smoothDelta(fpsSmooth,(now-(fpsPrev??now))/1000||1/60);fpsPrev=now;clientCommands.frame(now/1000,frames,fpsSmooth);
 {const text=`${walk?'WALK':'FLY'} · ${Math.round(camera.position.y)} m · ${originalScene.objectCount} scene objects · ${visible.toLocaleString()} trees`;if(status.textContent!==text)status.textContent=text;}
 if(!stateHooked){stateHooked=true;Object.defineProperty(window,'explorerState',{configurable:true,get:explorerSnapshot});}gameInput.endFrame();requestAnimationFrame(animate);}
 // Read-only state for automated checks, built only when read (formerly rebuilt every frame).
 function explorerSnapshot(){return {ready:true,frames,walk,quality:qualityController?.state()??null,online:online&&{state:online.state,remote:online.remote.size,entities:online.worldObjects?.size??0,doors:[...(online.worldObjects?.values()??[])].filter(o=>o.door).map(o=>({state:o.door.state,fraction:o.door.fraction})),models:[...(online.worldObjects?.values()??[])].filter(o=>o.resource).map(o=>o.modelIndex),character:online.client.characterView},position:camera.position.toArray(),ground:ground(camera.position.x,camera.position.z),player:{feet:motor.feet.toArray(),height:motor.height,eye:motor.eye,grounded:motor.grounded,crouched:motor.crouched,crouchBlocked:motor.crouchBlocked,velocity:motor.velocity.toArray(),collisions:motor.collisions,legInjury,lastFall},collisionShapes:collisionWorld.colliderCount,collisionTriangles:collisionWorld.triangleCount,visibleTrees:visible,treeStats:trees.stats,grass:grass?.stats()??null,sceneObjects:originalScene.objectCount,sceneParts:originalScene.partCount,omittedEngineParts:originalScene.omitted.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,doors:doors.map(d=>({name:d.name,state:d.state,fraction:d.fraction})),useTarget:useTarget?.kind==='door'?useTarget.index:null,useTargetKind:useTarget?.kind??null,useHint:lastHint,useHover:lastUseHover,loot:{crates:loot.crates.size,looting:inventoryUI.lootOpen(),open:[...loot.crates].filter(c=>c.looter).map(c=>({name:c.prefab.name,items:c.slots.filter(Boolean).length}))},resources:{nodes:resources.nodes.size,lastSwing,notices:notices.slice(-5),lastEffect:lastResourceEffect},wildlife:{animals:wildlife.animals.size,rendered:animalRenderer.views.size,byState:[...wildlife.animals].reduce((m,a)=>(m[a.state]=(m[a.state]||0)+1,m),{})},vitals:{health:playerVitals.health,deaths:playerDeaths,dead:!playerVitals.alive,calories:metabolism.caloricLevel,bleeding:playerVitals.bleedingLevel,poison:metabolism.poisonLevel,healOverTime:playerVitals.healOverTime,activity:metabolism.activityLevel}};}
 // Development hook for automated checks: stand in walk mode on a door's forward side, facing it.
 // Faces the nearest spawned crate of a prefab name from a recovered distance (walk mode).
 const approach=(target,distance,heading=0.29)=>{const away=new THREE.Vector3(Math.cos(heading),0,Math.sin(heading)),spot=target.clone().addScaledVector(away,distance),floor=collisionWorld.raycast(new THREE.Ray(new THREE.Vector3(spot.x,target.y+1.5,spot.z),new THREE.Vector3(0,-1,0)),6);spot.y=floor?floor.position.y:ground(spot.x,spot.z);walk=true;keys.clear();motor.teleport(spot,{settle:true});camera.position.copy(motor.cameraPosition());const look=target.clone().sub(camera.position).normalize();yaw=Math.atan2(-look.x,-look.z);pitch=Math.asin(look.y);document.querySelector('#mode').textContent='Enter fly mode';};
 // Tries eight headings (and the given distances) until `ok()` holds for the resulting view.
 const approachUntil=(target,distances,ok)=>{for(let h=0;h<8;h++)for(const d of distances){approach(target,d,0.29+h*Math.PI/4);camera.rotation.set(pitch,yaw,0,'YXZ');camera.updateMatrixWorld();if(ok())return true;}return false;};
 // Dev helpers put an item on the belt the way a player can: RPOS cells never swap, so use a free belt cell or first
 // move the last belt item into the bag.
 function devBeltSlot(inv,i){let to=inv.slots.slice(30,36).indexOf(null);if(to<0){to=5;inv.move(35,inv.slots.slice(0,30).indexOf(null));}to+=30;inv.move(i,to);return to;}
 // A spawned animal keeps its returned index for the animal helpers even when earlier animals are removed (corpses expire after 90 s).
 const devSpawned=new Map(),devAnimal=i=>{const a=devSpawned.get(i);return a&&!a.destroyed?a:[...wildlife.animals][i];};
 window.explorerDev={textures:()=>textureStats(),rposSounds:()=>[...rposSoundLog],heldRepSounds:()=>lastHeldRepSounds,
 // Long-session health (tools/check-soak.mjs): GPU resources, shader programs, scene graph size, physics bodies, heap.
 diagnostics(){let nodes=0;scene.traverse(()=>nodes++);const m=renderer.info.memory;return {geometries:m.geometries,textures:m.textures,programs:renderer.info.programs?.length??null,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,sceneNodes:nodes,sceneChildren:scene.children.length,bodies:collisionWorld.bodies.length,animals:wildlife.animals.size,animalsAlive:[...wildlife.animals].filter(a=>a.alive).length,devAnimalsAlive:[...wildlife.animals].filter(a=>a.alive&&!a.spawner).length,resourceNodes:resources.nodes.size,
  // GenericSpawner targetPopulation sums: the offline island fills towards these over the spawners' 60-900 s thinkDelays.
  spawnTargets:resources.spawners.reduce((t,s)=>{for(const e of s.spawnList){if(e.prefabName.startsWith(':'))t.animals+=e.targetPopulation;else if(e.ported)t.nodes+=e.targetPopulation;}return t;},{animals:0,nodes:0}),
  corpses:corpses.size,deathDrops:deathDrops.size,droppedItems:droppedItems?.objects.size??0,deployables:deployables.objects.size,heap:performance.memory?.usedJSHeapSize??null,frames};},deathDrops:()=>[...deathDrops].map(d=>({position:d.position.toArray(),items:d.slots.filter(Boolean).map(i=>({name:catalogue.items[i.item].data.m_Name,uses:i.uses})),slots:d.slots.length,expires:d.timers.get('destroy')-lootTime(),body:Boolean(d.view.body)})),
  setSlotCondition(index,condition,maxCondition=1){const s=inventoryUI.inventory.slots[index];if(!s)return false;s.condition=condition;s.maxCondition=maxCondition;inventoryUI.refresh();return true;},
  approachDeathDrop(index=0,distance=1.4){const d=[...deathDrops][index];if(!d?.view.group)return false;d.view.group.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(d.view.group).getCenter(new THREE.Vector3());return approachUntil(center,[distance,distance+0.4,distance+0.8,0.9],()=>probe()?.crate===d);},
  controls:()=>({...gameControls.snapshot(),cameraFov:camera.fov,zoom:viewZoom}),crates:()=>[...loot.crates].map(c=>({name:c.prefab.name,position:c.position.toArray(),items:c.slots.filter(Boolean).length})),approachCrate(index,distance=1.4){const crate=[...loot.crates][index];if(!crate)return null;crate.view.group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(crate.view.group),center=box.getCenter(new THREE.Vector3());approachUntil(center,[distance,distance+0.4,distance+0.8],()=>probe()?.crate===crate);return {center:center.toArray(),items:crate.slots.filter(Boolean).length};},
 aimAtCrate(index){const c=[...loot.crates][index];if(c?.view?.body?.box)window.explorerDev.aimPoint(c.view.body.box.getCenter(new THREE.Vector3()).toArray());},
 nodes:()=>[...resources.nodes].map(n=>({name:n.prefab.ngcName,position:n.position.toArray(),left:n.totalLeft,modelIndex:n.modelIndex,shownModel:n.shownModel})),
 // Takes resources out of a node one at a time until its model stage changes (ResourceObject.modelindex path).
 depleteNodeStage(index){const n=[...resources.nodes][index];if(!n)return null;const from=n.modelIndex;
  while(n.modelIndex===from&&n.totalLeft>1){n.resources.find(r=>r.left>0).left--;n.resourcesGathered();}return {from,to:n.modelIndex};},
 aimAtNode(index){const n=[...resources.nodes][index];if(n?.view?.body?.box)window.explorerDev.aimPoint(n.view.body.box.getCenter(new THREE.Vector3()).toArray());},
 // Stands facing a resource node so the held tool's sphere cast reaches it.
 approachNode(index){const node=[...resources.nodes][index];if(!node)return null;node.view.group.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(node.view.group).getCenter(new THREE.Vector3());
  // Step in until the swing's sphere cast reaches the node well inside the tool range.
  const distances=[];for(let d=3;d>=0.4;d-=0.1)distances.push(d);approachUntil(center,distances,()=>{const hit=window.explorerDev.aim();return Boolean(hit.hit?.node&&hit.hit.distance<0.8);});return {center:center.toArray(),left:node.totalLeft};},
 // Stands about a metre from the nearest original terrain tree (not a bush), facing its trunk.
 approachTree(){let best=null,d=Infinity;for(const p of placements){if(p[3]===3)continue;const e=(p[0]-camera.position.x)**2+(p[2]-camera.position.z)**2;if(e<d){d=e;best=p;}}const trunk=new THREE.Vector3(best[0],best[1]+1.4,best[2]);approachUntil(trunk,[1.1,1.3],()=>Boolean(window.explorerDev.aim().hit?.tree));return trunk.toArray();},
 // Reports what a swing from the current view would hit (sphere cast 0.3 m over the given range).
 aim(range=1.5){const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),hit=collisionWorld.sphereCast(ray,0.3,range),far=collisionWorld.rayHit(ray,50);return {eye:camera.position.toArray(),dir:ray.direction.toArray(),hit:hit&&{distance:hit.distance,tree:Boolean(hit.body?.isTree),node:Boolean(hit.body?.resourceNode),body:hit.body?.name??null},ray:far&&{distance:far.distance,body:far.body?.name??null},bodies:collisionWorld.bodies.length};},
 // Fly-mode camera placement for visual QA.
 flyTo(from,to){walk=false;keys.clear();camera.position.set(...from);const d=new THREE.Vector3(...to).sub(camera.position).normalize();yaw=Math.atan2(-d.x,-d.z);pitch=Math.asin(d.y);lastTrees.set(Infinity,0,Infinity);document.querySelector('#mode').textContent='Enter walk mode';},
 animals:()=>[...wildlife.animals].map(a=>({key:a.key,state:a.state,health:a.vitals.health,position:[a.position.x,a.position.y,-a.position.z],harvestLeft:a.harvest.totalLeft})),
 // Spawns an original animal a few metres in front of the player (as GenericSpawner would), for checks.
 spawnAnimal(key,distance=4){const def=animalManifest.animals[key],f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),p=motor.feet.clone().addScaledVector(f,distance),pu=new THREE.Vector3(p.x,p.y+1,-p.z);
  // Test spawns snap onto the navmesh (natural spawns off it are removed, as NavMeshMovement.RemoveIfNotOnNavmesh does).
  if(navmesh&&def.movement?.type==='NavMeshMovement'){const h=navmesh.samplePosition(pu,30);if(h)pu.set(h.point.x,h.point.y+1,h.point.z);}
  const entry={prefabName:':'+key,spawned:[]},a=resources.spawnDynamic(null,entry,pu,new THREE.Quaternion());entry.spawned.push(a);const look=new THREE.Vector3(p.x,p.y+0.4,p.z).sub(camera.position).normalize();yaw=Math.atan2(-look.x,-look.z);pitch=Math.asin(look.y);const index=[...wildlife.animals].indexOf(a);devSpawned.set(index,a);return index;},
 // Navigation checks: spawn on the navmesh at a browser-space point, start a hunt (HostileWildlifeAI scent), read the agent.
 spawnAnimalAt(key,p){const def=animalManifest.animals[key];const pu=new THREE.Vector3(p[0],p[1]+1,-p[2]);
  if(navmesh&&def.movement?.type==='NavMeshMovement'){const h=navmesh.samplePosition(pu,30);if(h)pu.set(h.point.x,h.point.y+1,h.point.z);}
  const entry={prefabName:':'+key,spawned:[]},a=resources.spawnDynamic(null,entry,pu,new THREE.Quaternion());if(!a)return -1;entry.spawned.push(a);const index=[...wildlife.animals].indexOf(a);devSpawned.set(index,a);return index;},
 huntPlayer(index){const a=devAnimal(index);if(!a)return false;a.scent(playerTarget);return a.state===9;},
 animalNav(index){const a=devAnimal(index);if(!a)return null;const h=a.move.handle,b=v=>[v.x,v.y,-v.z];
  return {state:a.state,position:b(a.position),onMesh:Boolean(navmesh?.groundAt(new THREE.Vector3(a.position.x,a.position.y+2,a.position.z),3,3)),hasPath:a.move.hasPath??null,
   corners:h?h.corners.map(b):[],velocity:h?Math.hypot(h.vel.x,h.vel.z):null,speed:a.move.agent?.speed??null,distance:a.position.distanceTo(playerTarget.position),obstacles:navObstacles().length};},
 navPolygons(center,radius){if(!navmesh)return [];const c=new THREE.Vector3(center[0],0,-center[2]),out=[],v=new THREE.Vector3();
  for(const p of navmesh.query(c.x-radius,c.z-radius,c.x+radius,c.z+radius)){const pts=[];for(let k=0;k<navmesh.vertCount(p);k++){navmesh.polyVert(p,k,v);pts.push([v.x,v.y,-v.z]);}out.push(pts);}return out;},
 // Kills an animal the way a player's hit does (OnHurt, then OnKilled: a mutant drops its sack). Returns the sack count.
 killAnimal(index){const a=devAnimal(index);if(!a||a.vitals.dead)return null;a.hurt([0,0,a.vitals.health+1,0,0,0],{character:playerTarget});return deathDrops.size;},
 animalAt(index){const a=devAnimal(index);return a&&{state:a.state,health:a.vitals.health,dead:a.vitals.dead,harvestLeft:a.harvest.totalLeft,distance:a.position.distanceTo(playerTarget.position),position:[a.position.x,a.position.y,-a.position.z]};},
 aimAtAnimal(index,leadArrow=false){const a=devAnimal(index);if(!a)return;const p=a.body.box.getCenter(new THREE.Vector3());if(leadArrow){const speed=activeWeapon?.d.arrowSpeed??50,time=p.distanceTo(camera.position)/speed,velocity=a.move.velocity??a.move.look?.current?.clone().multiplyScalar(a.move.actualMoveSpeedPerSec??0);if(velocity)p.addScaledVector(browserOf(velocity),time);}const look=p.sub(camera.position).normalize();yaw=Math.atan2(-look.x,-look.z);pitch=Math.asin(look.y);},
 // Stands 0.5 m from an animal (from the player's side), facing its collider centre (small animals sit below the 1.5 m Rock reach otherwise).
 approachAnimal(index){const an=devAnimal(index);if(!an)return;const at=new THREE.Vector3(an.position.x,an.position.y,-an.position.z),d=motor.feet.clone().sub(at);d.y=0;if(d.lengthSq()<1e-6)d.set(1,0,0);d.setLength(0.5);
  const spot=at.clone().add(d),floor=collisionWorld.raycast(new THREE.Ray(spot.clone().add(new THREE.Vector3(0,2,0)),new THREE.Vector3(0,-1,0)),6);if(floor)spot.y=floor.position.y;motor.teleport(spot,{settle:true});camera.position.copy(motor.cameraPosition());window.explorerDev.aimAtAnimal(index);},
 approachAnimalForShot(index){const a=devAnimal(index);if(!a?.body)return false;const center=a.body.box.getCenter(new THREE.Vector3());return approachUntil(center,[3,4,2,1],()=>worldHit(new THREE.Ray(camera.position.clone(),center.clone().sub(camera.position).normalize()),30)?.body?.animal===a);},
 structures:()=>[...structures.components].map(c=>({item:c.prefab.name,type:c.type,position:c.position.toArray(),health:c.health,maxHealth:c.maxHealth,master:[...structures.masters].indexOf(c.master),
  center:c.view?.body?.box?.getCenter(new THREE.Vector3()).toArray()??null,carried:[...c.carried].map(o=>o.prefab.name),weightOn:[...(c.master?.hasWeightOn.get(c)??[])].map(o=>o.prefab.name),carryingWeight:Boolean(c.master?.carryingWeight(c)),dimmer:c.view?.dimmer?.grey??null,dimmerAverage:c.view?.dimmer?.average??null})),
 // Raid record: explosions (per-surface distance/blocked/damage/health), kills, corpses; TakeDamage.Kill for the
 // collapse check (the only way pillars/foundations/ceilings die besides decay; nothing in the game applies it).
 raid:()=>({explosions:explosionLog,killed:killLog,lastKilled,masters:structures.masters.size,corpses:[...corpses].map(c=>({name:c.name,position:c.position.toArray(),body:Boolean(c.body),online:c.onlineKey})),effects:explosionFx.length}),
 killStructure(i){const c=[...structures.components][i];if(!c)return false;c.hurt(Infinity);return c.destroyed;},
 spawnGrenade(pointB,name='F1 Grenade'){const w=deployManifest.weapons[Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name===name)],key=w?.prefabs?.throwObjectPrefab,p=deployManifest.prefabs[key];if(!p)return false;
  const tg=p.components.TimedGrenade[0],col=p.colliders.find(c=>c.type==='SphereCollider'),rb=p.components.Rigidbody?.[0]?.data;
  const g=new ThrownGrenade(physicsEngine,p,{position:unityOf(new THREE.Vector3(...pointB)),rotation:THROW_ROTATION,velocity:new THREE.Vector3(),...thrownPhysics});
  g.view=prefabGroup(key);g.prefab=p;g.explosion=tg.explosion;g.bounceSound=tg.sounds?.bounceSound;grenades.push(g);return true;},
 // Points the camera at a browser-space point (walk mode).
 aimPoint(p){const look=new THREE.Vector3(...p).sub(camera.position).normalize();yaw=Math.atan2(-look.x,-look.z);pitch=Math.asin(look.y);camera.rotation.set(pitch,yaw,0,'YXZ');camera.updateMatrixWorld();},
 // Holds the named item and clicks once with the current aim (structures and deployables).
 placeAim(name){const inv=inventoryUI.inventory;let i=inv.slots.findIndex(s=>s&&catalogue.items[s.item].data.m_Name===name);if(i<0)return null;if(i<30||i>35)i=devBeltSlot(inv,i);inv.selected=i;inventoryUI.refresh();
  const before=deployables.objects.size+structures.components.size;nextPlaceTime=0;deployFrame(true);return {placed:deployables.objects.size+structures.components.size>before,placement:lastPlacement&&{valid:lastPlacement.valid,results:lastPlacement.results,position:lastPlacement.position.toArray()}};},
 turnStructure(){turn90(1);},
 viewModel:()=>viewModels?.state()??null,
 setItemMods(names){if(online)return false;const inv=inventoryUI.inventory,s=inv.slots[inv.selected];if(!s||!itemModAssets)return false;s.mods=names.map(n=>Object.values(itemModAssets.manifest.mods).find(m=>m.name===n)?.uid).filter(x=>x!=null);inventoryUI.refresh();return true;},
 weaponMods:()=>weaponModEffects?.debug()??null,viewModelLights:()=>viewModels?.mirroredLights()??null,
 cameraSway:()=>({...cameraSway.state(),eye:camera.quaternion.toArray(),direction:camera.getWorldDirection(new THREE.Vector3()).toArray()}),
 headBob:()=>({...headBob.state(),scalars:viewModels?.bobState(),eyePosition:camera.position.toArray(),eyeQuaternion:camera.quaternion.toArray()}),
 viewModelDebug:()=>viewModels?.debug()??null,
 // P3-17/18 effect state: fire light drivers, held light (stylist / constant), legacy flare particles, lighting and barrel pose.
 lightHeldFlare:(on=true)=>{devFlareRequest=Boolean(on);},
 // DeployableObject.ownerID of an offline deployable (another owner sees a locked door's "Enter Code").
 setDeployableOwner:(i,owner)=>{const o=[...deployables.objects][i];if(o)o.ownerId=String(owner);return Boolean(o);},
 // Offline flare (offline-flare.mjs): the held flare's state and the thrown WorldFlare_New objects with their FlareLight3p.
 flare:()=>({held:activeWeapon?.kind==='flare'?{lit:Boolean(activeWeapon.state.lit),igniting:activeWeapon.state.igniteAt!=null,throwing:activeWeapon.state.throwAt!=null,uses:activeWeapon.slot.uses}:null,
  world:worldFlares.map(o=>({age:o.flare.age,landed:o.flare.landed,bounces:o.flare.bounces,position:browserOf(o.flare.position).toArray(),particles:o.view.effects?.reduce((n,e)=>n+e.particles.length,0)??0,light:o.view.lightIntensity??null,lit:fireLights.some(l=>l.intensity>0&&o.view.lightPosition&&l.position.distanceTo(o.view.lightPosition)<1e-3),audio:Boolean(o.view.audio)}))}),
 fxState:()=>({time:fx.time,wind:fx.wind&&{main:fx.wind.main,direction:fx.wind.direction.toArray()},lighting:{ambient:fx.lighting.ambient,directional:fx.lighting.directional.length,points:fx.lighting.points.length},
  fires:[...deployables.objects,...(online?.worldObjects?.values()??[]),...heldFires.values()].filter(o=>o.view?.lightDriver).map(o=>({name:o.prefab.name,kind:o.view.lightDriver.kind,on:Boolean(o.fire?.isOn),intensity:o.view.lightIntensity??null})),
  fireLights:fireLights.map(l=>l.intensity),held:heldTorch&&{name:heldTorch.prefab.name,kind:heldTorch.driver?.kind??null,intensity:heldTorch.intensity??null,audioSource:heldTorch.audioSource?.clip??null,audio:Boolean(heldTorch.audio),
   legacy:heldTorch.legacy.map(e=>({name:e.name,particles:e.particles.length,world:e.world})),effects:heldTorch.effects.map(e=>({particles:e.particles.length,depthTest:e.material.depthTest}))},
  barrel:viewModels?.state?.()?.barrel??null}),
 // Audit round 4 checks: the held item's uses (torch fuel), the look angles and the HUD's metabolism tick values.
 heldUses:()=>{const h=serverHeldItem();return h?{name:catalogue.items[h.item].data.m_Name,uses:h.uses}:null;},look:()=>({yaw,pitch}),hudMetabolism:()=>({...metabolism.shown}),
 torch:()=>({lit:Boolean(heldTorch),effects:heldTorch?.effects.length??0,particles:heldTorch?.effects.reduce((n,e)=>n+e.particles.length,0)??0,worldLight:torchWorldLight.intensity,position:torchWorldLight.position.toArray(),viewLights:viewModels?.mirroredLights()??[]}),
 // env.time: sets the hour (EnvironmentControlCenter.SetTime).
 setTime(h){if(tod){tod.hour=h;applyTimeOfDay();}return tod&&{hour:tod.hour,night:tod.isNight,lerp:tod.lerpValue};},
 sky:()=>sky?.debug()??null,skySample:d=>sky?.sample(d)??null,sea:()=>sea?.debug()??null,setWaterReflections:on=>sea?.setReflections(on)??null,setWaterQuality:q=>sea?.setQuality(q)??null,setMoonPhase(p){if(tod){tod.cycle.MoonPhase=p;tod.compute();}return tod?.cycle.MoonPhase;},
 tod:()=>tod&&{hour:tod.hour,night:tod.isNight,lerp:tod.lerpValue,sunZenith:tod.sunZenith,light:tod.lightIntensity,core:metabolism.coreTemperature,rads:metabolism.radiationLevel},
 radiationAt:p=>radiationExposure(radiationZones,new THREE.Vector3(...p),playerVitals.armor[4]),
 zones:()=>radiationZones.map(z=>({position:z.position.toArray(),radius:z.radius,exposurePerMin:z.exposurePerMin})),
 // Selects a belt slot holding the named item (moving it to slot 6 if needed).
 hold(name){const inv=inventoryUI.inventory;let i=inv.slots.findIndex(s=>s&&catalogue.items[s.item].data.m_Name===name);if(i<0)return null;if(i<30||i>35)i=devBeltSlot(inv,i);inv.selected=i;inventoryUI.refresh();return i;},
 // Holds Fire for the given milliseconds (as the mouse would).
 trigger(ms=50){devAttackUntil=performance.now()+ms;},
 reload(ms=100){devReloadUntil=performance.now()+ms;},
 strike:()=>lastStrike, // StrikeGun (HandCannon) begin/cancel, for checks
 // Removes every stack of the named item (checks clean up what they gave).
 takeItem(name){const inv=inventoryUI.inventory;let n=0;inv.slots.forEach((s,i)=>{if(s&&catalogue.items[s.item].data.m_Name===name){inv.slots[i]=null;n++;}});inventoryUI.refresh();return n;},
 weapon:()=>activeWeapon&&{kind:activeWeapon.kind,item:activeWeapon.d.m_Name,clip:activeWeapon.slot.uses,condition:activeWeapon.slot.condition,next:activeWeapon.state.nextPrimaryAttackTime-resourceTime()},
 combat:()=>({lastShot,lastExplosion,lastTracer,ragdolls:characterRenderer()?.ragdollDebug()??[],cameraNear:camera.near,arrows:arrows.length,arrowViews:arrows.map(a=>({attached:Boolean(a.attached),position:new THREE.Vector3().setFromMatrixPosition(a.view.matrix).toArray()})),grenades:grenades.length,armor:playerVitals.armor}),
 remoteCombat:()=>({count:remoteAttackCount,last:lastRemoteAttack,tracers:tracers.length,arrows:arrows.filter(a=>a.remote).length,melee:remoteMeleeLog,arrowFx:{...arrowLog,flying:arrows.filter(a=>!a.done).length,activeTrails:arrows.filter(a=>a.trail?.enabled).length}}),tracerEffects:()=>tracerEffects.debug(),
 muzzleFlashes:()=>muzzleFlashes.debug(),
 equip(name,slot){const inv=inventoryUI.inventory,i=inv.slots.findIndex(s=>s&&catalogue.items[s.item].data.m_Name===name);if(i<0)return false;const r=inv.move(i,slot);inventoryUI.refresh();return r!==false;},
 teleport(p){walk=true;keys.clear();motor.teleport(new THREE.Vector3(...p),{settle:true});camera.position.copy(motor.cameraPosition());document.querySelector('#mode').textContent='Enter fly mode';},
 face(y,p=0){yaw=y;pitch=p;},
 doorAt(index){const o=[...deployables.objects][index];return o?.door&&{state:o.door.state,fraction:o.door.fraction};},
 deployables:()=>[...deployables.objects].map(o=>({item:o.entry.item,kind:o.kind,position:o.position.toArray(),health:o.health,dead:o.dead,center:o.view?.body?.box?.getCenter(new THREE.Vector3()).toArray()??null,dimmerAverage:o.view?.dimmer?.average??null,carrier:o.carrier?.prefab?.name??null,dimmer:o.view?.dimmer?.grey??null,lit:o.fire?.isOn??null,slots:o.slots?.map(s=>s&&{item:catalogue.items[s.item].data.m_Name,uses:s.uses})??null})),
 approachDeployable(index){const o=[...deployables.objects][index];if(!o?.view)return false;o.view.group.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(o.view.group).getCenter(new THREE.Vector3());return approachUntil(center,[1.2,1.6,2],()=>probe()?.deployed===o);},
 aimAtOnline(index){const o=[...(online?.worldObjects?.values()??[])][index];if(!o?.body?.box)return false;window.explorerDev.aimPoint(o.body.box.getCenter(new THREE.Vector3()).toArray());return true;},
 approachOnline(index){const o=[...(online?.worldObjects?.values()??[])][index];if(!o?.body?.box)return false;const center=o.body.box.getCenter(new THREE.Vector3());return approachUntil(center,[1,1.2,1.4,0.8],()=>serverMeleeCast(collisionWorld,new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),1.5)?.body===o.body);},
 onlineFires:()=>[...(online?.worldObjects?.values()??[])].filter(o=>o.fire).map(o=>({lit:o.fire.isOn,effects:o.view.effects.length,particles:o.view.effects.reduce((n,e)=>n+e.particles.length,0)})),
 onlinePlayers:()=>online?.playerRenderer?.debug()??[],
 nameTags:()=>nameTags.snapshot(),contextSprites:()=>contextSprites?.snapshot()??[],contextUI:()=>({client:activeContext().snapshot(),offline:offlineContext.snapshot(),online:onlineContext?.snapshot()??null,ui:contextUI?.snapshot()??null}),popupNotices:()=>popupUI?.notices()??[],notice:(text,kind)=>notice(String(text),kind),crosshair:()=>({visible:crosshair?.visible()??false,viewModel:viewModels?.active??null}),input:()=>({held:[...gameInput.state.held],config:gameInput.bindings.config()}),
 onlineRagdolls:()=>online?.playerRenderer?.ragdollDebug()??[],
 voice:()=>online?.voice?.debug()??null,voiceSentLog:()=>online?.voice?.sentLog()??[],
 onlinePlayerHit(viewId,part){const b=collisionWorld.bodies.find(b=>b.onlineActor?.viewId===viewId&&b.bodyPart===part);if(!b?.box)return null;const center=b.box.getCenter(new THREE.Vector3()),ray=new THREE.Ray(camera.position.clone(),center.clone().sub(camera.position).normalize()),hit=collisionWorld.raycast(ray,100,b=>b?.onlineActor?.viewId!==viewId);return hit&&{part:hit.body.bodyPart,viewId:hit.body.onlineActor.viewId,point:hit.position.toArray(),distance:hit.distance};},
 onlineHitboxCount:()=>collisionWorld.bodies.filter(b=>b.bodyPart!=null&&b.onlineActor).length,
 onlineAnimals:()=>online?.wildlife?.debug()??[],
 onlineVitals:()=>online?.vitals&&{health:online.vitals.health,bleeding:online.vitals.bleeding,metabolism:online.vitals.metabolism},
 onlineRigid:()=>online?.rigid?.debug()??[],
 droppedItems:()=>droppedItems?.debug()??[],
 approachPickup(id){const o=[...(droppedItems?.objects??[])].find(o=>o.id===id);if(!o?.body?.box)return false;return approachUntil(o.body.box.getCenter(new THREE.Vector3()),[1,1.2,1.4,.8],()=>probe()?.kind==='pickup');},
 approachRigid(id){const a=online?.rigid?.actors.get(id);if(!a?.body?.box)return false;return approachUntil(a.body.box.getCenter(new THREE.Vector3()),[1,1.2,1.4,.8],()=>probe()?.online?.viewId===id);},
 onlineTorches:()=>[...heldFires.values()].map(o=>({parent:o.parent,rep:o.rep,effects:o.view.effects.length,particles:o.view.effects.reduce((n,e)=>n+e.particles.length,0),light:Boolean(o.view.light)})),
 onlineBuildings:()=>online?.buildings?.debug()??null,
 onlineEffects:()=>({effects:explosionFx.length,particles:explosionFx.reduce((n,e)=>n+e.fx.particles.length,0),lastServerExplosion}),
 nearPlane:()=>({...nearState,cameraNear:camera.near}),presentation:()=>({loaded:Boolean(presentationManifest),lastDeploySound,lastExplosionEffect,lastMeleeImpact,explosionLights:explosionLights.map(s=>s.light.intensity),aimSensitivity:aim.sensitivity,aimSway:aim.sway?{item:aim.sway.d.m_Name,crouch:aim.sway.crouch,last:aim.lastSway}:null,aiming:weaponAiming(resourceTime())}),
 audio:()=>({enabled:Boolean(listener),state:listener?.context.state??'disabled',loaded:[...buffers.keys()]}),
 worldAudio:p=>worldAudio?.debug(p)??null,volume:()=>({...audioSettings.get(),listenerGain:listener?.getMasterVolume()??null}),setVolume:v=>audioSettings.setVolume(v),
 audioDecoded:async()=>Promise.all([...buffers].map(async([file,promise])=>{const b=await promise;return {file,channels:b.numberOfChannels,seconds:b.duration};})),
 onlineProps:()=>[...(online?.worldObjects?.values()??[])].filter(o=>o.prefab).map(o=>({key:o.key,prefab:o.prefab.ngcName,parts:o.group.children.length,body:Boolean(o.body),armor:o.armorNames??null,health:o.health??null,dimmer:o.dimmer?.grey??null,dimmerAverage:o.dimmer?.average??null,killed:Boolean(o.killed)})),
 // Read-only, for tools/check-native.mjs: one server entity's collider centre (browser space), and the terrain trees nearest the player.
 onlineObject(key){const o=online?.worldObjects?.get(key);if(!o)return null;const box=o.body?.box;return {key,prefab:o.prefab?.ngcName??null,center:box?box.getCenter(new THREE.Vector3()).toArray():null,size:box?box.getSize(new THREE.Vector3()).toArray():null,position:new THREE.Vector3().setFromMatrixPosition(o.matrix??o.group.matrix).toArray(),health:o.health??null,killed:Boolean(o.killed),door:o.door?{state:o.door.state,fraction:o.door.fraction}:null,lit:o.fire?.isOn??null};},
 // A terrain edge within `radius` where the ground falls `drop` to `maxDrop` metres within 5 m (a fall to land on): the
 // nearest one, with a walk-up check (no rise over 1.2 m per 2 m on the last 10 m before the edge).
 cliff(radius=250,drop=12,maxDrop=18){const f=motor.feet,best={d:Infinity,v:null};
  for(let x=-radius;x<=radius;x+=3)for(let z=-radius;z<=radius;z+=3){const d=Math.hypot(x,z);if(d>radius||d>=best.d)continue;const px=f.x+x,pz=f.z+z,h=ground(px,pz);if(h<2)continue;
   for(let k=0;k<8;k++){const a=k*Math.PI/4,c=Math.cos(a),s=Math.sin(a),low=ground(px+c*5,pz+s*5);if(h-low<drop||h-low>maxDrop||ground(px+c*1.2,pz+s*1.2)<h-1.5)continue;
    let ok=true;for(let b=2;b<=10&&ok;b+=2)ok=Math.abs(ground(px-c*b,pz-s*b)-ground(px-c*(b-2),pz-s*(b-2)))<1.2;
    if(ok){best.d=d;best.v={top:[px,h,pz],below:[px+c*5,low,pz+s*5],drop:+(h-low).toFixed(1),distance:+d.toFixed(1)};}}}
  return best.v;},
 useTarget:()=>{const t=probe(),o=t?.online;return o?(o.carrier!=null?o.carrier+':'+o.innerID:'view:'+o.viewId):t?.kind??null;}, // online scene doors too
  // What the use ray hits first (any distance): its body's name, distance and online key. A null useTarget alone can't tell a miss from a wall in the way.
  useHit:()=>{camera.getWorldDirection(useRay.direction);useRay.origin.copy(camera.position);const h=collisionWorld.rayHit(useRay,10);const o=h?.body?.online;return h?{distance:+h.distance.toFixed(2),name:h.terrain?'terrain':h.body?.name??null,online:o?(o.carrier!=null?o.carrier+':'+o.innerID:'view:'+o.viewId):null,useRange}:null;},
 buildZones:()=>noPlacementZones.map(z=>({position:browserOf(z.position).toArray(),radius:z.radius})),
 trees(radius=40){const out=[];for(const p of placements){if(p[3]===3)continue;const d=Math.hypot(p[0]-motor.feet.x,p[2]-motor.feet.z);if(d<=radius)out.push({position:[p[0],p[1],p[2]],distance:d});}return out.sort((a,b)=>a.distance-b.distance).slice(0,24);},
 useDeployed(index){const o=[...deployables.objects][index];return o?.target?.use?.(camera.position,clock());},
 aimAtDeployable(index){const o=[...deployables.objects][index];if(o?.view?.body?.box)window.explorerDev.aimPoint(o.view.body.box.getCenter(new THREE.Vector3()).toArray());},
 placement:()=>lastPlacement&&{valid:lastPlacement.valid,results:lastPlacement.results,position:lastPlacement.position.toArray(),master:lastPlacement.master??null,structure:Boolean(lastPlacement.structure)},
 // What gates a Fire click (deployFrame / weaponFrame): blocked input, the context menu, life, the server's held item.
 inputState:()=>({blocked:inputBlocked(),contextMenu:contextMenuOpen(),walk,alive:playerVitals.alive,online:online?.state??null,activeRep:serverInventory?.activeRep??null,activeSlot:serverInventory?.activeSlot??null,selected:inventoryUI.inventory.selected,held:[...gameInput.state.held],fire:gameInput.isDown('Fire')}),
 placementPreview:()=>placementPreview?{...placementPreview.log}:null,
 // Selects a belt slot holding the named item, looks at the ground a few metres ahead and places it (as a click).
 placeHeld(name,distance=2.5){const inv=inventoryUI.inventory;let i=inv.slots.findIndex(s=>s&&catalogue.items[s.item].data.m_Name===name);if(i<0)return null;if(i<30||i>35)i=devBeltSlot(inv,i);inv.selected=i;inventoryUI.refresh();
  pitch=-Math.atan2(motor.eye,distance);camera.rotation.set(pitch,yaw,0,'YXZ');camera.position.copy(motor.cameraPosition());camera.updateMatrixWorld();const before=deployables.objects.size;nextPlaceTime=0;deployFrame(true);return {placed:deployables.objects.size>before,placement:window.explorerDev.placement()};},
 deployedAction(index,action){const o=[...deployables.objects][index];if(!o)return null;if(action==='use')o.target.use();else o.target.menuAction?.(action);return {lit:o.fire?.isOn??null,looting:inventoryUI.lootOpen()};},
 setDeployedCondition(index,slot,condition){const s=[...deployables.objects][index]?.slots?.[slot];if(!s)return false;s.condition=condition;return true;},
 fillDeployed(index,slot,name,amount){const o=[...deployables.objects][index],key=Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name===name);if(!o||!key)return false;o.slots[slot]={item:key,uses:amount,condition:catalogue.items[key].data._maxCondition};return true;},
 // Advances deployable time (fires) by running their updates as if `seconds` had elapsed.
 fastForwardFires(seconds){const t=resourceTime()+seconds;for(const o of deployables.objects){if(o.fire?.nextFuel!=null){o.fire.nextFuel-=seconds;o.fire.update(resourceTime());}}return t;},
 hurtPlayer(amount){return playerTarget.hurt([0,0,amount,0,0,0],null);},
 // A wildlife attacker `bearing` degrees clockwise from the view direction, 5 m away, facing the player (offline ClientHealthChange path).
 hurtFrom(bearing,amount,name='Wolf'){const b=bearing*Math.PI/180,f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),p=motor.feet.clone().addScaledVector(f,5*Math.cos(b)).addScaledVector(r,5*Math.sin(b));
  const toVictim=new THREE.Vector3(motor.feet.x-p.x,0,-(motor.feet.z-p.z)).normalize(); // Unity space; the attacker faces the player
  const a={def:{name},position:new THREE.Vector3(p.x,p.y,-p.z),rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),toVictim),destroyed:false};return playerTarget.hurt([amount,0,0,0,0,0],{character:a,animal:a});},
 setHealth(h){playerVitals.health=Math.min(playerVitals.maxHealth,Math.max(0.001,h));return playerVitals.health;},
 feedback:()=>({...(combatFeedback?.state()??{}),...feedbackLog,itemEvent:lastOfflineItemEvent,yaw,pitch,loaded:Boolean(combatFeedback)}),
 setCalories(n){metabolism.caloricLevel=n;},
 giveItem(name,amount=1){const inv=inventoryUI.inventory,key=Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name===name);const left=inv.add(key,amount);inventoryUI.refresh();return {key,left,slot:inv.slots.findIndex(s=>s?.item===key)};},
 useSlot(index,label){const a=inventoryUI.itemAction(index,label);return a?{label:a.label,used:a.run()}:null;},
 walkAway(metres){motor.teleport(motor.feet.clone().add(new THREE.Vector3(metres,0,0)));},
 // Motor checks: toggle a scene door, the CCPusher boxes (closed pose and current), and the motor's totem/push/platform state.
 useSceneDoor(index){return doors[index]?.use(camera.position,clock());},
 pushers:()=>(collisionWorld.pushers??[]).map(p=>{const at=m=>new THREE.Vector3(...p.shape.center).applyMatrix4(m).toArray(),dir=m=>new THREE.Vector3(...p.pushDir0).transformDirection(m).toArray();
  return {door:p.door,name:p.name,closedCenter:at(doors[p.door].closedWorld),center:at(doors[p.door].world),closedNormal:dir(doors[p.door].closedWorld),size:p.shape.size};}),
 motorState:()=>({height:motor.height,eye:motor.eye,radius:motor.radius,crouchBlocked:motor.crouchBlocked,pushing:motor.pushing,pushSteps:motor.pushSteps??0,platform:motor.platform?.static?'static':motor.platform?.name??null,
  platformVelocity:motor.platformVelocity.toArray(),overlapping:collisionWorld.overlaps(motor.feet,motor.height,motor.radius,0.002,motor.skip)}),
 approachDoor(index,distance=1.8){const {center,spot}=doorFront(index,distance);
  walk=true;keys.clear();motor.teleport(spot);camera.position.copy(motor.cameraPosition());const look=center.clone().sub(camera.position).normalize();yaw=Math.atan2(-look.x,-look.z);pitch=Math.asin(look.y);document.querySelector('#mode').textContent='Enter fly mode';return {center:center.toArray(),feet:motor.feet.toArray()};},
 // Native rows (door.scene): every scene door with its manual view, whether the use key goes to the server, its centre
 // and a floor spot `distance` in front of it (browser space; nothing moves).
 sceneDoors(distance=2.2){return doors.map((door,index)=>{const {center,spot}=doorFront(index,distance);return {index,viewId:door.record.viewID??null,online:Boolean(doorTargets[index]?.online),state:door.state,center:center.toArray(),spot:spot.toArray()};});},
 // Native rows (loot.crate): the server's LootableObjectSpawner crates as drawn (server-crates.mjs), centre of the collider.
 onlineCrates:()=>[...(online?.crates?.crates.values()??[])].map(c=>({viewId:c.viewId,name:c.prefab.name,looter:c.looter,body:Boolean(c.view?.body),center:(c.view?.body?.box?c.view.body.box.getCenter(new THREE.Vector3()):new THREE.Vector3().setFromMatrixPosition(c.matrix)).toArray()}))};
 // A scene door's world-bounds centre and the floor spot `distance` along its closed facing.
 function doorFront(index,distance){const door=doors[index],source=originalScene.manifest.instances.find(i=>i.door===index&&i.gameObjectPathID===door.record.clientGameObjectPathID);const [lo,hi]=source.worldBounds,center=new THREE.Vector3(...lo).add(new THREE.Vector3(...hi)).multiplyScalar(0.5);
  const axis=new THREE.Vector3().crossVectors(door.rotationCross,door.rotationAxis);const forward=new THREE.Vector3(axis.x,axis.y,-axis.z).transformDirection(door.closedWorld);forward.y=0;forward.normalize();
  const spot=center.clone().addScaledVector(forward,distance),floor=collisionWorld.support(spot.x,spot.z,center.y+1,center.y-4);spot.y=floor?.height??ground(spot.x,spot.z);return {center,spot};}
 // Airdrop checks: state, offline drops (as a Supply Signal or the drop zones would), fast-forward of the offline server,
 // and aiming/approaching a crate. Ids are view ids online.
 const airdropCenter=id=>{const v=airdropRenderer?.debug().views.find(v=>v.id===id),a=airdropActors?.actors.get(id);return v?.center??(a?[a.position.x,a.position.y,-a.position.z]:null);};
 Object.assign(window.explorerDev,{airdrops:()=>({time:offlineAirdrops?offlineAirdrops.time():resourceTime(),delay:airdropActors?.delay??null,actors:airdropActors?.debug()??[],offline:offlineAirdrops?.debug()??null,render:airdropRenderer?.debug()??null}),
  airdropSignal(p){return offlineAirdrops?.signal(unityOf(p?new THREE.Vector3(...p):motor.feet))??null;},airdropAt(p){return offlineAirdrops?.callAirDropAt(unityOf(new THREE.Vector3(...p)))??null;},
  airdropAdvance(seconds){offlineAirdrops?.advance(seconds);return offlineAirdrops?.debug()??null;},
  airdropClear(){offlineAirdrops?.clear();},
  // Checks only: full health and no bleeding before a step that measures exact damage.
  restoreVitals(){playerVitals.health=playerVitals.maxHealth;playerVitals.setBleedingLevel(0,resourceTime());playerVitals.healOverTime=0;return {health:playerVitals.health,bleeding:playerVitals.bleedingLevel};},
  // Checks only: roaming hostile wildlife can kill the player during long stationary checks (a dead player cannot loot or gather).
  // Corpses stay so index-based animal helpers keep their targets; a cleared mutant leaves no loot sack (checks only).
  clearHostiles(radius=300){let n=0;const drop=wildlife.dropOnDeath;wildlife.dropOnDeath=null;
   try{for(const a of wildlife.animals)if(a.hostile&&!a.vitals.dead&&a.position.distanceTo(playerTarget.position)<=radius){a.hurt([0,0,1e6,0,0,0],null);a.destroyAt=Infinity;n++;}}finally{wildlife.dropOnDeath=drop;}return n;},
  airdropGround(x,z){const g=ground(x,z),s=collisionWorld.support(x,z,g+2,g-5);return Math.max(g,s?.height??-Infinity);},
  aimAtAirdrop(id){const c=airdropCenter(id);if(c)window.explorerDev.aimPoint(c);return c;},
  approachAirdrop(id,distance=2.2){const c=airdropCenter(id);if(!c)return null;const center=new THREE.Vector3(...c),hit=()=>{const t=probe();return Boolean(t?.crate?.airdrop?.id===id||t?.online?.viewId===id);};return {center:c,aimed:approachUntil(center,[distance,distance+0.6,distance+1.2,distance+2],hit)};}});
 // Online mode: the server owns character positions. Remote characters use the original skin and clips.
 if(onlineJoin){
  // Local_HealthChange attackerID -> NetworkView.Find: characters (eyes), own character (HurtSelf: zero direction), other views.
  const onlineAttacker=viewId=>{if(!viewId)return null;if(viewId===online.client.characterView)return {self:true};const v=online.playerRenderer?.views.get(viewId);
   if(v){const p=new THREE.Vector3().setFromMatrixPosition(v.root.matrix),e=feedbackManifest?.eyes?.MalePlayer?.local??[0,0,0];return {eyes:[p.x+e[0],p.y+e[1],p.z-e[2]]};}
   const a=online.wildlife?.actors.get(viewId);if(a)return {eyes:characterEyes(a.def.name,a.position,a.rotation),wildlife:true};
   const r=online.rigid?.actors.get(viewId);return r?.position?{position:r.position.toArray()}:null;};
  online.vitals=new ServerVitals(online,{maxHealth:bodyData._maxHealth,now:resourceTime,delay:()=>online.playerRenderer?.timing.delay??0,
   onHealth:(health,attacker)=>clientHealthChange(health,onlineAttacker(attacker)),
   onChange:s=>{playerVitals.health=s.health;playerVitals.bleedingLevel=s.bleeding;
    if(s.metabolism){const {receivedAt,...values}=s.metabolism;metabolism.receiveNetwork(values,receivedAt);}},
   onDeath:()=>{serverInventory.closeLoot(false);playerDied();},
   onSpawn:()=>{online.playerRenderer?.resetDeathCamera(camera);combatFeedback?.reset(bodyData._maxHealth);fallbackHealth=null;playerVitals=new HumanBody({maxHealth:bodyData._maxHealth,bleedInterval:bodyData._bleedInterval});metabolism=new Metabolism({tickRate:metabolismTrait._tickRate});fireHeld=false;reloadHeld=false;deathAlive();deathScreen.hide();relock();},
   onVomit:()=>{worldAudio?.vomit();}});
  // FallDamage.fIc (RPCMode.Others): every client plays legBreakSound at that character (the local fallbob is above).
  online.client.addEventListener('rpc',e=>{const r=e.detail;if(r.name!=='fIc'||!Number.isFinite(r.args?.values?.[0]))return;
   const v=online.playerRenderer?.views.get(r.viewId),at=r.viewId===online.client.characterView?motor.feet.clone():v?new THREE.Vector3().setFromMatrixPosition(v.root.matrix):null;if(at)worldAudio?.fallImpact(at);});
  // FallDamage.fIo (owner): the server's leg injury level drives the forced crouch/half speed and the INJURED plaque.
  legInjury=online.legInjury;online.addEventListener('leg-injury',e=>{legInjury=e.detail.level;});
  // EnvironmentControlCenter.CL_UpdateSkyState (view 996): server day/night lengths, date, moon phase, cloud UV and hour.
  let lastSkyState=null;const syncSky=state=>{if(!tod)return;const r=applySkyState(tod,state);sky?.setCloudUV?.(r.cloudUV);applyTimeOfDay();lastSkyState={...state,snapped:r.snapped,localHour:tod.hour};};
  if(online.skyState)syncSky(online.skyState);online.addEventListener('sky-state',e=>syncSky(e.detail));
  // EquipmentWearer.ArmorData replaces the local armour sum; PlayerInventory.UpdateEquipment (an equipment slot changing
  // in a server snapshot) recomputes it locally until the next ArmorData.
  const equipmentKey=()=>[36,37,38,39].map(i=>inventoryUI.inventory.slots[i]?.item??'').join('|');let lastEquipment=equipmentKey();
  const setArmor=values=>{inventoryUI.inventory.armorValues=values;inventoryUI.refresh();};
  if(online.armorValues)setArmor(online.armorValues);online.addEventListener('armor-values',e=>setArmor(e.detail.values));
  online.addEventListener('inventory-call',()=>{const k=equipmentKey();if(k!==lastEquipment){lastEquipment=k;if(inventoryUI.inventory.armorValues){inventoryUI.inventory.armorValues=null;inventoryUI.refresh();}}});
  // Inventory.CLEV(byte event, int uniqueID) -> ItemDataBlock.OnItemEvent: equipped/unequipped/combined/used clip, Play(1).
  const itemKeyByUID=new Map(Object.entries(catalogue.items).map(([k,v])=>[v.data._uniqueID,k])),ITEM_EVENT_SOUND=[null,'equippedSound','unEquippedSound','combinedSound','UsedSound'];let lastItemEvent=null;
  online.client.addEventListener('rpc',e=>{const r=e.detail;if(r.viewId!==online.client.characterView||r.name!=='CLEV'||r.args?.class!=='Inventory')return;const [event,uid]=r.args.values,key=itemKeyByUID.get(uid),field=ITEM_EVENT_SOUND[event];
   const file=key&&field?deployManifest.itemSounds?.[key]?.[field]:null;lastItemEvent={event,item:key?catalogue.items[key].data.m_Name:null,file:file??null};if(file)playLocal(file,1);});
  window.explorerDev.onlineSky=()=>lastSkyState&&{...lastSkyState,hour:tod?.hour,daylength:tod?.daylength,nightlength:tod?.nightlength,moonPhase:tod?.cycle.MoonPhase,date:tod&&[tod.cycle.Year,tod.cycle.Month,tod.cycle.Day],cloudUV:sky?.debug()?.cloudUV??null};
  window.explorerDev.onlineState=()=>({legInjury,injuredPlaque:document.querySelector('[data-plaque=Injury]')?.hidden===false,lastFall,armor:playerVitals.armor,armorOverride:inventoryUI.inventory.armorValues??null,lastItemEvent,lastStrike,kick:online.kickReason,disconnectText:online.disconnectText(),
   charges:[...(online.worldObjects?.values()??[])].filter(o=>o.timedExplosive).map(o=>({key:o.key,ticks:o.ticks??0,exploded:Boolean(o.exploded)})),sleeperSounds:[...(online.worldObjects?.values()??[])].reduce((n,o)=>n+(o.sach??0),0)});
  online.wildlife=new ServerWildlife(online,animalManifest,{physics:wildlife.physics,renderer:animalRenderer,now:resourceTime,collisionWorld});
  online.rigid=new ServerRigid(online,deployManifest,{now:resourceTime,items:catalogue.items,delay:()=>online.playerRenderer?.timing.delay??0.1,
   create:a=>{const group=prefabGroup(a.key),f=a.p.components.FlareObj?.[0];if(a.p.components.ItemPickup)prefabBody(a.p,new THREE.Matrix4(),a.p.name).then(body=>{if(a.disposed)return;a.body=collisionWorld.addBody(body);body.online={viewId:a.id};body.onlineTarget={kind:'online',online:body.online,contextText:()=>a.pickup?.text??'Loading...'};});if(f){const p=deployManifest.prefabs[f.light];a.flare=p;a.effects=p?fireEffects(p):[];for(const e of a.effects)scene.add(e.mesh);const L=p?.components.Light?.[0]?.data;if(L){a.light=new THREE.PointLight(new THREE.Color(L.m_Color.r,L.m_Color.g,L.m_Color.b),L.m_Intensity*6,L.m_Range,1);scene.add(a.light);}}return group;},
   pose:(a,dt)=>{const s=a.p.rootScale;a.view.matrix.compose(a.position,a.rotation,new THREE.Vector3(s.x,s.y,s.z));a.view.matrixWorldNeedsUpdate=true;if(a.body)a.body.setMotion(a.view.matrix);
    const matrix=a.view.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0,0.1,0));for(const e of a.effects??[])e.update(dt,true,matrix,camera);a.light?.position.setFromMatrixPosition(matrix);
    const src=a.flare?.components.AudioSource?.[0];if(listener&&src?.clip&&!a.audio){const sound=a.audio=applyPanning(new THREE.PositionalAudio(listener));sound.setLoop(Boolean(src.data.Loop));sound.setDistanceModel(sourceDistanceModel(src.data.rolloffMode));sound.setVolume(src.data.m_Volume??1);sound.setPlaybackRate(src.data.m_Pitch??1);sound.setRefDistance(src.data.MinDistance??1);sound.setMaxDistance(src.data.MaxDistance??50);sound.setRolloffFactor(1);sound.position.copy(a.position);scene.add(sound);const url=deployBase+src.clip;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));buffers.get(url).then(b=>{if(!a.disposed){sound.setBuffer(b);sound.play();}}).catch(()=>{});}if(a.audio)a.audio.position.copy(a.position);},
   remove:a=>{a.disposed=true;scene.remove(a.view);if(a.body)collisionWorld.removeBody(a.body);for(const e of a.effects??[]){scene.remove(e.mesh);e.dispose();}if(a.light)scene.remove(a.light);if(a.audio){if(a.audio.isPlaying)a.audio.stop();a.audio.disconnect();scene.remove(a.audio);}},
   bounce:a=>{const c=a.p.components.TimedGrenade?.[0]??a.p.components.SignalGrenade?.[0],file=c?.sounds?.bounceSound;if(file)playFile(deployBase+file,file,a.position,1,18,0.85+Math.random()*0.3,'linear',0.25);},
   // TimedGrenade.OnDone also pushes the corpses near rigidbody.position (SignalGrenade.OnDone does not).
   done:a=>{const c=a.p.components.TimedGrenade?.[0]??a.p.components.SignalGrenade?.[0];if(c?.explosion){showExplosion(unityOf(a.position),c.explosion,{signal:Boolean(a.p.components.SignalGrenade)});lastServerExplosion={at:a.position.toArray(),name:a.p.name};}
    const tg=a.p.components.TimedGrenade?.[0];if(tg)lastServerExplosion={...lastServerExplosion,pushed:online.playerRenderer?.explosionForce(unityOf(a.position),tg.data?.explosionRadius??0)??0};}});
  // C130 / SupplyCrate classic views: interpolated server snapshots, Landed, looting via Context and the server inventory.
  if(airdropActors)online.airdrops=new ServerAirdrops(online,airdropActors,{now:resourceTime});
  // LootableObjectSpawner crates: the server's classic views (server-crates.mjs); the page's own LootSystem stays off online.
  online.crates=new ServerCrates(online,lootManifest.prefabs,{
   spawn:c=>{const group=crateTemplates.get(c.prefabKey).clone();group.matrixAutoUpdate=false;group.matrix.copy(c.matrix);scene.add(group);contextSprites?.attach(group);c.view={group,body:null};
    crateBody(c).then(body=>{if(c.removed)return;body.online=c.online;body.onlineTarget={kind:'online',online:c.online,contextText:()=>lootContextText(c.looter,online.playerClients.get(c.looter)?.name??null),textPoint:()=>lootTextPoint(group,THREE.Vector3)};c.view.body=collisionWorld.addBody(body);});},
   remove:c=>{c.removed=true;scene.remove(c.view.group);if(c.view.body)collisionWorld.removeBody(c.view.body);}});
  online.attach({feet:()=>motor.feet.toArray(),yaw:()=>yaw,pitch:()=>pitch,look:a=>{yaw=a.yaw;pitch=a.pitch;},
   flags:()=>localStateFlags()|(fireHeld?STATE.attack:0)|(attack2?STATE.attack2:0)|(playerVitals.bleedingLevel>0?STATE.bleeding:0)|localModFlags(),
   teleport:p=>{walk=true;keys.clear();motor.teleport(new THREE.Vector3(...p));camera.position.copy(motor.cameraPosition());document.querySelector('#mode').textContent='Enter fly mode';}});
  const pm=await json('players/manifest.json'),pc=await loadClips(base+'players/'+pm.clipsFile),ragdollData=await json('players/ragdoll.json');
  online.playerRenderer=await createPlayerRenderer(scene,pm,pc,createAssetLoader(base+'players/',pm),{sendRate:online.client.world?.sendRate??SEND_RATE,collisionWorld,heldManifest:deployManifest,heldTemplates:deployTemplates,ragdollData,physicsEngine});
  // Voice chat (voice.mjs): GameInput "Voice" push-to-talk -> clientspeak; VoiceCom:voiceplay -> 3D playback at the speaker.
  // VoiceCom.ShouldSend reads the key directly (no UI gate in the original); the port also stops while chat, console or
  // the main menu has the keyboard. The microphone opens only on a Voice press.
  online.voice=await createVoiceChat({input:gameInput,send:(setup,bytes)=>online.state==='in-game'&&online.client.voice(setup,bytes),
   canTalk:()=>online.state==='in-game'&&playerVitals.alive&&!chat?.isOpen()&&!gameControls?.isOpen()&&!frontEnd?.menuVisible(),
   getListener:()=>listener,unlock:unlockAudio,scene,camera,isOwn:id=>id===online.client.characterView,hidden:()=>Boolean(frontEnd?.menuVisible()),
   speaker:id=>{const v=online.playerRenderer.views.get(id),p=v?new THREE.Vector3().setFromMatrixPosition(v.root.matrix).toArray():online.remote.get(id)?.position;return p?{position:p,eyes:[p[0],p[1]+motor.eyeHeight,p[2]]}:null;}}).catch(e=>{console.warn('Voice chat unavailable:',e.message);return null;});
  online.client.addEventListener('rpc',e=>{const r=e.detail;if(r.args?.class!=='VoiceCom')return;const v=r.args.values;if(r.name==='voiceplay')online.voice?.receive(r.viewId,v[0],v[1],v[2]);else if(r.name==='init')online.voice?.init(r.viewId,v[0]);});
  online.addEventListener('remote-destroy',e=>online.voice?.removeSpeaker(e.detail.viewId));online.addEventListener('closed',()=>online.voice?.clear());
  let localDeathView=null;
  // Our character's Create (SpawnPlayer's spawn point, bag/bed or saved avatar rotation): Character.EyesSetup looks
  // level along it (net-client.mjs spawnLook). Browser quaternion [-x,-y,z,w] back to Unity.
  const lookAlongSpawn=v=>{const q=v?.rotation;if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))({yaw,pitch}=spawnLook([-q[0],-q[1],q[2],q[3]]));};
  if(online.state==='in-game')lookAlongSpawn(online.characterCreate);
  online.addEventListener('character',e=>{localDeathView=null;lookAlongSpawn(e.detail);});
  online.client.addEventListener('rpc',e=>{const call=e.detail,death=deathShot(call);if(!death||call.viewId!==online.client.characterView||localDeathView===call.viewId)return;localDeathView=call.viewId;
   const armor=[39,38,37,36].map(index=>catalogue.items[inventoryUI.inventory.slots[index]?.item]?.data._uniqueID??0);
   online.playerRenderer.localDeath({viewId:call.viewId,position:motor.feet.toArray(),rotation:[0,0,0,1],angles:{yaw,pitch},armor},resourceTime(),death.shot,camera,localDeathPose());
  });
  online.held=new ServerHeldItems(online,deployManifest,{items:catalogue.items,now:resourceTime,delay:()=>online.playerRenderer.timing.delay,attach:(parent,h)=>online.playerRenderer.attachHeld(parent,h),detach:(parent,rep)=>online.playerRenderer.detachHeld(parent,rep),status:(h,lit)=>online.playerRenderer.setHeldStatus(h.parent,lit,h.rep),action:remoteWeaponEffect});
  // HumanController.ReadClientMove -> UpdateStateNew: the interpolator goal at info.timestamp (callTime with the session's
  // ServerClock puts the server stamp on the page clock with one stable offset, server-clock.mjs).
  // The Create only places the character (goal false): the interpolator's goals are the ReadClientMoves (placeRemote).
  const place=(r,goal=true)=>{if(!online.deathCalls.has(r.viewId))online.playerRenderer.upsert(r,callTime(r,resourceTime(),online.clock),{goal});};
  // DeathTransfer.Client_OnKilledShared on another character: a death the local player caused runs at once (ClientLocalDeath
  // queued, then InterpTimedEvent.Remove(invokePending)); any other queues "RAG" at the RPC's timestamp and keeps the
  // character past its network Destroy (DontDestroyWithNetwork) until Interpolation.time reaches it, the clock the
  // characters are drawn on (player-view.mjs).
  const pendingRagdolls=new Map();
  // The hit boxes go at the RPC's arrival; the held representations, their queued events and the item pose stay until
  // "RAG" (server OnKilled: death RPC, DropInventoryContents -> InterpDestroy, DestroyCharacter in one tick), which
  // destroys the character and runs them (ItemRepresentation.OnDestroy, invokePending) before the ragdoll replaces it.
  const ragdollNow=(call,time)=>{pendingRagdolls.delete(call.viewId);online.held?.release(call.viewId);online.playerRenderer.ragdoll(call.viewId,time,call.shot);if(call.destroyed)online.playerRenderer.remove(call.viewId);};
  const death=call=>{online.playerRenderer.disableHit(call.viewId);online.held?.hold(call.viewId);const at=callTime(call,call.receivedAt,online.clock);if(call.attacker!=null&&call.attacker===online.client.characterView||at+online.playerRenderer.timing.delay<=resourceTime())ragdollNow(call,resourceTime());else pendingRagdolls.set(call.viewId,{call,at});};
  online.deathFrame=t=>{for(const {call,at} of [...pendingRagdolls.values()])if(at+online.playerRenderer.timing.delay<=t)ragdollNow(call,t);};
  online.addEventListener('closed',()=>pendingRagdolls.clear());
  online.addEventListener('remote-death',e=>death(e.detail));
  online.addEventListener('remote-create',e=>place(e.detail,false));online.addEventListener('remote-move',e=>place(e.detail));
  online.addEventListener('remote-equipment',e=>online.playerRenderer.setEquipment(e.detail.viewId,e.detail.armor));
  for(const r of online.remote.values()){online.playerRenderer.upsert(r,resourceTime(),{goal:Boolean(r.moved)});const call=online.deathCalls.get(r.viewId);if(call)death(call);}
  online.addEventListener('remote-destroy',e=>{const p=pendingRagdolls.get(e.detail.viewId);if(p)p.call.destroyed=true;else online.playerRenderer.remove(e.detail.viewId);});
  online.addEventListener('closed',()=>online.playerRenderer.clear());
  online.addEventListener('closed',()=>notice(online.disconnectText(),'popup',INFORMATION_NOTICE));
  // Leaving the page closes the gateway socket now, so the server releases the account for the next join at once.
  addEventListener('pagehide',()=>online.close());
  const consoleUI=text=>{if(chat?.consoleCommand(text))return;const c=clientUICommand(text);if(c?.type==='lock')lockEntry.show(c.changing,(code,changing)=>online.client.rpc(997,'SV_RunConsoleCommand',[`lockentry.passwordentry ${code} ${changing?'true':'false'}`]));else if(c?.type==='hide-lock')lockEntry.hide();else if(c?.type==='notice')notice(c.message,'popup',{icon:c.icon,seconds:c.seconds});else if(c?.type==='inventory')notice(c.message,'inventory');else if(c?.type==='death-reason')deathScreen.setReason(c.message);};
  for(const text of online.consoleCalls)consoleUI(text);online.consoleCalls.length=0;online.addEventListener('console-command',e=>{consoleUI(e.detail.text);online.consoleCalls.length=0;});online.addEventListener('closed',()=>lockEntry.hide());
  // ConsoleNetworker.CL_ConsoleMessage -> ConsoleWindow.AddText(message, bFromServer: true) (cyan, extra line).
  online.addEventListener('console-message',e=>gameControls?.addText(e.detail.text,true));
  // Server structures and deployables (NGC instantiations, handles such as ;struct_wood_wall) with original meshes
  // and solid collision, including resources, loot sacks and original posed sleepers.
  online.buildings=new ServerBuildings(online,deployManifest,catalogue.items,structureWorld);
  const worldObjects=new Map(),ngcId=key=>{const [carrier,innerID]=key.split(':').map(Number);return {carrier,innerID};};
  const unbindCensor=censorship.onChange(()=>{for(const o of worldObjects.values())o.bindArmor?.();});online.addEventListener('closed',unbindCensor);
  // Use key on server entities: the same ContextUI flow over Context:A..M (OnlineContext).
  onlineContext=new OnlineContext(online.client,{...contextHooks,now:clock});
  // Scene MovingDoors on their manual views: the server's DOc/DOo move them (frame loop applyDoor) and the use key
  // queries the server (Context:A on the door's view) instead of opening them locally.
  const doorViews=sceneDoorViews(doors),onDoorCall=call=>applySceneDoorCall(doorViews,call,{localNowMs:clock()});
  for(const t of doorTargets){const id=doors[t.index].record.viewID;if(doorViews.get(id)===doors[t.index])t.online={viewId:id};}
  for(const call of online.sceneDoorCalls.values())onDoorCall(call);
  online.client.addEventListener('rpc',e=>onDoorCall(e.detail));
  const addEntity=n=>{if(worldObjects.has(n.key))return;
   // Resource nodes (;res_woodpile, ;res_ore_1..3): first ResourceObject model and its collision mesh.
   const rkey=n.prefab?.startsWith(';')?n.prefab.slice(1):null,rp=rkey&&resManifest.prefabs[rkey];
   if(rp&&nodeVariants.has(rkey)){const {position,rotation}=entityTransform(n),matrix=deployMatrix(position,rotation,rp.rootScale),group=new THREE.Group();
    group.matrixAutoUpdate=false;group.matrix.copy(matrix);group.add(nodeVariants.get(rkey)[0].clone());scene.add(group);const o={group,body:null,resource:{key:rkey,prefab:rp},modelIndex:0};worldObjects.set(n.key,o);
    nodeShapes({prefab:rp},0).then(shapes=>{if(worldObjects.get(n.key)!==o)return;const b=new MovingBody(rp.name);b.shapes=shapes;b.setMotion(matrix);b.online=ngcId(n.key);b.onlineRoot=matrix;o.body=collisionWorld.addBody(b);});replayCalls(n.key,o);return;}
   const p=deployManifest.prefabs[n.prefab];if(!p||!deployTemplates.has(n.prefab))return;
   const {position,rotation}=entityTransform(n),matrix=deployMatrix(position,rotation,p.rootScale),group=deployTemplates.get(n.prefab).clone();
   group.matrixAutoUpdate=false;group.matrix.copy(matrix);scene.add(group);const o={key:n.key,prefab:p,group,body:null,matrix};worldObjects.set(n.key,o);
   if(!p.components.StructureComponent){const dep=component(p,'DeployableObject')??component(p,'SleepingBag')??component(p,'Bed')??{};o.deployed={position,rotation,prefab:p,tag:p.nodes[0].tag,cantPlaceOn:Boolean(dep.cantPlaceOn)};o.deployed.hardpoints=hardpointsOf(p,new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(p.rootScale.x,p.rootScale.y,p.rootScale.z)),o.deployed);}
   if(p.components.FireBarrel||p.components.Furnace){o.prefab=p;o.view={group};o.fire={isOn:false};attachFireEffects(o);}
   if(p.components.MovingDoor)o.door=deployableDoor(p,position,rotation);
   // DeployableObject.GetOwnerInfo(creator, owner) feeds SleepingBag.ContextStatusPoll (only the creator sees its sprite).
   contextSprites?.attach(group,{status:p.components.SleepingBag?()=>sleepingBagStatus(online.localUserId,online.entityCalls.get(n.key)?.get('GetOwnerInfo')?.args?.[0]??0):o.door?()=>doorStatus(o.door.busy):null});
   if(p.components.TimedExplosive){o.timedExplosive=p.components.TimedExplosive[0];o.nextTick=resourceTime();}
   prefabBody(p,matrix,p.name).then(b=>{if(worldObjects.get(n.key)!==o||o.dead)return;b.online=ngcId(n.key);b.worldObject=o;b.onlineRoot=matrix;b.onlineDamage=Object.keys(p.components).some(k=>k.endsWith("TakeDamage"));b.structure=online.buildings.part(n.key);b.deployed=o.deployed??null;o.body=collisionWorld.addBody(b);if(o.door)o.door.changed=true;});replayCalls(n.key,o);};
  // Door state, resource depletion stage, fire on/off from the server (browser/online.mjs applyEntityCall).
  const onCall=(o,call)=>{const r=applyEntityCall(o,call,{localNowMs:clock()});
   // StructureComponent.ClientKilled: deathEffect at the piece (destroyed after 5 s); the NetCull.Destroy that follows
   // removes it (cl_predestroy -> CullComponent), not this RPC.
   if(call.name==='ClientKilled'&&o.prefab?.components.StructureComponent&&o.matrix&&!o.killed){o.killed=true;const fx=o.prefab.components.StructureComponent[0].deathEffect;deathEffect(o.matrix,fx,o.prefab.name);
    if(fx)lastServerExplosion={at:lastKilled.at,name:o.prefab.name,deathEffect:fx};return;}
   // ClientHealthUpdate(newHealth): HealthDimmer.UpdateHealthAmount on structure pieces and deployables.
   if(call.name==='ClientHealthUpdate'&&o.prefab&&o.group){const td=takeDamageData(o.prefab),h=Number((Array.isArray(call.args)?call.args:call.args?.values??[])[0]);
    if(td&&Number.isFinite(h)){o.health=h;o.maxHealth=td.maxHealth;healthDimmer(o,h/td.maxHealth,Boolean(o.prefab.components.StructureComponent));}return;}
   // DeployableObject.Client_OnKilled: clientDeathEffect at the entity's position/rotation, destroyed after 5 s.
   if(call.name==='Client_OnKilled'&&o.matrix){const fx=o.prefab?.components.DeployableObject?.[0]?.deathEffect;if(fx){const at=new THREE.Vector3(),q=new THREE.Quaternion();o.matrix.decompose(at,q,new THREE.Vector3());showExplosion(unityOf(at),fx,{rotation:q,lifetime:5});lastServerExplosion={at:at.toArray(),name:o.prefab.name,deathEffect:fx};}}
   // TimedExplosive.ClientExplode: explosionEffect at transform.position/rotation and the tick sound stops (CancelInvoke).
   if(call.name==='ClientExplode'&&o.timedExplosive&&!o.exploded){o.exploded=true;const at=new THREE.Vector3(),q=new THREE.Quaternion();o.matrix.decompose(at,q,new THREE.Vector3());showExplosion(unityOf(at),o.timedExplosive.explosion,{rotation:q});lastServerExplosion={at:at.toArray(),name:o.prefab.name,ticks:o.ticks??0};}
   // SleepingAvatar.SACH: the sleeper's AudioSource plays as its owner's character is made from it.
   if(call.name==='SACH'&&o.prefab?.components.SleepingAvatar){const src=o.prefab.components.AudioSource?.[0];if(src?.clip){const at=new THREE.Vector3().setFromMatrixPosition(o.matrix);playFile(deployBase+src.clip,src.clip,at,src.data.MinDistance??1,src.data.MaxDistance??500,src.data.m_Pitch??1,sourceDistanceModel(src.data.rolloffMode),src.data.m_Volume??1,{pool:false});o.sach=(o.sach??0)+1;}}
   if(call.name==='SAAM'&&o.prefab?.components.SleepingAvatar){
    o.armorUIDs=[...call.args];
    // SleepingAvatar.RebindAllRenderers on a censor.nudity change runs this binding again (censorship listener below).
    (o.bindArmor=()=>{const keys=armorKeys(deployManifest.armor,o.armorUIDs),revision=o.armorRevision=(o.armorRevision??0)+1;
    Promise.all(keys.map(async(key,i)=>{const a=deployManifest.armor.models[key],meshes=await deployAssets.parts(a.sleepMesh,a.materials,a.materials.map((_,i)=>i),null,a.name);return {slot:deployManifest.armor.slots[i],meshes,name:a.name};})).then(parts=>{
     if(worldObjects.get(o.key)!==o||o.armorRevision!==revision)return;
     for(const part of parts){const g=o.group.children.find(g=>g.userData.armorSlot===part.slot);if(g){g.clear();g.add(...part.meshes);}}o.armorNames=parts.map(p=>p.name);
    }).catch(error=>console.error('Sleeper armour unavailable',error));})();
   }
   if(call.name==='SAKL'&&o.prefab?.components.SleepingAvatar&&!o.dead){o.dead=true;
    if(online.playerRenderer.sleepRagdoll(o.key,o.matrix,o.armorUIDs??[],resourceTime())){o.group.visible=false;if(o.body){collisionWorld.removeBody(o.body);o.body=null;}}
   }
   if(r==='lit'&&o.fire)o.fire.isOn=o.lit;
   // ResourceObject.modelindex: the effect now, then DelayedModelChangeIndex (mesh and collider) 0.15 s later.
   if(r==='model'&&o.resource){const i=Math.min(o.modelIndex,nodeVariants.get(o.resource.key).length-1);resourceMeshChangeEffect(';'+o.resource.key,o.group.matrix,o.shownModel??-1);
    setTimeout(()=>{if(o.removed)return;o.group.clear();o.group.add(nodeVariants.get(o.resource.key)[i].clone());o.shownModel=i;
     nodeShapes({prefab:o.resource.prefab},Math.min(i,o.resource.prefab.collisionMeshes.length-1)).then(shapes=>{if(o.body)o.body.setShapes(shapes);});},150);}};
  const replayCalls=(key,o)=>{for(const call of online.entityCalls.get(key)?.values()??[])onCall(o,call);};
  online.client.addEventListener('ngc-call',e=>{const o=worldObjects.get(e.detail.carrier+':'+e.detail.innerID);if(o)onCall(o,e.detail);});
  const removeEntity=key=>{const o=worldObjects.get(key);if(!o)return;o.removed=true;scene.remove(o.group);disposeFireEffects(o.view);if(o.body)collisionWorld.removeBody(o.body);worldObjects.delete(key);};
  for(const n of online.client.entities.values())addEntity(n);
  online.client.addEventListener('entity',e=>addEntity(e.detail));
  online.client.addEventListener('entity-destroy',e=>removeEntity(e.detail.carrier+':'+e.detail.innerID));
  // DeployableObject.OnKilled's corpseObject arrives as a uLink view (NetCull.InstantiateStatic(GameObject)) named after
  // the prefab (WoodDoor_Corpse / MetalDoor_Corpse); the server NetDestroys it after 300 s.
  const corpsePrefabs=new Map(Object.entries(deployManifest.prefabs).filter(([,p])=>p.components.DeployableCorpse).map(([k,p])=>[p.name,k]));
  const corpseView=v=>{const key=corpsePrefabs.get(v.prefab);if(!key||[...corpses].some(c=>c.onlineKey===v.viewId))return;
   spawnCorpse(key,new THREE.Vector3(v.position[0],v.position[1],-v.position[2]),new THREE.Quaternion(-v.rotation[0],-v.rotation[1],v.rotation[2],v.rotation[3]),{onlineKey:v.viewId});};
  for(const v of online.client.views.values())corpseView(v);
  online.client.addEventListener('create',e=>corpseView(e.detail));
  online.client.addEventListener('destroy',()=>{for(const c of [...corpses])if(c.onlineKey!=null&&!online.client.views.has(c.onlineKey))removeCorpse(c);});
  online.worldObjects=worldObjects;
  online.addEventListener('closed',()=>{for(const key of [...worldObjects.keys()])removeEntity(key);for(const c of [...corpses])if(c.onlineKey!=null)removeCorpse(c);});
  // Join progress is browser-port status (the original shows the LoadingScreen): logged to the F1 console.
  const joinLog=text=>{notices.push(text);if(notices.length>200)notices.splice(0,notices.length-100);gameControls?.print(text);};joinLog(`Joining ${onlineJoin.name??'server'}…`);
  if(online.state==='closed')joinLog('Could not join the server.');
  onlineConnect.then(r=>joinLog(`Connected to ${r.world.hostname}.`),e=>joinLog(`Could not join: ${e.reason??e.message}`));
 }
 // Offline saves (browser/persistence.mjs): restored at start, written every 60 s and when the page is hidden; ?fresh starts a new world.
 let storage=null;try{storage=window.localStorage;}catch{}
 const saves=saveSlot(storage??{});
 // Dead (the 60 s save or closing the tab on the death screen): ClearAvatar's avatar, i.e. the inventory a respawn
 // gives (learned blueprints + the default loadout), no position or vitals; loading it is a fresh spawn, not a corpse.
 const respawnInventory=inv=>{const fresh=new inv.constructor(inv.catalogue,inv.loadoutKey);fresh.known=new Set([...inv.known,...fresh.known]);return fresh;};
 const snapshot=()=>saveWorld({now:resourceTime(),structures,deployables,player:playerVitals.alive?{inventory:inventoryUI.inventory,body:playerVitals,metabolism,position:walk?playerTarget.position:null,yaw,pitch}:{dead:true,inventory:respawnInventory(inventoryUI.inventory)}});
 if(online){} // the server keeps online worlds
 else if(new URLSearchParams(location.search).has('fresh'))saves.clear();
 else {const saved=saves.read();if(saved){try{
  // WorldRules.load: ServerSaveManager.IsLoading while the saved pieces are re-added (no decay Touched).
  const r=rules.load(()=>loadWorld(saved,{now:resourceTime(),structures,deployables,player:{inventory:inventoryUI.inventory,body:playerVitals,metabolism}}));inventoryUI.refresh();
  // Damaged pieces come back dimmed (deployables send ClientHealthUpdate on instantiate; structures' last one is buffered).
  for(const c of structures.components)if(c.health<c.maxHealth)healthDimmer(c.view,c.health/c.maxHealth,true);for(const o of deployables.objects)if(o.takeDamage&&o.health<o.maxHealth)healthDimmer(o.view,o.health/o.maxHealth,false);
  // SpawnPlayer from the avatar: Pos and Ang, where Ang = Character.rotation = Euler(0, yaw, 0); EyesSetup then gives
  // pitch 0 (the saved pitch is ignored, as the original keeps none).
  if(r.position){walk=true;keys.clear();motor.teleport(new THREE.Vector3(r.position.x,r.position.y,-r.position.z));camera.position.copy(motor.cameraPosition());yaw=r.yaw;pitch=0;document.querySelector('#mode').textContent='Enter fly mode';}
  if(r.skipped.length)console.warn('Save entries skipped:',r.skipped);
 }catch(e){console.warn('Save not loaded:',e.message);}}}
 if(!online){setInterval(()=>saves.write(snapshot()),60000);addEventListener('pagehide',()=>saves.write(snapshot()));}
 // Compile every world material before the first frame (in parallel where KHR_parallel_shader_compile exists),
 // so the first rendered frame does not stall for over a second. Trees are placed first so their shaders count.
 // Weapon-attachment lights join the world scene when item mods load; light counts are part of every lit shader,
 // so they must be present before compiling or the whole world recompiles mid-play (a 1.6 s freeze).
 // Player entry: original options take effect (render.level pixel ratio, water.reflection); a new offline character
 // spawns like the server's SpawnManager.GetRandomSpawn before the warm-up so the first frame is already in place.
 // Render Quality (render.level, gfx.*): browser/quality-controller.mjs. Created before the shader warm-up so the current
 // level's shadow/sky programs compile with the world; a later level change relinks once (applyExpensiveChanges).
 await terrainTextures;stopEarlyUploads();clearTimeout(uploadTimer);uploadQueue.length=0; // the rest upload with the first frames, as before
 qualityController=await createQualityController({renderer,scene,sun,convars,manifest:qualityManifest,base:base+'quality/',storage:renderStore,devicePixelRatio,devMode});
 // GameFullscreen (damage overlay, combat-feedback.mjs) runs at its original place in the image-effect order.
 if(combatFeedback?.fullscreenEffect)qualityController.post.setFullscreenEffect(combatFeedback.fullscreenEffect());
 // Website map capture: one orthographic tile looking straight down, north (−z) up, centred on (cx, cz), span metres
 // wide, px pixels; returns a PNG data URL. The frame loop is paused so nothing else draws into the canvas meanwhile.
 if(aerialMode)window.explorerDev.aerialTile=({cx,cz,span,px,altitude=900})=>{
  aerialHold=true;const fog=scene.fog,size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();
  try{
   const cam=new THREE.OrthographicCamera(-span/2,span/2,span/2,-span/2,1,altitude+1200);cam.up.set(0,0,-1);cam.position.set(cx,altitude,cz);cam.lookAt(cx,0,cz);cam.updateMatrixWorld();cam.updateProjectionMatrix();
   scene.fog=null;renderer.setPixelRatio(1);renderer.setSize(px,px,false);layerCuller.suspend();terrainLOD.update(cam);trees.update(cam);sea?.beforeRender?.(scene,cam,0);
   renderer.render(scene,cam);return renderer.domElement.toDataURL('image/png');
  }finally{scene.fog=fog;renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);layerCuller.resume();aerialHold=false;}
 };
 Object.assign(window.explorerDev,{quality:()=>qualityController.state(),setQuality(level){convars.set('render.level',String(level));return qualityController.state();},gfx(name,value){convars.set(name,String(value));return qualityController.state();}});
 // Water Reflections (water.reflection) is applied by renderRefresh (WaterSettings.RefreshSettings); the GrabPass/depth
 // the High sea needs come from the post chain's camera image.
 if(sea)sea.attachPostChain(qualityController.post);else frontEnd?.markInert('water.reflection');
 Object.assign(window.explorerDev,{layerCulling:()=>layerCuller.stats(),setLayerCulling(on){layerCuller.setEnabled(on);if(on)renderRefresh();return layerCuller.stats();},treeWind:()=>trees.wind(),treeIdle:()=>trees.idle(),treesReflected:()=>{let n=0,all=0;trees.group.traverse(o=>{if(o.isMesh){all++;if(o.layers.isEnabled(30))n++;}});return {reflected:n,meshes:all};},frameLimit:()=>({fps:frameLimiter.fps}),
  renderConvars:()=>Object.fromEntries(['render.distance','render.frames','water.level','water.reflection','terrain.idleinterval','terrain.manual'].map(k=>[k,convars.get(k)]))});
 if(frontEnd&&!online&&!walk)respawn();
 status.textContent='Preparing shaders…';frontEnd?.loading('growing trees');await viewModelsReady;updateTrees();terrainLOD.update(camera);grass?.update(camera);
 {// Wildlife appears moments after loading: compile its skinned shaders and upload its textures now, not mid-play.
  const warm=new THREE.Group(),templates=animalRenderer.templates();warm.add(...templates);
  for(const t of templates)for(const m of [t.material].flat())for(const value of Object.values(m))if(value?.isTexture)renderer.initTexture(value);
  scene.add(warm);const fxWarm=fx.warm(scene);await renderer.compileAsync(scene,camera).catch(e=>console.warn('Shader warm-up skipped',e));scene.remove(warm);scene.remove(fxWarm);
  for(const t of templates)t.skeleton.dispose();}
 if(frontEnd){frontEnd.attachGame({online,release:()=>gameControls.release(),allowLeave:()=>gameControls.allowLeave(),beginSession:()=>gameControls.beginSession(),dead:()=>!playerVitals.alive,
   uiOpen:()=>inventoryUI.isOpen()||lockEntry.isOpen()||gameControls.isOpen()||contextMenuOpen()||Boolean(chat?.isOpen()),disconnect:()=>{if(online)online.close();else saves.write(snapshot());}});
  // RustLevel: "waiting for character" until the server creates our controllable, then "gameui.hide" (MainMenu.Hide).
  if(online&&online.state!=='in-game'){frontEnd.loading('waiting for character');await new Promise(r=>online.addEventListener('character',r,{once:true}));}
  frontEnd.finished();}
 chatReady=controllable=true;window.explorerDev.chat=()=>chat?.snapshot()??null;
 // QA: DeathScreen.Show with a given deathscreen.reason (the server's markup reaches lblDescription as is).
 window.explorerDev.showDeathReason=text=>{deathScreen.setReason(String(text));deathScreen.show();return deathScreen.element.querySelector('.death-info').textContent;};
 requestAnimationFrame(animate);
}catch(error){status.textContent=`Could not load island: ${error.message}`;frontEnd?.loading(`Could not load island: ${error.message}`);
 // Player page: say what went wrong and offer a reload (webgl-support.mjs); three's "Error creating WebGL context." is a
 // graphics problem the player can fix. The developer page keeps the #status line.
 if(!error?.startupShown&&document.body.classList.contains('rlb-player'))
  showStartupError(document,/WebGL context/i.test(error?.message??'')?startupMessage('no-webgl'):startupMessage('error',error?.message));
 if(!error?.startupShown)console.error(error);}
