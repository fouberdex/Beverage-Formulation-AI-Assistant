from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from beverage_rag.rag.evidence import contains_any, insert_under_section, normalize_text


@dataclass(frozen=True)
class ChemistryRule:
    rule_id: str
    severity: str
    action_groups: list[list[str]]
    context_any: list[str]
    warning: str

    def matches(self, action: str, context: str, protective_terms: list[str]) -> bool:
        if contains_any(action, protective_terms):
            return False
        return all(contains_any(action, group) for group in self.action_groups) and (
            not self.context_any or contains_any(context, self.context_any)
        )


@dataclass(frozen=True)
class ChemistryPolicy:
    path: Path
    enabled: bool
    protective_terms: list[str]
    rules: list[ChemistryRule]

    @classmethod
    def load(cls, path: Path) -> "ChemistryPolicy":
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        rules = [
            ChemistryRule(
                rule_id=value["id"],
                severity=value["severity"],
                action_groups=[list(group) for group in value.get("action_groups", [])],
                context_any=list(value.get("context_any", [])),
                warning=str(value["warning"]),
            )
            for value in payload.get("rules", [])
        ]
        invalid = [rule.rule_id for rule in rules if rule.severity not in {"block", "warn"}]
        if invalid:
            raise ValueError(f"Invalid chemistry rule severity: {', '.join(invalid)}")
        return cls(
            path=path,
            enabled=bool(payload.get("enabled", True)),
            protective_terms=list(payload.get("protective_terms", [])),
            rules=rules,
        )


@dataclass(frozen=True)
class ChemistryControlResult:
    answer: str
    action_table_found: bool
    blocked_actions: tuple[str, ...]
    warnings_added: int
    unsafe_action_remaining: bool


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def _column(headers: list[str], name: str) -> int | None:
    wanted = normalize_text(name)
    return next(
        (index for index, value in enumerate(headers) if wanted in normalize_text(value)),
        None,
    )


def _action_section(answer: str) -> str:
    lines = answer.splitlines()
    start = next(
        (
            index
            for index, line in enumerate(lines)
            if line.lstrip().startswith("#")
            and "actions correctives" in normalize_text(line)
        ),
        None,
    )
    if start is None:
        return ""
    end = next(
        (
            index
            for index in range(start + 1, len(lines))
            if lines[index].lstrip().startswith("#")
        ),
        len(lines),
    )
    return "\n".join(lines[start:end])


def apply_chemistry_guardrails(
    answer: str,
    question: str,
    policy: ChemistryPolicy,
    no_safe_action_message: str,
) -> ChemistryControlResult:
    lines = answer.splitlines()
    context = f"{question}\n{answer}"
    blocked: list[str] = []
    warnings: list[str] = []
    action_table_found = False
    index = 0
    while index < len(lines):
        if "|" not in lines[index]:
            index += 1
            continue
        headers = _cells(lines[index])
        action_index = _column(headers, "action")
        risk_index = _column(headers, "risque")
        if action_index is None or risk_index is None:
            index += 1
            continue
        action_table_found = True
        row_index = index + 1
        if row_index < len(lines) and _separator(_cells(lines[row_index])):
            row_index += 1
        original_rows = 0
        kept_rows = 0
        while row_index < len(lines) and lines[row_index].strip().startswith("|"):
            cells = _cells(lines[row_index])
            if len(cells) != len(headers) or _separator(cells):
                row_index += 1
                continue
            original_rows += 1
            action = cells[action_index]
            matched = [
                rule
                for rule in policy.rules
                if rule.matches(action, context, policy.protective_terms)
            ]
            blocking = [rule for rule in matched if rule.severity == "block"]
            if blocking:
                blocked.append(action)
                warnings.extend(rule.warning for rule in blocking)
                del lines[row_index]
                continue
            warning_rules = [rule for rule in matched if rule.severity == "warn"]
            if warning_rules:
                warning_text = " ".join(rule.warning for rule in warning_rules)
                cells[risk_index] = f"{cells[risk_index]} {warning_text}".strip()
                lines[row_index] = "| " + " | ".join(cells) + " |"
                warnings.extend(rule.warning for rule in warning_rules)
            kept_rows += 1
            row_index += 1
        if original_rows and kept_rows == 0:
            placeholder = ["—"] * len(headers)
            placeholder[action_index] = no_safe_action_message
            placeholder[risk_index] = "Actions proposées écartées par le garde-fou chimique."
            lines.insert(row_index, "| " + " | ".join(placeholder) + " |")
        index = row_index + 1
    guarded = "\n".join(lines)
    guarded = insert_under_section(
        guarded,
        "actions correctives",
        list(dict.fromkeys(warnings)),
    )
    remaining_section = _action_section(guarded)
    unsafe_remaining = any(
        rule.severity == "block"
        and rule.matches(remaining_section, f"{question}\n{guarded}", policy.protective_terms)
        for rule in policy.rules
    )
    return ChemistryControlResult(
        answer=guarded,
        action_table_found=action_table_found,
        blocked_actions=tuple(blocked),
        warnings_added=len(set(warnings)),
        unsafe_action_remaining=unsafe_remaining,
    )
