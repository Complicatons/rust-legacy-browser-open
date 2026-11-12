import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const cat=JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))),bp=Object.keys(cat.blueprints).find(k=>cat.items[cat.blueprints[k].result].data.m_Name==='Wood Planks');
const boxBp=Object.keys(cat.blueprints).find(k=>cat.blueprints[k].name==='Wood Storage Box Blueprint');
const server=createServer();await listenServer(server);let browser;
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:60000});await page.locator('#respawn').evaluate(b=>b.click());const wood=await page.evaluate(()=>window.explorerDev.giveItem('Wood',100));
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.locator(`[data-blueprint="${bp}"]`).click();assert.ok(await page.locator('#blueprint-list h4').count()>1);
 await page.locator('#craft-plus').click({modifiers:['Control']});assert.equal(await page.locator('#craft-amount').inputValue(),'10');await page.locator('#craft-minus').click({modifiers:['Shift']});assert.equal(await page.locator('#craft-amount').inputValue(),'1');await page.locator('#craft-plus').click();assert.equal(await page.locator('#craft-amount').inputValue(),'2');
 const woodCount=()=>page.locator(`#inventory [data-slot="${wood.slot}"] .rpos-count`).textContent();await page.locator('#craft').click();assert.equal(await page.locator('#craft').textContent(),'Cancel');assert.equal(await woodCount(),'x100');await page.locator('#craft').click();assert.equal(await woodCount(),'x100');
 await page.locator('#craft').click();await page.waitForFunction(()=>document.querySelector('#craft-progress').value>0.05);assert.equal(await woodCount(),'x100');await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/crafting-batch.png'});
 await page.waitForFunction(i=>document.querySelector(`#inventory [data-slot="${i}"] .rpos-count`)?.textContent==='x80',wood.slot,{timeout:10000});assert.equal(await page.locator('#pack .item-slot:has(img[alt="Wood Planks"]) .rpos-count').textContent(),'x2');assert.equal(await page.locator('#craft').textContent(),'Craft');
 await page.locator('#craft-amount').fill('0002x');await page.locator('#craft-amount').press('Tab');assert.equal(await page.locator('#craft-amount').inputValue(),'2');await page.setViewportSize({width:1280,height:720});await page.locator('#craft-quantity').scrollIntoViewIfNeeded();await page.screenshot({path:'analysis/browser-qa/crafting-desktop.png'});assert.ok(await page.evaluate(()=>document.querySelector('#inventory').scrollWidth<=document.querySelector('#inventory').clientWidth));assert.deepEqual(errors,[]);
 // BlueprintDataBlock.CompleteWork with a full inventory: the 30 Wood are consumed and the Wood Storage Box that does not
 // fit is lost (AddItemAmount's leftover is ignored; no rollback, no drop).
 const filled=await page.evaluate(()=>window.explorerDev.giveItem('Rock',100));assert.ok(filled.left>0,'inventory full');
 await page.locator(`[data-blueprint="${boxBp}"]`).click();await page.locator('#craft-amount').fill('1');await page.locator('#craft-amount').press('Tab');await page.locator('#craft').click();assert.equal(await page.locator('#craft').textContent(),'Cancel');
 await page.waitForFunction(i=>document.querySelector(`#inventory [data-slot="${i}"] .rpos-count`)?.textContent==='x50'&&document.querySelector('#craft').textContent==='Craft',wood.slot,{timeout:40000});
 assert.equal(await page.locator('#inventory .item-slot img[alt="Wood Storage Box"]').count(),0,'the result that did not fit is lost');
 const result={graphics:await readGraphics(page),batch:2,remainingWood:await woodCount(),fullInventoryLoss:true,errors};console.log(JSON.stringify(result,null,1));await writeFile('analysis/browser-qa/crafting.json',JSON.stringify(result,null,1));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
