// `node tools/central.mjs staff <config> <email or username> [--remove]`: grant or remove site staff without SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openCentralDb} from '../central/db.mjs';
import {staffCommand} from '../tools/central.mjs';

test('grants and removes site staff by email or username, and says when nobody matches', () => {
 const db=openCentralDb();
 db.createAccount({uuid:'00000000-0000-4000-8000-000000000001',username:'Ownerton',email:'Owner@Example.com',at:1});
 assert.match(staffCommand(db,'owner@example.com',{at:2}),/Ownerton is now site staff/);
 assert.equal(db.isStaff('00000000-0000-4000-8000-000000000001'),true);
 assert.match(staffCommand(db,'ownerton',{at:3}),/already site staff/);
 assert.match(staffCommand(db,'Ownerton',{remove:true,at:4}),/no longer site staff/);
 assert.equal(db.isStaff('00000000-0000-4000-8000-000000000001'),false);
 assert.throws(()=>staffCommand(db,'nobody@example.com',{at:5}),/No account/);
 assert.deepEqual(db.raw.prepare("select action from audit_events where action like 'staff-%' order by id").all().map(r=>r.action),['staff-granted','staff-removed']);
});
