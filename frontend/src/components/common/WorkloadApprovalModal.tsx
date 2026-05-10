import { useMemo, useState } from "react";
import WorkloadDetailModal, { type WorkloadBreakdownCategory } from "./WorkloadDetailModal";
import { apiJson } from "../../api/client";

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service" | "Research (residual)";
type BreakdownEntry = { name: string; hours: number };
type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

const APPROVAL_BREAKDOWN_TABS: BreakdownCategory[] = [
  "Teaching",
  "HDR",
  "Service",
  "Assigned Roles",
  "Research (residual)",
];

function emptyBreakdown(): BreakdownData {
  return {
    Teaching: [],
    "Assigned Roles": [],
    HDR: [],
    Service: [],
    "Research (residual)": [],
  };
}

export type WorkloadApprovalItem = {
  periodLabel: string;
  semesterLabel: string;
  department: string;
  name: string;
  studentId: string;
  targetTeachingRatio?: number;
  actualTeachingRatio?: number;
  hours: number;
  expectedMinHours?: number | null;
  expectedMaxHours?: number | null;
  employmentType?: string;
  newStaff?: string;
  reviewRequired?: boolean;
  notes?: string;
  requestReason?: string;
  status: "pending" | "approved" | "rejected";
  version?: string | null;
  detailSnapshot?: { breakdown: BreakdownData };
};

type Props = {
  item: WorkloadApprovalItem;
  /** UUID string used in API calls. */
  itemId: string;
  /**
   * API path for the approve/reject decision.
   * Must contain `:id` which is replaced with `itemId` at call time.
   * e.g. "/api/hod/workload-requests/:id/decision/"
   */
  decisionApiPath: string;
  /** Label shown for the "review" field, e.g. "HoD Review" or "HoS Review". */
  reviewLabel: string;
  /** Who the note is addressed to, e.g. "Academic" or "HoD". */
  noteRecipientLabel: string;
  onClose: () => void;
  onDecisionComplete: () => Promise<void>;
};

export default function WorkloadApprovalModal({
  item,
  itemId,
  decisionApiPath,
  reviewLabel,
  noteRecipientLabel,
  onClose,
  onDecisionComplete,
}: Props) {
  const [breakdown, setBreakdown] = useState<BreakdownData>(
    item.detailSnapshot?.breakdown ?? emptyBreakdown()
  );
  const [editMode, setEditMode] = useState(false);
  const [modalError, setModalError] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteKind, setNoteKind] = useState<"approve" | "reject">("approve");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const actualTeachingRatio = useMemo(() => {
    if (typeof item.actualTeachingRatio === "number" && !editMode) {
      return `${item.actualTeachingRatio.toFixed(1)}%`;
    }
    const teaching = breakdown.Teaching.reduce((s, r) => s + r.hours, 0);
    const total = APPROVAL_BREAKDOWN_TABS.reduce(
      (s, tab) => s + breakdown[tab].reduce((ts, r) => ts + r.hours, 0),
      0
    );
    return total <= 0 ? "0.0%" : `${((teaching / total) * 100).toFixed(1)}%`;
  }, [breakdown, editMode, item.actualTeachingRatio]);

  const totalHoursDisplay = useMemo(() => {
    const raw = editMode
      ? APPROVAL_BREAKDOWN_TABS.reduce(
          (s, tab) => s + breakdown[tab].reduce((ts, r) => ts + r.hours, 0),
          0
        )
      : item.hours;
    const display = (Math.round(raw * 10) / 10).toFixed(1);
    if (!editMode && item.expectedMinHours != null && item.expectedMaxHours != null) {
      const minDays = Math.ceil(item.expectedMinHours / 8);
      const maxDays = Math.ceil(item.expectedMaxHours / 8);
      return `${display} (>${minDays} & <=${maxDays} working days)`;
    }
    return display;
  }, [breakdown, editMode, item.hours, item.expectedMinHours, item.expectedMaxHours]);

  const periodTitle = useMemo(() => {
    const matched = item.periodLabel.match(/^(\d{4})-(1|2)$/);
    const period = matched
      ? `${matched[1]}-${matched[2] === "1" ? "S1" : "S2"}`
      : item.semesterLabel || item.periodLabel;
    return `${period}-${item.department}-Academic`;
  }, [item.periodLabel, item.semesterLabel, item.department]);

  const fields = [
    { label: "Name", value: item.name },
    { label: "Staff ID", value: item.studentId },
    {
      label: "Target teaching ratio",
      value:
        typeof item.targetTeachingRatio === "number"
          ? `${item.targetTeachingRatio.toFixed(1)}%`
          : "—",
    },
    { label: "Actual teaching ratio", value: actualTeachingRatio, className: "tabular-nums font-sans" },
    { label: "Total work hours", value: totalHoursDisplay, className: "tabular-nums font-sans" },
    { label: "Employment type", value: item.employmentType || "—" },
    { label: "New Staff", value: item.newStaff || "—" },
    {
      label: reviewLabel,
      value:
        typeof item.reviewRequired === "boolean"
          ? item.reviewRequired ? "Yes" : "No"
          : "—",
    },
  ];

  const notesSections = [
    {
      label: "School of Operations notes",
      value: item.notes?.trim() || "",
      rows: 4 as const,
      collapsible: true,
      defaultExpanded: true,
    },
    {
      label: "Application Reason",
      value: item.requestReason?.trim() || "— no reason provided —",
      rows: 3 as const,
      collapsible: false,
    },
  ];

  function updateRow(tab: WorkloadBreakdownCategory, idx: number, field: "name" | "hours", value: string) {
    setBreakdown((prev) => {
      const rows = [...(prev[tab] ?? [])];
      rows[idx] = {
        ...rows[idx],
        [field]: field === "hours" ? (parseFloat(value) || 0) : value,
      };
      return { ...prev, [tab]: rows };
    });
  }

  function addRow(tab: WorkloadBreakdownCategory) {
    setBreakdown((prev) => ({
      ...prev,
      [tab]: [...(prev[tab] ?? []), { name: "", hours: 0 }],
    }));
  }

  function removeRow(tab: WorkloadBreakdownCategory, idx: number) {
    setBreakdown((prev) => ({
      ...prev,
      [tab]: (prev[tab] ?? []).filter((_, i) => i !== idx),
    }));
  }

  function toggleEdit() {
    if (editMode) {
      const hasEmpty = (Object.keys(breakdown) as WorkloadBreakdownCategory[]).some((tab) =>
        breakdown[tab].some((r) => r.name.trim() === "")
      );
      if (hasEmpty) {
        setModalError("All breakdown rows must have a name.");
        return;
      }
    }
    setModalError("");
    setEditMode((v) => !v);
  }

  async function handleDecision(note: string) {
    setSubmitting(true);
    try {
      const url = decisionApiPath.replace(":id", itemId);
      await apiJson(url, {
        method: "POST",
        body: JSON.stringify({
          decision: noteKind,
          note: note.trim(),
          breakdown,
          ifVersion: item.version,
        }),
      });
      setNoteOpen(false);
      await onDecisionComplete();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <WorkloadDetailModal
        title={periodTitle}
        fields={fields}
        breakdown={breakdown}
        tabs={APPROVAL_BREAKDOWN_TABS}
        rowKeyPrefix={itemId}
        onClose={onClose}
        notesSections={notesSections}
        onEditModeToggle={item.status === "pending" ? toggleEdit : undefined}
        breakdownEditMode={editMode}
        onBreakdownRowChange={updateRow}
        onBreakdownRowAdd={addRow}
        onBreakdownRowRemove={removeRow}
        readonlyBreakdownTabs={["Research (residual)"]}
        footer={
          <div className="flex flex-col items-center gap-2 pt-1">
            {modalError && <p className="text-sm font-semibold text-[#dc2626]">{modalError}</p>}
            {item.status === "pending" && (
              <div className="flex items-center justify-center gap-24">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { setNoteKind("approve"); setNoteDraft(""); setNoteError(""); setNoteOpen(true); }}
                  className="w-56 rounded-sm bg-[#4a9a3d] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { setNoteKind("reject"); setNoteDraft(""); setNoteError(""); setNoteOpen(true); }}
                  className="w-56 rounded-sm bg-[#e53935] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        }
      />

      {noteOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-lg">
            <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
              <div className="text-base font-bold">
                {noteKind === "approve" ? "Approved Notes" : "Rejected Notes"}
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                onClick={() => { setNoteOpen(false); setNoteError(""); }}
              >
                ×
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="text-sm font-semibold text-slate-700">
                Notes for {noteRecipientLabel}
              </div>
              <textarea
                value={noteDraft}
                onChange={(e) => { setNoteDraft(e.target.value); if (noteError) setNoteError(""); }}
                maxLength={240}
                placeholder="Write your feedback..."
                className="h-32 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2f4d9c]"
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{noteError ? <span className="text-[#dc2626]">{noteError}</span> : " "}</span>
                <span>{noteDraft.length}/240</span>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    const trimmed = noteDraft.trim();
                    if (!trimmed) { setNoteError("Note is required."); return; }
                    if (trimmed.length > 240) { setNoteError("Note must be ≤240 characters."); return; }
                    await handleDecision(trimmed);
                  }}
                  className="rounded bg-[#2f4d9c] px-6 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Finished"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
