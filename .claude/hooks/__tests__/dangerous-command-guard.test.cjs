'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const adapter=path.resolve(__dirname,'../dangerous-command-guard.cjs');
const root=path.resolve(__dirname,'../../..');
const {evaluate}=require(adapter);
const event=(command,tool_name='Bash')=>({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input:{command}});
for(const command of ['git status --short','npm test -- --runInBand','echo "git reset --hard"','git status && git diff',"printf '%s\\n' 'hello'",'sqlite3 :memory: "CREATE TABLE t(id); DELETE FROM t;"'])
  test('allow Bash '+command,()=>assert.equal(evaluate(event(command)).decision,'allow'));
for(const command of ['git reset --hard HEAD','git status; git clean -fd','rm -rf src','rm smartfin.db-wal','rm -rf "$TARGET"','echo $(git reset --hard)','eval "git reset --hard"','env git reset --hard','xargs rm','echo ok > .claude/settings.json','rm -rf .claude','sqlite3 smartfin.db "DELETE FROM accounts;"','adb uninstall com.smartfin','rm -rf safe-test-data'])
  test('deny Bash '+command,()=>assert.equal(evaluate(event(command)).decision,'deny'));
test('native PowerShell safe/protected',()=>{
  assert.equal(evaluate(event('Write-Output "hello"','PowerShell')).decision,'allow');
  assert.equal(evaluate(event('Remove-Item -WhatIf .claude/settings.json','PowerShell')).decision,'deny');
  assert.equal(evaluate(event("Copy-Item settings.json '.claude' -Force",'PowerShell')).decision,'deny');
  assert.equal(evaluate(event('powershell.exe -NoProfile -Command "Remove-Item -WhatIf -LiteralPath .claude/settings.json"')).decision,'deny');
});
test('Claude Write/Edit use shared path protections',()=>{
  for(const [tool_name,tool_input,expected] of [
    ['Write',{file_path:'.claude/settings.json',content:'{}'},'deny'],
    ['Edit',{file_path:'CLAUDE.md',old_string:'a',new_string:'b'},'deny'],
    ['Write',{file_path:'smartfin.db',content:''},'deny'],
    ['Write',{file_path:'docs/example.md',content:'DROP TABLE example;'},'allow'],
    ['Edit',{file_path:'src/example.ts',old_string:'a',new_string:'b'},'allow'],
  ]) assert.equal(evaluate({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input}).decision,expected);
});
test('malformed inputs deny',()=>{
  for(const value of [null,{},event('"unterminated'),event('echo `whoami`')])
    assert.equal(evaluate(value).decision,'deny');
});
test('CLI contract produces supported denial and silent success',()=>{
  for(const [input,denied] of [[JSON.stringify(event('echo hello')),false],[JSON.stringify(event('git reset --hard')),true],['invalid json',true]]){
    const result=spawnSync(process.execPath,[adapter],{input,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
    if(denied) assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,'deny');
    else assert.equal(result.stdout,'');
  }
});
