// Keeps the Codex copy of the agent skills identical to the Claude Code copy.
// Source of truth: .claude/skills. Target: .agents/skills (read by Codex).
//   npm run skills:sync   copies new and changed files and removes files that no longer exist in the source.
//   npm run skills:check  only compares; exits 1 and lists the differences (same check as CI's `diff -r`).
// Byte-for-byte comparison, no line-ending conversion. Never touches anything outside the two folders.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(root, '.claude', 'skills');
const DEFAULT_TARGET = path.join(root, '.agents', 'skills');

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Linked file not supported: ${full}`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return files.sort();
}

function compareSkills(source = DEFAULT_SOURCE, target = DEFAULT_TARGET) {
  if (!fs.existsSync(source)) {
    throw new Error(`Source folder not found: ${source}`);
  }
  const sourceFiles = listFiles(source);
  const targetFiles = new Set(listFiles(target));
  const added = [];
  const changed = [];
  for (const file of sourceFiles) {
    if (!targetFiles.has(file)) {
      added.push(file);
    } else if (!fs.readFileSync(path.join(source, file)).equals(fs.readFileSync(path.join(target, file)))) {
      changed.push(file);
    }
    targetFiles.delete(file);
  }
  return {added, changed, removed: [...targetFiles].sort()};
}

function removeEmptyDirectories(dir, keep) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(dir, entry.name), false);
    }
  }
  if (!keep && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

function syncSkills(source = DEFAULT_SOURCE, target = DEFAULT_TARGET) {
  const diff = compareSkills(source, target);
  for (const file of [...diff.added, ...diff.changed]) {
    fs.mkdirSync(path.dirname(path.join(target, file)), {recursive: true});
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
  for (const file of diff.removed) {
    fs.unlinkSync(path.join(target, file));
  }
  if (fs.existsSync(target)) {
    removeEmptyDirectories(target, true);
  }
  return diff;
}

const describe = diff =>
  [
    ...diff.added.map(file => `  + ${file}`),
    ...diff.changed.map(file => `  ~ ${file}`),
    ...diff.removed.map(file => `  - ${file}`),
  ].join('\n');

if (require.main === module) {
  const check = process.argv.includes('--check');
  const diff = check ? compareSkills() : syncSkills();
  const count = diff.added.length + diff.changed.length + diff.removed.length;
  if (count === 0) {
    console.log('.agents/skills is identical to .claude/skills');
  } else if (check) {
    console.error(`.agents/skills differs from .claude/skills (${count} files). Run: npm run skills:sync\n${describe(diff)}`);
    process.exitCode = 1;
  } else {
    console.log(`Synchronized ${count} files into .agents/skills:\n${describe(diff)}`);
  }
}

module.exports = {compareSkills, syncSkills};
