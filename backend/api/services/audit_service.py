"""
Audit trail helpers.

Centralises the `changes` JSON shape written into AuditLog rows so every
call site produces the same structure. The frontend renders a single
diff table against this shape; divergence here means the UI breaks.

Canonical shape (all action_types):
    {
        "source": "<free-form tag — e.g. HOD_BREAKDOWN_EDIT, STAFF_IMPORT>",
        "diffs": [
            {"field": "<human label>", "before": "<str>", "after": "<str>"},
            ...
        ],
        "staff_number": "<optional, for PROFILE_EDIT when report is None>",
        "extra": {...}  # optional opaque payload (batch ids etc.)
    }

Writes never raise to the caller — audit failure must not break the
business write. Instead they swallow and log (Django's default logger).
"""
import logging
from decimal import Decimal
from typing import Any, Iterable

from api.models import AuditLog

logger = logging.getLogger(__name__)


def _stringify(value: Any) -> str:
    """Render a value for display in the diff table.

    Decimal → fixed-point string; None → empty string; everything else → str().
    """
    if value is None:
        return ''
    if isinstance(value, Decimal):
        return format(value, 'f')
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value)


def compute_diffs(
    before: dict,
    after: dict,
    field_labels: dict | None = None,
) -> list[dict]:
    """Return field-level diffs between two flat dicts.

    Only keys present in both dicts are compared; keys with equal values are
    dropped. `field_labels` maps internal key to display label.
    """
    labels = field_labels or {}
    diffs: list[dict] = []
    for key in after.keys():
        if key not in before:
            continue
        b_val = before[key]
        a_val = after[key]
        if _stringify(b_val) == _stringify(a_val):
            continue
        diffs.append({
            'field': labels.get(key, key),
            'before': _stringify(b_val),
            'after': _stringify(a_val),
        })
    return diffs


def compute_workload_item_diffs(
    before_items: Iterable[dict],
    after_items: Iterable[dict],
) -> list[dict]:
    """Diff WorkloadItem snapshots pair-wise by (category, unit_code or description).

    Each snapshot item must have keys: category, unit_code, description, allocated_hours.
    Missing / added rows produce a diff where the absent side is shown as empty.
    """
    def _key(item: dict) -> tuple:
        return (item.get('category', ''), item.get('unit_code') or item.get('description') or '')

    def _label(item: dict) -> str:
        name = item.get('unit_code') or item.get('description') or item.get('category', '')
        return f"{item.get('category', '')}: {name} hours"

    before_map = {_key(i): i for i in before_items}
    after_map = {_key(i): i for i in after_items}

    diffs: list[dict] = []
    # Removed + modified rows
    for k, b_item in before_map.items():
        a_item = after_map.get(k)
        if a_item is None:
            diffs.append({
                'field': _label(b_item),
                'before': _stringify(b_item.get('allocated_hours')),
                'after': '',
            })
        elif _stringify(a_item.get('allocated_hours')) != _stringify(b_item.get('allocated_hours')):
            diffs.append({
                'field': _label(b_item),
                'before': _stringify(b_item.get('allocated_hours')),
                'after': _stringify(a_item.get('allocated_hours')),
            })
    # Added rows (in after but not before)
    for k, a_item in after_map.items():
        if k not in before_map:
            diffs.append({
                'field': _label(a_item),
                'before': '',
                'after': _stringify(a_item.get('allocated_hours')),
            })
    return diffs


def snapshot_workload_items(items_qs) -> list[dict]:
    """Capture a list[dict] snapshot of WorkloadItem rows for audit storage.

    Call BEFORE deleting the items — once the queryset is evaluated the
    snapshot survives any subsequent DB state change.
    """
    return [
        {
            'category': it.category,
            'unit_code': it.unit_code,
            'description': it.description,
            'allocated_hours': _stringify(it.allocated_hours),
        }
        for it in items_qs
    ]


def write_audit(
    *,
    action_type: str,
    action_by,
    report=None,
    source: str = '',
    diffs: list[dict] | None = None,
    comment: str | None = None,
    staff_number: str | None = None,
    extra: dict | None = None,
) -> AuditLog | None:
    """Write an AuditLog row using the canonical changes shape.

    Returns the created row or None on failure. Never raises — audit failure
    must not abort the business transaction.
    """
    changes: dict = {'source': source, 'diffs': diffs or []}
    if staff_number:
        changes['staff_number'] = staff_number
    if extra:
        changes['extra'] = extra
    try:
        return AuditLog.objects.create(
            report=report,
            action_by=action_by,
            action_type=action_type,
            comment=comment,
            changes=changes,
        )
    except Exception:
        logger.exception('audit log write failed: action_type=%s', action_type)
        return None
