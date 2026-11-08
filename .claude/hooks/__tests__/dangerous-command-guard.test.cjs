'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
// Next to the guard in the proposal folder, or in .claude/hooks/__tests__ once installed.
const guard=[path.resolve(__dirname,'dangerous-command-guard.cjs'),path.resolve(__dirname,'../dangerous-command-guard.cjs')].find(fs.existsSync);
const root=path.resolve(__dirname,'../../..');
const {evaluate}=require(guard);
const tmp=os.tmpdir().replaceAll('\\','/');
// Existing sensitive files outside the temp directory, removed after the run.
const fixture=path.join(root,'.guard-v2-fixture');
const event=(command,tool_name='Bash',cwd=root)=>({hook_event_name:'PreToolUse',cwd,tool_name,tool_input:{command}});
const decision=(command,tool_name)=>evaluate(event(command,tool_name)).decision;
const edit=(tool_name,tool_input)=>evaluate({hook_event_name:'PreToolUse',cwd:root,tool_name,tool_input}).decision;

before(()=>{
  fs.mkdirSync(path.join(fixture,'nested'),{recursive:true});
  fs.writeFileSync(path.join(fixture,'real.db'),'');
  fs.writeFileSync(path.join(fixture,'nested','smartfin-backup-1.json'),'{}');
  fs.writeFileSync(path.join(fixture,'plain.txt'),'');
});
after(()=>fs.rmSync(fixture,{recursive:true,force:true}));

const cases={
  allow:[
    // everyday work that the previous guard refused
    'ls -la .claude .claude/hooks && cat .claude/settings.json 2>/dev/null; echo ---',
    'git status --short && git diff --stat',
    'git log --oneline -5 | head -3',
    'git worktree add C:/sf-7a-20261102 -b fase-7a',
    'git switch -c fase-7a',
    'git checkout -b fase-7b',
    'git commit -m "Fase 7"',
    'git branch -d merged-branch',
    'git restore --staged src/x.ts',
    'git clean -n',
    'git stash',
    'npm test -- --runInBand',
    'npx tsc --noEmit',
    'node scripts/phase6b3/refresh-harness.cjs',
    'node -e "console.log(process.version)"',
    'cd android && ./gradlew.bat --offline assembleRelease',
    './gradlew installDebug',
    'grep -rn "TODO" src | wc -l',
    'find src -name "*.ts" | xargs grep -l useCase',
    'for f in src/*.ts; do echo $f; done',
    'echo "git reset --hard"',
    `printf '%s\\n' 'hello'`,
    'rm -rf node_modules android/app/build',
    'rm -rf safe-test-data',
    'rm -f docs/old-report.md',
    `rm -rf ${tmp}/smartfin-test-run`,
    `rm ${tmp}/x/movimientos-2020.csv`,
    'rm -rf "$TMPDIR/smartfin-run"',
    'cp src/a.ts src/b.ts',
    'echo hi > docs/out.txt',
    'cat > docs/note.md <<EOF\nrm -rf src\nEOF',
    'sqlite3 :memory: "CREATE TABLE t(id); DELETE FROM t;"',
    'sqlite3 -readonly .guard-v2-fixture/real.db "SELECT count(*) FROM accounts"',
    'sqlite3 .guard-v2-fixture/real.db "SELECT 1"',
    'sqlite3 new-fixture.db "CREATE TABLE t(id)"',
    'adb -s emulator-5554 install -r app-release.apk',
    'adb uninstall com.smartfin.snapshot5b2.tests',
    'adb shell pm clear com.smartfin.snapshot5b2.tests',
    'adb shell am start -n com.smartfin/.MainActivity',
    'adb shell "run-as com.smartfin ls databases"',
    'adb logcat -d',
    'sed -n "1,20p" src/a.ts',
  ],
  ask:[
    'rm -rf "$TARGET"',
    'xargs rm',
    'git push origin main',
    'git rebase main',
    'git branch -D old',
    'echo ok > .claude/settings.json',
    'rm .claude/hooks/dangerous-command-guard.cjs.backup',
    'rm -rf C:/sf-5e-20261024',
    'rm -rf C:/Users/nesto/Documents/old',
    'rm -rf .guard-v2-fixture',
    'sqlite3 .guard-v2-fixture/real.db "DELETE FROM accounts"',
    'sqlite3 .guard-v2-fixture/real.db',
    './gradlew uninstallAll',
    'adb install -d old.apk',
    'adb uninstall com.otherapp',
    'adb reboot',
    'find . -name "*.log" -delete',
    'powershell -EncodedCommand ZQBjAGgAbwA=',
    'bash -c "rm -rf $X"',
    'node -e "require(\'fs\').unlinkSync(\'a.db\')"',
    'echo "unterminated',
    'cd $SOMEWHERE && rm -rf build2',
    'reg add HKCU\\Software\\X',
  ],
  deny:[
    'git reset --hard HEAD',
    'git status; git clean -fd',
    'git checkout -- src/a.ts',
    'git checkout .',
    'git checkout src',
    'git restore src/a.ts',
    'git stash drop',
    'git push --force origin main',
    'git push origin +main',
    'git filter-branch --tree-filter x',
    'rm -rf src',
    'rm -rf ./',
    'rm -rf .git',
    'rm -rf .claude',
    'rm -rf C:/sf-6b3-20261101/src',
    'rm -rf ~',
    // Parent of the repository in Git Bash form (/c/Users/... locally, /d/a/... on CI).
    'rm -rf '+path.dirname(root).replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase()),
    'rm -rf *',
    'rm smartfin.db-wal',
    'rm docs/*.db',
    'rm -f .guard-v2-fixture/real.db',
    'echo $(git reset --hard)',
    'echo "$(git clean -fdx)"',
    'echo `git reset --hard`',
    'eval "git reset --hard"',
    'env git reset --hard',
    'sudo rm -rf src',
    'bash -c "git reset --hard"',
    'bash <<EOF\ngit reset --hard\nEOF',
    'echo x > .guard-v2-fixture/real.db',
    'cp other.db .guard-v2-fixture/real.db',
    'mv .guard-v2-fixture/real.db elsewhere.db',
    'find . -name "*.db" -delete',
    'adb uninstall com.smartfin',
    'adb -s emulator-5554 shell pm clear com.smartfin',
    'adb shell "run-as com.smartfin rm databases/smartfin.db"',
    'adb shell run-as com.smartfin sqlite3 databases/smartfin.db "DELETE FROM accounts"',
    'adb push x.db /data/data/com.smartfin/databases/smartfin.db',
    'adb shell "sh -c \'pm clear com.smartfin\'"',
  ],
};
for(const [expected,commands] of Object.entries(cases))
  for(const command of commands)test(`${expected} Bash: ${command.split('\n')[0]}`,()=>assert.equal(decision(command),expected));

test('PowerShell',()=>{
  for(const [command,expected] of [
    ['Get-ChildItem -Recurse src | Select-String "useCase"','allow'],
    ['Remove-Item -Recurse -Force .\\android\\app\\build','allow'],
    ['$files = Get-ChildItem docs; $files.Count','allow'],
    ['Remove-Item -WhatIf .claude/settings.json','allow'],
    ['git status && npm test','allow'],
    ['Set-Content -Path docs\\x.md -Value "hola"','allow'],
    ['Remove-Item "$env:TEMP\\smartfin-run" -Recurse','allow'],
    ['Remove-Item -LiteralPath .claude/settings.json','ask'],
    ["Copy-Item settings.json '.claude' -Force",'ask'],
    ['powershell.exe -NoProfile -Command "Remove-Item -LiteralPath .claude/settings.json"','ask'],
    ['Get-ChildItem *.tmp | Remove-Item','ask'],
    ['Remove-Item $target -Recurse','ask'],
    ["[IO.File]::Delete('x.txt')",'ask'],
    ['Remove-Item src -Recurse -Force','deny'],
    ['Remove-Item docs,src -Recurse','deny'],
    ['Remove-Item .guard-v2-fixture\\real.db','deny'],
    ['pwsh -c "git reset --hard"','deny'],
    ['cmd /c "rd /s /q src"','deny'],
    ['Format-Volume -DriveLetter D','deny'],
  ])assert.equal(decision(command,'PowerShell'),expected,command);
});

test('Write/Edit',()=>{
  for(const [tool,input,expected] of [
    ['Write',{file_path:'docs/example.md',content:'DROP TABLE example;'},'allow'],
    ['Edit',{file_path:'src/example.ts',old_string:'a',new_string:'b'},'allow'],
    ['Write',{file_path:path.join(os.tmpdir(),'scratch.txt'),content:'x'},'allow'],
    ['Write',{file_path:'C:/sf-6b3-20261101/src/x.ts',content:'x'},'allow'],
    ['Write',{file_path:'new-fixture.db',content:''},'allow'],
    ['Edit',{file_path:'src/database/schema.ts',old_string:'a',new_string:'b'},'allow'],
    ['Write',{file_path:'.claude/settings.json',content:'{}'},'ask'],
    ['Edit',{file_path:'CLAUDE.md',old_string:'a',new_string:'b'},'ask'],
    ['Edit',{file_path:'src/database/schema.ts',old_string:'const x=1;',new_string:''},'ask'],
    ['Edit',{file_path:'src/database/schema.ts',old_string:'a',new_string:'DROP TABLE accounts;'},'ask'],
    ['MultiEdit',{file_path:'src/modules/security/x.ts',edits:[{old_string:'a',new_string:'PRAGMA foreign_keys = OFF'}]},'ask'],
    ['Write',{file_path:'.guard-v2-fixture/real.db',content:''},'deny'],
  ])assert.equal(edit(tool,input),expected,`${tool} ${input.file_path}`);
});

test('malformed input asks instead of denying',()=>{
  for(const value of [null,{},{tool_name:'Bash',tool_input:{}},event('')])assert.equal(evaluate(value).decision,'ask');
});

test('CLI: silent allow, ask and deny payloads',()=>{
  for(const [input,expected] of [
    [JSON.stringify(event('echo hello')),null],
    [JSON.stringify(event('git push origin main')),'ask'],
    [JSON.stringify(event('git reset --hard')),'deny'],
    ['invalid json','ask'],
  ]){
    const result=spawnSync(process.execPath,[guard],{input,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
    if(expected===null)assert.equal(result.stdout,'');
    else assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,expected);
  }
});

test('fast enough for every tool call',()=>{
  const started=process.hrtime.bigint();
  for(let i=0;i<2000;i++)evaluate(event('git status --short && npm test -- --runInBand | tail -20'));
  assert.ok(Number(process.hrtime.bigint()-started)/1e6<2000);
});
