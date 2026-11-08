// Module scope: keeps these helpers from clashing with globals declared by other test scripts.
export {};

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

type SkillsDiff = {added: string[]; changed: string[]; removed: string[]};
const {compareSkills, syncSkills} = require('../scripts/syncAgentSkills') as {
  compareSkills: (source: string, target: string) => SkillsDiff;
  syncSkills: (source: string, target: string) => SkillsDiff;
};

let work: string;
let source: string;
let target: string;
const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
  fs.writeFileSync(path.join(dir, file), text);
};

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartfin-skills-'));
  source = path.join(work, 'source');
  target = path.join(work, 'target');
  write(source, 'alpha/SKILL.md', 'alpha\n');
  write(source, 'alpha/references/guide.md', 'guide\n');
  write(source, 'beta/SKILL.md', 'beta\n');
});
afterEach(() => fs.rmSync(work, {recursive: true, force: true}));

test('sync copies a missing target and leaves both copies identical', () => {
  expect(syncSkills(source, target)).toEqual({
    added: ['alpha/SKILL.md', 'alpha/references/guide.md', 'beta/SKILL.md'],
    changed: [],
    removed: [],
  });
  expect(compareSkills(source, target)).toEqual({added: [], changed: [], removed: []});
});

test('check reports added, changed and removed files without writing', () => {
  syncSkills(source, target);
  write(source, 'gamma/SKILL.md', 'gamma\n');
  write(source, 'alpha/SKILL.md', 'alpha v2\n');
  write(target, 'obsolete/SKILL.md', 'old\n');
  const before = fs.readFileSync(path.join(target, 'alpha/SKILL.md'), 'utf8');
  expect(compareSkills(source, target)).toEqual({
    added: ['gamma/SKILL.md'],
    changed: ['alpha/SKILL.md'],
    removed: ['obsolete/SKILL.md'],
  });
  expect(fs.readFileSync(path.join(target, 'alpha/SKILL.md'), 'utf8')).toBe(before);
  expect(fs.existsSync(path.join(target, 'gamma'))).toBe(false);
});

test('sync applies every difference and removes empty folders of deleted skills', () => {
  syncSkills(source, target);
  write(source, 'alpha/SKILL.md', 'alpha v2\n');
  write(target, 'obsolete/references/old.md', 'old\n');
  syncSkills(source, target);
  expect(fs.readFileSync(path.join(target, 'alpha/SKILL.md'), 'utf8')).toBe('alpha v2\n');
  expect(fs.existsSync(path.join(target, 'obsolete'))).toBe(false);
  expect(compareSkills(source, target)).toEqual({added: [], changed: [], removed: []});
});

test('line endings count as a difference, as in the CI diff', () => {
  syncSkills(source, target);
  write(target, 'beta/SKILL.md', 'beta\r\n');
  expect(compareSkills(source, target).changed).toEqual(['beta/SKILL.md']);
});

test('a missing source folder is an error, never an empty sync that deletes the target', () => {
  syncSkills(source, target);
  expect(() => syncSkills(path.join(work, 'missing'), target)).toThrow('Source folder not found');
  expect(fs.existsSync(path.join(target, 'alpha/SKILL.md'))).toBe(true);
});
