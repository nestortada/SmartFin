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
    'timeout 30 npm test',
    'cp -T a.txt b.txt',
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
    // timeout options with a value are not the duration
    'timeout -s KILL 10 rm -rf src',
    'timeout -k 5 30 git reset --hard',
    'timeout --signal KILL 10 git clean -fd',
    // a command in a variable that Git runs is the agent's own command, not an owner script
    "EDITOR='git reset --hard' git commit",
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

// ---------------------------------------------------------------- control plane (synthetic paths; nothing runs)
// The main checkout, also when this suite runs from one of its .claude/worktrees/<name>.
const main=root.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/,'');
const slash=text=>text.replaceAll('\\','/');
const gitBash=text=>slash(text).replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase());
const memory='.claude/agent-memory/financial-reviewer';
const control={
  ask:[
    // Bash redirections, tee, sed -i, here-documents
    `echo sintetico > ${memory}/MEMORY.md`,
    `echo sintetico >> ${memory}/recuerdo-nuevo.md`,
    'echo sintetico 2> .claude/rules/sintetica.md',
    'ls &> .claude/agents/sintetico.md',
    `cat > ${memory}/recuerdo-nuevo.md <<EOF\nrecuerdo sintetico\nEOF`,
    `echo sintetico | tee ${memory}/MEMORY.md`,
    'echo sintetico | tee -a .claude/workflows/sintetico.js',
    `sed -i 's/a/b/' ${memory}/MEMORY.md`,
    'sed -e s/a/b/ -i .claude/hooks/session-context.cjs',
    'perl -pi -e s/a/b/ CLAUDE.md',
    // create, overwrite, move, delete, copy into, links, attributes
    `cp /tmp/sintetico.md ${memory}/MEMORY.md`,
    `cp docs/sintetico.md ${memory}/`,
    'cp -T sintetico.txt .claude/settings.json', // -T takes no value: the last word is the destination
    'mv -T sintetico.md .claude/rules/sintetica.md',
    'cp -t .claude/agents docs/sintetico.md',
    `mv ${memory}/MEMORY.md /tmp/memoria-sintetica.md`,
    `mv docs/sintetico.md ${memory}/MEMORY.md`,
    `rm ${memory}/MEMORY.md`,
    'rm -rf .claude/agent-memory',
    'rm -r .claude/rules',
    `touch ${memory}/recuerdo-nuevo.md`,
    'mkdir .claude/agents/sintetico',
    'ln -s .claude/agent-memory memoria-sintetica',
    'chmod 644 AGENTS.md',
    'cp -r plantilla/.claude .',
    'cp plantilla/* .',
    'curl -o .claude/settings.json https://example.invalid/x',
    'tar -xzf sintetico.tgz',
    // globs
    `rm ${memory}/*`,
    'rm .claude/s*',
    'rm *.md',
    'rm -rf .claude/worktrees/*',
    'mv .claude/rules/*.md /tmp/',
    // relative, absolute, .., Windows and Git Bash forms, other checkouts
    'echo sintetico > docs/../CLAUDE.md',
    `echo sintetico > "${slash(root)}/AGENTS.md"`,
    `echo sintetico > ${gitBash(root)}/.claude/settings.local.json`,
    `echo sintetico > "${root}\\.claude\\agents\\sintetico.md"`,
    `echo sintetico > "${slash(main)}/.claude/worktrees/sintetico/.claude/hooks/x.cjs"`,
    'echo sintetico > C:/sf-sintetico-20261116/.codex/hooks.json',
    'echo sintetico > .agents/skills/sintetico/SKILL.md',
    'echo sintetico > .claude/skills/sintetico/SKILL.md',
    'echo sintetico > .mcp.json',
    // Windows aliases of the same file
    'echo sintetico > CLAUDE.md.',
    "echo sintetico > 'CLAUDE.md::$DATA'",
    // cd, pushd, subshells, git -C
    'cd .claude && echo sintetico > agents/x.md',
    `cd ${memory} && rm MEMORY.md`,
    'pushd .claude; echo sintetico > rules/r.md; popd',
    '(cd /tmp) ; echo sintetico > .claude/settings.json',
    'git -C .claude rm -r agents',
    // nested shells, substitutions, eval, xargs, find
    'bash -c "echo sintetico > .claude/settings.json"',
    "sh -c 'rm .claude/rules/*.md'",
    'echo "$(echo sintetico > .claude/settings.json)"',
    'eval "echo sintetico > CLAUDE.md"',
    'ls .claude/agents | xargs -I{} sed -i s/a/b/ .claude/agents/{}',
    'find .claude -name "*.md" -exec sed -i s/a/b/ {} \\;',
    'find .claude -name "*.md" -delete',
    // inline code and scripts
    `node -e "require('fs').writeFileSync('${memory}/MEMORY.md','x')"`,
    "node -e \"require('fs').renameSync('a','b')\"",
    "python -c \"open('.claude/agents/x.md','w').write('x')\"",
    "ruby -e \"File.write('CLAUDE.md','x')\"",
    "printf 'x' > /tmp/sintetico.js && node /tmp/sintetico.js",
    'npm run skills:sync',
    // Git
    `git rm ${memory}/MEMORY.md`,
    'git rm --cached CLAUDE.md',
    'git mv .claude/rules/agent-config.md .claude/rules/sintetica.md',
    'git diff --output=.claude/settings.json',
    `git update-index --skip-worktree ${memory}/MEMORY.md`,
    // dynamic or not analysable
    `echo x > "$CLAUDE_PROJECT_DIR/${memory}/MEMORY.md"`,
    'X=CLAUDE.md; echo x > $X',
    'echo x > CLAUDE{,}.md',
    'git apply',
    'cd "$OTRO" && echo x > CLAUDE.md',
    // security review of PR 3: programs from a pipe, perl -i, sed w/e, cp -T, PowerShell lists, unknown writers,
    // node output options, obfuscated inline code, reassigned variables, deep patches, clones
    `printf 'echo x > ${memory}/MEMORY.md' | bash`,
    "printf 'x' | sh",
    `echo "require('fs').writeFileSync('.claude/agents/a.md','x')" | node`,
    'cat sintetico.py | python -',
    'perl -0pi -e s/a/b/ .claude/agents/a.md',
    'perl -pe s/a/b/ -i .claude/agents/a.md',
    "sed -n 'w .claude/agents/a.md' AGENTS.md",
    "sed 's/a/b/w .claude/agents/a.md' AGENTS.md",
    "sed 's/a/b/e' docs/sintetico.md",
    'sed -f sintetico.sed docs/sintetico.md',
    'cp -rT plantilla .claude',
    `gzip ${memory}/MEMORY.md`,
    'openssl enc -in docs/x -out .claude/agents/a.md',
    'uniq AGENTS.md .claude/agents/a.md',
    'vim -es -c wq CLAUDE.md',
    'npx shx cp docs/x .claude/agents/a.md',
    'curl https://example.invalid/x -o.claude/agents/a.md',
    'wget -O.claude/agents/a.md https://example.invalid/x',
    `node --test --test-reporter-destination=${memory}/MEMORY.md`,
    'node --import "data:text/javascript,1" -e 1',
    "node -e \"require('fs')['write'+'FileSync']('.claude/agents/a.md','x')\"",
    "python -c \"import os;fd=os.open('x',os.O_WRONLY)\"",
    "npx tsx -e \"require('fs').writeFileSync('x','y')\"",
    'HOME=.claude/agents; echo x > ~/a.md',
    'export TMPDIR=.claude/agents; echo x > $TMPDIR/a.md',
    'NODE_OPTIONS=--require=sintetico.js node x.js',
    'git clone https://example.invalid/r.git .claude/skills/x',
    'git submodule add https://example.invalid/r.git .agents/x',
    'git checkout-index -a -f --prefix=.claude/agents/',
    'git read-tree -u HEAD',
    'npx jest -iu',
    'npx jest -u=true',
    // final security review: commands in Git variables, worktrees, Git configuration that runs commands, npm in the
    // control plane, node output options after the script, python options with a value
    "GIT_PAGER='tee .claude/agents/a.md' git log -1",
    'git worktree add .claude/agents/wt',
    "git config filter.x.smudge 'sh -c id'",
    'git config include.path /tmp/sintetico',
    'git --config-env=core.hooksPath=X commit -m a',
    'npm install --prefix .claude/hooks left-pad',
    'cd .claude/hooks && npm init -y',
    `node --test .claude/hooks/__tests__/session-context.test.cjs --test-reporter-destination=${memory}/MEMORY.md`,
    // final security review (second round): >&file, git config --file / -c / environment, programs from a pipe or a
    // process substitution, script arguments, readers that write
    'echo x >&.claude/agents/x.md',
    `git show HEAD:CLAUDE.md >& ${memory}/MEMORY.md`,
    'git diff HEAD >&CLAUDE.md',
    `git config --file ${memory}/MEMORY.md a.b c`,
    'git config -f .claude/settings.json a.b c',
    `git -c pager.log='tee .claude/agents/x.md' log`,
    'git -c filter.x.clean=sintetico add .',
    'git -c include.path=/tmp/sintetico.cfg log',
    'git -c gpg.program=sintetico commit -S -m x',
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0='tee .claude/agents/x.md' git log",
    'git --exec-path=/tmp/sintetico log',
    'cat sintetico.sh | bash /dev/stdin',
    'cat sintetico.js | node /dev/stdin',
    'source <(cat sintetico.sh)',
    'cat sintetico.sh | source /dev/stdin',
    'node scripts/sintetico.js .claude/agents/x.md',
    'xxd -r -p in.hex .claude/agents/x.md',
    // implicit writers
    'npx jest -u',
    'npm test -- --updateSnapshot',
    'npx eslint --fix src',
    'npm run lint -- --fix',
  ],
  allow:[
    'git status --short',
    'git diff --stat',
    'git log --oneline -5',
    'npm run typecheck',
    'npm run lint',
    'npm test -- --runInBand',
    'npx jest --runInBand __tests__/sintetico.test.ts',
    'npm run test:reproductions -- --runInBand',
    'npm run skills:check',
    'node scripts/syncAgentSkills.js --check',
    'node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs',
    'npx tsc --noEmit',
    'npx eslint src',
    `cat ${memory}/MEMORY.md`,
    'grep -rn "memory: project" .claude/agents',
    'head -20 .claude/agent-memory/README.md',
    `sha256sum ${memory}/MEMORY.md`,
    'git diff --check',
    `git hash-object ${memory}/MEMORY.md`,
    'git apply --check sintetico.patch',
    `cp ${memory}/MEMORY.md /tmp/copia-sintetica.md`,
    'find . -name "*.ts" -exec grep -l foo {} +',
    '(cd /tmp ; echo sintetico > .claude/settings.json)',
    'echo sintetico > docs/sintetico.md',
    'git mv docs/a.md docs/b.md',
    'rm *.tmp',
    'tar -xzf sintetico.tgz -C /tmp/salida',
    'node -p "require(\'./package.json\').version"',
    'python -c "print(1)"',
    'echo sintetico > ~/.claude/projects/sintetico/memory/MEMORY.md',
    'node --version',
    'python --version',
    'bash --version',
    "sed -n '1,20p' AGENTS.md",
    "sed 's/foo/we/' docs/sintetico.md",
    'diff AGENTS.md CLAUDE.md',
    'wc -l .claude/rules/agent-config.md',
    'gzip docs/sintetico.md',
    'git clone https://example.invalid/r.git /tmp/clon-sintetico',
    'git worktree add C:/sf-sintetico-20261117 -b fase-sintetica',
    'git config user.name sintetico',
    'GIT_PAGER=cat git log -1',
    'npm install',
    'npm ci',
    'npm test -- --runInBand 2>&1 | tail -20',
    'git status >&2',
    'echo x 2>&-',
    'git config --file /tmp/sintetico.cfg a.b c',
    'git -c core.quotepath=false status',
  ],
};
for(const [expected,commands] of Object.entries(control))
  for(const command of commands)test(`control plane ${expected}: ${command.split('\n')[0]}`,()=>assert.equal(decision(command),expected));

test('control plane: PowerShell',()=>{
  for(const [command,expected] of [
    [`Set-Content -Path ${memory}/MEMORY.md -Value sintetico`,'ask'],
    [`Add-Content ${memory}/MEMORY.md sintetico`,'ask'],
    ['"sintetico" | Out-File -FilePath .claude/rules/sintetica.md','ask'],
    [`New-Item -ItemType File -Path ${memory}/recuerdo-nuevo.md`,'ask'],
    ['Copy-Item docs/sintetico.md -Destination .claude/agents/','ask'],
    [`Move-Item ${memory}/MEMORY.md C:\\tmp\\sintetico.md`,'ask'],
    [`Remove-Item ${memory}/MEMORY.md`,'ask'],
    ['Remove-Item -Recurse .claude\\agent-memory','ask'],
    ['Clear-Content CLAUDE.md','ask'],
    ['"sintetico" > .claude/settings.local.json','ask'],
    ['"sintetico" >> AGENTS.md','ask'],
    ["[IO.File]::WriteAllText('.claude/agents/x.md','x')",'ask'],
    ["[System.IO.File]::AppendAllText('CLAUDE.md','x')",'ask'],
    ["[IO.File]::Delete('.claude/agent-memory/financial-reviewer/MEMORY.md')",'ask'],
    ['Set-Content -Path:.claude/settings.json sintetico','ask'],
    ['Set-Content -Pa .claude/settings.json -Va sintetico','ask'],
    ['Set-Location .claude; Set-Content agents/x.md sintetico','ask'],
    ['New-Item -ItemType SymbolicLink -Path memoria -Target .claude\\agent-memory','ask'],
    [`Set-Content -Path Microsoft.PowerShell.Core\\FileSystem::${root}\\CLAUDE.md x`,'ask'],
    ['Get-ChildItem .claude\\rules\\*.md | Remove-Item','ask'],
    ['pwsh -Command "Set-Content CLAUDE.md x"','ask'],
    ['Set-Content -Path docs/ok.txt,.claude/agents/a.md -Value x','ask'],
    ['Add-Content -Path docs/ok.txt,CLAUDE.md -Value x','ask'],
    ['New-Item -Path docs/ok.txt,.claude/agents/a.md -ItemType File -Value x','ask'],
    ['Set-Content -PSPath .claude/agents/a.md x','ask'],
    ["'Set-Content .claude/agents/a.md x' | powershell -Command -",'ask'],
    ["[IO.File]::\"WriteAllText\"('.claude/agents/a.md','x')",'ask'],
    ["&('Set'+'-Content') .claude/agents/a.md x",'ask'],
    ['(Get-Item CLAUDE.md).IsReadOnly=$true','ask'],
    ["$env:USERPROFILE='.claude/agents'; Set-Content $env:USERPROFILE/a.md x",'ask'],
    ['Start-Transcript -Path .claude/agents/a.md','ask'],
    ['Get-Content p.ps1 -Raw | iex','ask'],
    ['iex (Get-Content p.ps1 -Raw)','ask'],
    ['Invoke-Expression -Command (Get-Content p.ps1 -Raw)','ask'],
    ["Start-Process bash -ArgumentList '-c','cp x .claude/agents/y'",'ask'],
    ["Start-Process node -ArgumentList '-e','require(\"fs\").writeFileSync(\".claude/agents/x\",\"\")'",'ask'],
    ["Start-Process powershell -ArgumentList '-Command','Set-Content CLAUDE.md x'",'ask'],
    ['Get-Item CLAUDE.md | Move-Item -Destination tmp','ask'],
    ['Get-ChildItem .claude\\agents | Rename-Item -NewName x.md','ask'],
    ['Get-ChildItem tmp\\* | Copy-Item -Destination .','ask'],
    ['Get-Item CLAUDE.md | Set-ItemProperty -Name IsReadOnly -Value $true','ask'],
    ['Set-Alias w Copy-Item; w tmp\\CLAUDE.md .','ask'],
    ["Start-Process git -ArgumentList 'reset','--hard'",'deny'],
    ["Start-Process bash -ArgumentList '-c','rm -rf src'",'deny'],
    ["Start-Process git -ArgumentList 'status'",'allow'],
    ['Set-Content docs/sintetico.md hola','allow'],
    ['Set-Content -Path docs\\sintetico.md -Value hola','allow'],
    [`Get-Content ${memory}/MEMORY.md`,'allow'],
    [`Get-FileHash ${memory}/MEMORY.md`,'allow'],
    ['git status','allow'],
    ['npm run typecheck','allow'],
    ['npx jest __tests__/sintetico.test.ts','allow'],
  ])assert.equal(decision(command,'PowerShell'),expected,command);
});

test('control plane: Write, Edit, MultiEdit and NotebookEdit',()=>{
  for(const [tool,input,expected] of [
    ['Write',{file_path:`${memory}/MEMORY.md`,content:'sintetico'},'ask'],
    ['Write',{file_path:`${memory}/recuerdo-nuevo.md`,content:'sintetico'},'ask'],
    ['Edit',{file_path:'.claude/agents/financial-reviewer.md',old_string:'a',new_string:'b'},'ask'],
    ['Edit',{file_path:'.claude/rules/agent-config.md',old_string:'a',new_string:'b'},'ask'],
    ['MultiEdit',{file_path:'.claude/workflows/smartfin-development.js',edits:[{old_string:'a',new_string:'b'}]},'ask'],
    ['Write',{file_path:'.claude/skills/sintetico/SKILL.md',content:'x'},'ask'],
    ['Write',{file_path:path.join(root,'AGENTS.md'),content:'x'},'ask'],
    ['Write',{file_path:`${slash(main)}/.claude/worktrees/sintetico/CLAUDE.md`,content:'x'},'ask'],
    ['NotebookEdit',{notebook_path:`${memory}/sintetico.ipynb`,new_source:'x'},'ask'],
    ['NotebookEdit',{notebook_path:'docs/sintetico.ipynb',new_source:'x'},'allow'],
    ['Write',{file_path:'docs/sintetico.md',content:'x'},'allow'],
  ])assert.equal(edit(tool,input),expected,`${tool} ${input.file_path??input.notebook_path}`);
});

test('control plane: a link or junction outside it does not hide a write inside it',()=>{
  const target=path.join(root,'.claude','agent-memory');
  const file=path.join(target,'financial-reviewer','MEMORY.md');
  const before=fs.readFileSync(file);
  const link=path.join(os.tmpdir(),`guard-junction-${process.pid}`);
  fs.symlinkSync(target,link,'junction');
  assert.ok(fs.lstatSync(link).isSymbolicLink(),'the fixture must be a link');
  try{
    assert.equal(decision(`echo sintetico > "${slash(link)}/financial-reviewer/MEMORY.md"`),'ask');
    assert.equal(edit('Write',{file_path:path.join(link,'financial-reviewer','recuerdo-nuevo.md'),content:'x'}),'ask');
    assert.equal(decision(`cat "${slash(link)}/financial-reviewer/MEMORY.md"`),'allow');
  }finally{
    fs.unlinkSync(link); // removes the link itself, never its target
  }
  assert.ok(fs.readFileSync(file).equals(before),'the real memory file is untouched');
});

test('control plane: a script is analysed before it runs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-scripts-'));
  try{
    const files={
      'escribe.sh':'#!/bin/bash\necho sintetico > .claude/agent-memory/financial-reviewer/MEMORY.md\n',
      'lee.sh':'#!/bin/bash\ncat .claude/agent-memory/financial-reviewer/MEMORY.md\n',
      'escribe.ps1':'Set-Content -Path CLAUDE.md -Value sintetico\n',
      'escribe.cjs':"require('fs').writeFileSync(require('path').join('.claude','agents','x.md'),'x');\n",
      'lee.cjs':"console.log(require('fs').readFileSync('.claude/agent-memory/financial-reviewer/MEMORY.md','utf8'));\n",
      'otro.cjs':"require('fs').writeFileSync('docs/sintetico.txt','x');\n",
      'borra.sh':'git reset --hard\n',
    };
    for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(dir,name),text);
    const at=name=>slash(path.join(dir,name));
    for(const [command,expected,tool] of [
      [`bash ${at('escribe.sh')}`,'ask'],
      [`bash ${at('lee.sh')}`,'allow'],
      [`sh ${at('escribe.sh')}`,'ask'],
      [`${at('escribe.sh')}`,'ask'],
      [`source ${at('escribe.sh')}`,'ask'],
      [`node ${at('escribe.cjs')}`,'ask'],
      [`node ${at('lee.cjs')}`,'allow'],
      [`node ${at('otro.cjs')}`,'allow'],
      [`node --require=${at('escribe.cjs')} -e 1`,'ask'],
      [`node -r ${at('escribe.cjs')} ${at('lee.cjs')}`,'ask'],
      [`python -W ignore ${at('escribe.cjs')}`,'ask'],
      [`bash ${at('borra.sh')}`,'ask'], // deny inside an owner script becomes ask
      [`powershell -File ${at('escribe.ps1')}`,'ask','PowerShell'],
      [`& '${at('escribe.ps1')}'`,'ask','PowerShell'],
    ])assert.equal(decision(command,tool),expected,command);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('control plane: a script inside it is analysed, not trusted for its location',()=>{
  // A synthetic checkout nested under .claude/worktrees: its .claude/agent-memory is control plane, and the real
  // memory of this checkout is never touched.
  const worktrees=path.join(root,'.claude','worktrees');
  const created=!fs.existsSync(worktrees);
  const nested=path.join(worktrees,`guard-scripts-${process.pid}`);
  const dir=path.join(nested,'.claude','agent-memory','sintetico');
  const suites=path.join(nested,'.claude','hooks','__tests__');
  const memoryFile=path.join(root,'.claude','agent-memory','financial-reviewer','MEMORY.md');
  const before=fs.readFileSync(memoryFile);
  fs.mkdirSync(dir,{recursive:true});
  fs.mkdirSync(suites,{recursive:true});
  try{
    const files={
      'escribe.sh':'#!/bin/bash\necho sintetico >> .claude/agent-memory/financial-reviewer/MEMORY.md\n',
      'borra.sh':'#!/bin/bash\ngit reset --hard\n',
      'escribe.cjs':"require('fs').writeFileSync('.claude/agents/sintetico.md','x');\n",
      'escribe.py':"open('CLAUDE.md','w').write('x')\n",
      'escribe.ps1':'Set-Content -Path .claude/rules/sintetica.md -Value x\n',
      'lee.sh':'#!/bin/bash\ncat .claude/agent-memory/financial-reviewer/MEMORY.md\n',
      'lee.cjs':"console.log(require('fs').readFileSync('.claude/agents/financial-reviewer.md','utf8'));\n",
    };
    for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(dir,name),text);
    fs.writeFileSync(path.join(suites,'sintetico.test.cjs'),"require('fs').writeFileSync('.claude/agents/sintetico.md','x');\n");
    const at=name=>slash(path.join(dir,name));
    for(const [command,expected,tool] of [
      [`bash ${at('escribe.sh')}`,'ask'],
      [`${at('escribe.sh')}`,'ask'],
      [`source ${at('escribe.sh')}`,'ask'],
      [`bash ${at('borra.sh')}`,'ask'],
      [`node ${at('escribe.cjs')}`,'ask'],
      [`python ${at('escribe.py')}`,'ask'],
      [`powershell -File ${at('escribe.ps1')}`,'ask','PowerShell'],
      [`& '${at('escribe.ps1')}'`,'ask','PowerShell'],
      [`node --test ${slash(path.join(suites,'sintetico.test.cjs'))}`,'ask'], // not one of the four hook suites
      // a glob expands to a real script that the guard cannot read under that name
      [`node ${at('escri*.cjs')}`,'ask'],
      [`bash ${at('escri*.sh')}`,'ask'],
      [`${at('escri*.sh')}`,'ask'],
      [`source ${at('escri*.sh')}`,'ask'],
      [`bash ${at('lee.sh')}`,'allow'],
      [`node ${at('lee.cjs')}`,'allow'],
      // the hook suites that CI and /verificar run stay allowed
      ['node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/reviewer-reminder.test.cjs .claude/hooks/__tests__/session-context.test.cjs .claude/hooks/__tests__/agent-config-policy.test.cjs','allow'],
      ['node --test .claude/hooks/__tests__/agent-config-policy.test.cjs','allow','PowerShell'],
    ])assert.equal(decision(command,tool),expected,command);
  }finally{
    fs.rmSync(nested,{recursive:true,force:true});
    if(created)fs.rmSync(worktrees,{recursive:true,force:true});
  }
  assert.ok(fs.readFileSync(memoryFile).equals(before),'the real memory file is untouched');
});

test('control plane: unknown programs with globs or dynamic arguments',()=>{
  for(const [command,expected,tool] of [
    ['gzip .claude/agent-memory/*/MEMORY.md','ask'],
    ['gzip .claude/agent-memory/financial-reviewer/MEMORY.m?','ask'],
    ['gzip ~/.claude/agents/*','ask'],
    ['vim .claude/agents/*.md','ask'],
    ['npx shx rm .claude/rules/*.md','ask'],
    ['openssl enc -aes256 -in x -out=.claude/agents/*.md','ask'],
    ['gzip ".claude/agent-memory/$N/MEMORY.md"','ask'],
    ['F=.claude/agents/financial-reviewer.md; gzip $F','ask'],
    ['gzip $(git ls-files .claude/agent-memory)','ask'],
    ['openssl enc -aes256 -in x -out "$D/MEMORY.md"','ask'],
    ['node scripts/sintetico.js ".claude/agent-memory/$N/MEMORY.md"','ask'],
    ['for f in .claude/agents/*.md; do gzip "$f"; done','ask'],
    ['gzip "$env:X\\MEMORY.md"','ask','PowerShell'],
    ['gzip .claude\\agents\\*.md','ask','PowerShell'],
    [`gzip ${Array.from({length:64},(_,i)=>`a${i}`).join(' ')} .claude/agents/x.md`,'ask'], // no argument limit
    // readers, programs without files, globs outside the control plane and constants stay allowed
    ['grep -rn foo .claude/agent-memory/*','allow'],
    ['cat .claude/agents/*.md','allow'],
    ['for f in .claude/agents/*.md; do head -3 "$f"; done','allow'],
    ['for f in src/*.ts; do wc -l "$f"; done','allow'],
    ['[[ -f "$f" ]] && echo si','allow'],
    ['gzip docs/*.md','allow'],
    ['openssl rand -hex 16','allow'],
    ['sleep $N','allow'],
    ['kill $PID','allow'],
    ['echo $HOME','allow'],
    ['npx jest --runInBand $(git diff --name-only)','allow'],
    ['exit $LASTEXITCODE','allow','PowerShell'],
    ['Start-Sleep -Seconds $n','allow','PowerShell'],
    ['Get-FileHash $f','allow','PowerShell'],
  ])assert.equal(decision(command,tool),expected,command);
});

test('shell reserved words do not hide the command that follows them',()=>{
  for(const [command,expected] of [
    ['for f in a; do git reset --hard; done','deny'],
    ['for f in a; do rm -rf src; done','deny'],
    ['if true; then rm -rf src; fi','deny'],
    ['while true; do git clean -fd; done','deny'],
    ['if false; then :; else git push --force; fi','deny'],
    ['until false; do echo x > .claude/agents/a.md; done','ask'],
    ['! git reset --hard','deny'],
    ['for f in a b; do echo "$f"; done','allow'],
    ['if [ -f package.json ]; then npm test -- --runInBand; fi','allow'],
  ])assert.equal(decision(command),expected,command);
});

test('PowerShell: ForEach-Object calling a method that modifies the objects of the pipe',()=>{
  for(const [command,expected] of [
    ['Get-Item CLAUDE.md | ForEach-Object -MemberName Delete','ask'],
    ['Get-Item CLAUDE.md | ForEach-Object -MemberName:Delete','ask'],
    ['Get-Item CLAUDE.md | ForEach-Object Delete','ask'],
    ['Get-ChildItem .claude\\agent-memory -Recurse -File | % Delete','ask'],
    ['Get-Item CLAUDE.md | % -M MoveTo C:\\tmp\\y','ask'],
    ['Get-Item CLAUDE.md | foreach Delete','ask'],
    ['Get-Item CLAUDE.md | % Encrypt','ask'],
    ['Get-Item CLAUDE.md | % Replace x y','ask'],
    ['Get-Item CLAUDE.md | % Open Truncate','ask'],
    ['Get-Item CLAUDE.md | % OpenWrite','ask'],
    ['Get-Item CLAUDE.md | % AppendText','ask'],
    ['Get-Item CLAUDE.md | % CreateText','ask'],
    ['Get-Item CLAUDE.md | % set_IsReadOnly $true','ask'],
    ['Get-Item .claude | % CreateSubdirectory agents2','ask'],
    ['Get-Item HKCU:\\Software\\Sintetico | % DeleteSubKeyTree x','ask'],
    ['Get-Item CLAUDE.md | % -InputObject $x Delete','ask'],
    ['Get-Item CLAUDE.md | % $m','ask'],
    ['Get-Item CLAUDE.md | % { $_.Delete() }','ask'],
    // parameters before the member, and the forms of a script block or of the intrinsic .ForEach()
    ['Get-ChildItem .claude\\agent-memory -Directory | % -ArgumentList $true -MemberName Delete','ask'],
    ['Get-ChildItem .claude\\agent-memory -Directory | ForEach-Object -Args $true -MemberName Delete','ask'],
    ['Get-Item CLAUDE.md | % -ErrorAction Ignore -MemberName Delete','ask'],
    ['Get-Item CLAUDE.md | % -ea 0 Delete','ask'],
    ['Get-Item CLAUDE.md | % -OutVariable o -MemberName MoveTo x','ask'],
    ['Get-Item CLAUDE.md | % -PipelineVariable p Delete','ask'],
    ["Get-Item CLAUDE.md | % { $_.'Delete'() }",'ask'],
    ["Get-Item CLAUDE.md | % { $_.\"MoveTo\"('C:\\tmp\\y') }",'ask'],
    ['Get-Item CLAUDE.md | % { $_.Delete.Invoke() }','ask'],
    ["(Get-ChildItem .claude\\agent-memory).ForEach('Delete')",'ask'],
    ['(Get-ChildItem .claude\\agent-memory).ForEach($m)','ask'],
    ["Get-ChildItem x.zip | % ExtractToFile -ArgumentList '.claude\\settings.json',$true",'ask'],
    ['Get-CimInstance Win32_Process | % Terminate','ask'],
    ['Get-Item docs\\a.md | % CopyTo CLAUDE.md','ask'],
    // reading members and script blocks that only read stay allowed
    // computed members and calls whose name cannot be read
    ["Get-Item CLAUDE.md | % ('Delete')",'ask'],
    ["Get-Item CLAUDE.md | % -MemberName ('Del'+'ete')",'ask'],
    ['Get-Item CLAUDE.md | % -ProgressAction Ignore Delete','ask'],
    ['Get-Item CLAUDE.md | % { $_.set_IsReadOnly($true) }','ask'],
    ["Get-Item CLAUDE.md | % { $m='Delete'; $_.$m() }",'ask'],
    ["Get-Item CLAUDE.md | % { $_.('Delete')() }",'ask'],
    ["Get-Item CLAUDE.md | % { $_.psobject.Methods['Delete'].Invoke() }",'ask'],
    ['Get-Item CLAUDE.md | % { $_.Terminate.Invoke() }','ask'],
    ["(Get-ChildItem .claude\\agent-memory).ForEach('Del'+'ete')",'ask'],
    ["(Get-ChildItem .claude\\agent-memory).ForEach(('Delete'))",'ask'],
    ['Get-ChildItem src | ForEach-Object { $_.FullName.Substring(3) }','allow'],
    ['$x = 7 % (3)','allow'],
    ['foreach ($f in (Get-ChildItem src)) { $f.Name }','allow'],
    ["(Get-Item CLAUDE.md).LastWriteTime.ToString('s')",'allow'],
    ['Get-ChildItem src | % -ErrorAction Ignore -MemberName Name','allow'],
    ['Get-ChildItem src | % -ea 0 FullName','allow'],
    ["(Get-ChildItem src).ForEach('Name')",'allow'],
    ['(Get-ChildItem src).ForEach({ $_.Name })','allow'],
    ['Get-ChildItem src | ForEach-Object { $_.Name }','allow'],
    ['Get-ChildItem src | % Name','allow'],
    ['Get-ChildItem .claude\\agents | ForEach-Object -MemberName FullName','allow'],
    ['Get-ChildItem src | % Length','allow'],
    ['Get-ChildItem src | % ToString','allow'],
    ['Get-ChildItem src | % OpenText','allow'],
    ['1..3 | ForEach-Object { $_ * 2 }','allow'],
    ['foreach ($f in $files) { $f.Name }','allow'],
  ])assert.equal(decision(command,'PowerShell'),expected,command);
});

test('ripgrep, ag and git grep: options that run another program ask',()=>{
  for(const [command,expected] of [
    ['rg --pre bash x .claude/agent-memory/financial-reviewer/MEMORY.md','ask'],
    ['rg --pre=./p.sh x .','ask'],
    ['rg -n --pre cat foo src','ask'],
    ["rg --pre-glob '*.md' --pre ./p.sh x docs",'ask'],
    ['RIPGREP_CONFIG_PATH=/tmp/rg.conf rg foo src','ask'],
    ['ag --pager=less foo src','ask'],
    ['ag --pager "bash -c x" foo src','ask'],
    ['rg -n foo src','allow'],
    ['rg -l "memory: project" .claude/agents','allow'],
    ["rg --hidden -g '!node_modules' foo .",'allow'],
    ['rg --no-pre foo src','allow'],
    ["rg --pre-glob '*.md' foo src",'allow'],
    ['rg -z foo docs','allow'],
    ['ag foo src','allow'],
    // git grep -O<program> runs the program with the files found
    ['git grep -Ovim foo','ask'],
    ['git grep -nOvim foo','ask'],
    ['git grep -O foo','ask'],
    ['git grep --open-files-in-pager=vim foo','ask'],
    ['git grep -n foo','allow'],
    ['git grep -i -n "memory: project" -- .claude','allow'],
  ])assert.equal(decision(command),expected,command);
});

test('node --test: only `node --test <pinned hook suites>` runs without a question',()=>{
  const suite='.claude/hooks/__tests__/session-context.test.cjs';
  const all=['dangerous-command-guard','reviewer-reminder','session-context','agent-config-policy'].map(n=>`.claude/hooks/__tests__/${n}.test.cjs`);
  for(const [command,expected,tool] of [
    // the verified invocations: CI, /verificar and any subset of the suites
    [`node --test ${all.join(' ')}`,'allow'],
    [`node --test ${all.join(' ').replaceAll('/','\\')}`,'allow','PowerShell'],
    [`node --test ${suite}`,'allow'],
    // discovery, folders, patterns and any other argument, before or after the files
    ['node --test','ask'],
    ['node --test --test-timeout 60000','ask'],
    ['node --test --test-shard 1/2','ask'],
    ['node --test --test-skip-pattern x','ask'],
    ['node --test --test-isolation none','ask'],
    ['node --test --test-name-pattern=sintetico','ask'],
    ['node --test .claude/agent-memory','ask'],
    ['node --test .claude/hooks/__tests__/','ask'],
    ['node --test "**/*.test.cjs"','ask'],
    ['node --test .claude/hooks/__tests__/*.test.cjs','ask'],
    [`node --test ${suite} --require ./x.cjs`,'ask'],
    [`node --test --require ./x.cjs ${suite}`,'ask'],
    [`node --test ${suite} --import data:text/javascript,1`,'ask'],
    [`node --test --test-reporter=spec ${suite}`,'ask'],
    [`node --test ${suite} --test-reporter=sintetico-paquete`,'ask'],
    [`node --test --watch ${suite}`,'ask'],
    [`node --test ${suite} docs/sintetico.test.cjs`,'ask'],
    [`node --experimental-config-file=node.config.json --test ${suite}`,'ask'],
    [`node --env-file=sintetico.env --test ${suite}`,'ask'],
    [`NODE_OPTIONS="--require ./x.cjs" node --test ${suite}`,'ask'],
    [`tsx --test ${suite}`,'ask'],
    ['node --version','allow'],
  ])assert.equal(decision(command,tool),expected,command);
  // Outside node --test, a reporter or global setup module is still a script that runs in the process: it is analysed.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-reporters-'));
  try{
    fs.writeFileSync(path.join(dir,'escribe.mjs'),"import fs from 'node:fs';fs.writeFileSync('.claude/agents/sintetico.md','x');export default async function*(){}\n");
    fs.writeFileSync(path.join(dir,'lee.mjs'),'export default async function*(source){for await (const e of source)yield e.type+"\\n";}\n');
    const at=name=>slash(path.join(dir,name));
    assert.equal(decision(`node --test-reporter=${at('escribe.mjs')} ${at('lee.mjs')}`),'ask');
    assert.equal(decision(`node --test-global-setup=${at('escribe.mjs')} ${at('lee.mjs')}`),'ask');
    assert.equal(decision(`node --test-reporter=${at('lee.mjs')} ${at('lee.mjs')}`),'allow');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  // The same name in another checkout: allowed only with the reviewed content and the same hooks as this checkout.
  const worktrees=path.join(root,'.claude','worktrees');
  const created=!fs.existsSync(worktrees);
  const nested=path.join(worktrees,`guard-suites-${process.pid}`);
  const hooks=path.join(nested,'.claude','hooks');
  const suites=path.join(hooks,'__tests__');
  const name='reviewer-reminder.test.cjs';
  fs.mkdirSync(suites,{recursive:true});
  try{
    const copy=path.join(suites,name);
    fs.copyFileSync(path.join(root,'.claude','hooks','__tests__',name),copy);
    assert.equal(decision(`node --test ${slash(copy)}`),'ask','the hooks it loads are missing');
    for(const hook of ['dangerous-command-guard','reviewer-reminder','session-context'])
      fs.copyFileSync(path.join(root,'.claude','hooks',`${hook}.cjs`),path.join(hooks,`${hook}.cjs`));
    assert.equal(decision(`node --test ${slash(copy)}`),'allow','reviewed suite and identical hooks');
    // A Windows checkout (core.autocrlf, as in the CI job) has CRLF endings: the pins compare LF content.
    const crlf=file=>fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'));
    crlf(copy);
    for(const hook of ['dangerous-command-guard','reviewer-reminder','session-context'])crlf(path.join(hooks,`${hook}.cjs`));
    assert.ok(fs.readFileSync(copy,'utf8').includes('\r\n'),'the copy uses CRLF');
    assert.equal(decision(`node --test ${slash(copy)}`),'allow','CRLF checkout');
    assert.equal(decision(`node --test ${slash(copy)} --test-isolation none`),'ask','an extra argument asks');
    fs.appendFileSync(path.join(hooks,'reviewer-reminder.cjs'),"\nrequire('fs').writeFileSync('.claude/agents/sintetico.md','x');\n");
    assert.equal(decision(`node --test ${slash(copy)}`),'ask','a hook the suite loads was changed');
    fs.copyFileSync(path.join(root,'.claude','hooks','reviewer-reminder.cjs'),path.join(hooks,'reviewer-reminder.cjs'));
    fs.appendFileSync(copy,"\nrequire('fs').writeFileSync('.claude/agents/sintetico.md','x');\n");
    assert.equal(decision(`node --test ${slash(copy)}`),'ask','substituted suite');
  }finally{
    fs.rmSync(nested,{recursive:true,force:true});
    if(created)fs.rmSync(worktrees,{recursive:true,force:true});
  }
});

test('control plane: git apply and patch read the patch paths',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-patch-'));
  try{
    const patch=(file)=>`diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-a\n+b\n`;
    fs.writeFileSync(path.join(dir,'memoria.patch'),patch('.claude/agent-memory/financial-reviewer/MEMORY.md'));
    fs.writeFileSync(path.join(dir,'docs.patch'),patch('docs/sintetico.md'));
    const at=name=>slash(path.join(dir,name));
    assert.equal(decision(`git apply ${at('memoria.patch')}`),'ask');
    assert.equal(decision(`git apply ${at('docs.patch')}`),'allow');
    assert.equal(decision(`patch -p1 < ${at('memoria.patch')}`),'ask');
    assert.equal(decision(`git apply <<'EOF'\n${patch('CLAUDE.md')}EOF`),'ask');
    assert.equal(decision(`git apply ${at('no-existe.patch')}`),'ask','an unreadable patch asks');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
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
