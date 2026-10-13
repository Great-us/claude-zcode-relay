const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {validateWorkspace}=require('../workspace.cjs');
test('explicit wildcard accepts an unrelated existing directory',()=>{
 assert.equal(validateWorkspace(os.tmpdir(),['*']),fs.realpathSync(os.tmpdir()));
});
test('wildcard retains absolute existing directory checks',()=>{
 assert.throws(()=>validateWorkspace('relative',['*']),/absolute/);
 assert.throws(()=>validateWorkspace(__filename,['*']),/directory/);
 assert.throws(()=>validateWorkspace(path.join(__dirname,'absent-directory-test'),['*']),/ENOENT/);
});
test('invalid or absent policies remain rejected',()=>{
 for(const roots of [[],undefined,'*',[null],['']])assert.throws(()=>validateWorkspace(__dirname,roots),/Configure/);
});
test('a narrow allowlist retains canonical containment',()=>{
 assert.equal(validateWorkspace(__dirname,[__dirname]),fs.realpathSync(__dirname));
 assert.throws(()=>validateWorkspace(path.dirname(__dirname),[__dirname]),/outside/);
});
