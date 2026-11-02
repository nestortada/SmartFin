"""Read-only package validation; never opens financial databases or secret files."""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
from pathlib import Path

import yaml


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def inventory(folder: Path) -> dict[str, str]:
    require(folder.is_dir(), f"Missing skill directory: {folder}")
    result = {}
    for item in sorted(folder.rglob("*")):
        require(not item.is_symlink() and not item.is_junction(), "Linked skill entry")
        if item.is_file():
            require(item.suffix == ".md", "Unexpected non-document skill resource")
            result[item.relative_to(folder).as_posix()] = hashlib.sha256(item.read_bytes()).hexdigest()
    return result


def expand_braces(value: str) -> list[str]:
    match = re.search(r"\{([^{}]+)\}", value)
    if not match:
        return [value]
    return list(itertools.chain.from_iterable(
        expand_braces(value[:match.start()] + option + value[match.end():])
        for option in match[1].split(",")
    ))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed", action="store_true", help="Also compare installed physical copies")
    args = parser.parse_args()
    delivery = Path(__file__).resolve().parent
    repo = next(p for p in delivery.parents if (p / "AGENTS.md").is_file())
    name = "smartfin-security-privacy"
    canonical = delivery / ".agents/skills" / name
    distribution = delivery / ".claude/skills" / name
    expected = inventory(canonical)
    require(expected == inventory(distribution), "Distribution differs from canonical staging")
    require(len(expected) == 12, "Expected entrypoint and eleven nonempty references")
    require(not (repo / ".codex/skills" / name).exists(), "Unexpected duplicate in .codex/skills")
    body = (canonical / "SKILL.md").read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---\n", body, re.S)
    require(match is not None, "Malformed frontmatter")
    frontmatter = yaml.safe_load(match[1])
    require(isinstance(frontmatter, dict) and set(frontmatter) == {"name", "description"}, "Nonportable frontmatter")
    require(frontmatter["name"] == name, "Wrong skill name")
    require(isinstance(frontmatter["description"], str) and 0 < len(frontmatter["description"]) <= 1024, "Invalid description")
    code_roots = [repo / item for item in ["src", "android/app/src/main/java", "scripts", "__tests__"]]
    known_names = {p.name for root in code_roots for p in root.rglob("*") if p.is_file()}
    source_paths = set()
    reference_links = set()
    for relative in expected:
        file = canonical / relative
        content = file.read_text(encoding="utf-8")
        require(len(content.strip()) > 120, f"Empty reference: {relative}")
        require(not re.search(r"\[TODO:|\[INSERT", content), f"Unfinished scaffold: {relative}")
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
            if re.match(r"https?://", target):
                continue
            resolved = (file.parent / target.split("#")[0]).resolve()
            require(resolved.is_relative_to(canonical), f"Reference escapes skill: {relative}")
            require(resolved.is_file(), f"Broken reference in {relative}: {target}")
            reference_links.add(resolved.relative_to(canonical).as_posix())
        for token in re.findall(r"(?<!`)`([^`\n]+)`(?!`)", content):
            for value in expand_braces(token):
                if value.startswith(("src/", "android/", "scripts/", "__tests__/", "docs/", ".agents/", ".claude/", ".codex/", ".github/")):
                    if value.startswith((f".agents/skills/{name}", f".claude/skills/{name}")):
                        continue  # Installation target is deliberately not claimed present.
                    require((repo / value).exists(), f"Missing source path in {relative}: {value}")
                    source_paths.add(value)
                elif re.fullmatch(r"[A-Za-z][\w-]+\.(ts|tsx|kt|js|cjs)", value):
                    require(value in known_names, f"Missing source filename in {relative}: {value}")
        # Report only type/file on failure, never matching values.
        patterns = [r"AIza[0-9A-Za-z_-]{30,}", r"gh[pousr]_[0-9A-Za-z]{30,}",
                    r"sk-(?:proj-)?[0-9A-Za-z_-]{30,}", r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"]
        require(not any(re.search(pattern, content) for pattern in patterns), f"Credential candidate in {relative}; inspect privately")
    require(set(expected) - {"SKILL.md"} <= reference_links, "Unreachable reference")
    installed = []
    if args.installed:
        for target in [repo / ".agents/skills" / name, repo / ".claude/skills" / name]:
            require(expected == inventory(target), f"Installed copy differs: {target}")
            installed.append(target.relative_to(repo).as_posix())
    print(json.dumps({"status": "PASS", "skill_files_per_copy": len(expected),
                      "references": len(reference_links), "source_paths": len(source_paths),
                      "physical_copies_identical": True, "installed_checked": installed,
                      "credential_pattern_candidates_in_skill": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
