import { ReactNode, useEffect, useMemo, useState } from "react";

import InfoField from "./InfoField";

export type WorkloadBreakdownCategory =
  | "Teaching"
  | "Assigned Roles"
  | "HDR"
  | "Service"
  | "Research (residual)";

export type WorkloadBreakdownRow = {
  name: string;
  hours: number;
  excludeFromWorkloadTotal?: boolean;
  roleHourConflict?: boolean;
  teachingDuplicateUnit?: boolean;
};

export type WorkloadBreakdownData = Record<WorkloadBreakdownCategory, WorkloadBreakdownRow[]>;

export type WorkloadDetailField = {
  label: string;
  value: string;
  className?: string;
  inputClassName?: string;
  tooltipText?: string;
  tooltipClassName?: string;
};

export type WorkloadDetailNoteSection = {
  label: string;
  value: string;
  placeholder?: string;
  rows?: number;
  collapsible?: boolean;
  defaultExpanded?: boolean;
};

type WorkloadDetailModalProps = {
  title: string;
  fields: WorkloadDetailField[];
  breakdown: WorkloadBreakdownData;
  tabs: WorkloadBreakdownCategory[];
  rowKeyPrefix: string | number;
  onClose: () => void;
  notesSections?: WorkloadDetailNoteSection[];
  footer?: ReactNode;
  historyAction?: ReactNode;
  /** When provided, renders an Edit toggle in the breakdown header */
  onEditModeToggle?: () => void;
  /** When true, breakdown rows are rendered as editable inputs */
  breakdownEditMode?: boolean;
  onBreakdownRowChange?: (tab: WorkloadBreakdownCategory, idx: number, field: "name" | "hours", value: string) => void;
  onBreakdownRowAdd?: (tab: WorkloadBreakdownCategory) => void;
  onBreakdownRowRemove?: (tab: WorkloadBreakdownCategory, idx: number) => void;
  /** Categories that must remain read-only even in edit mode */
  readonlyBreakdownTabs?: WorkloadBreakdownCategory[];
};

export default function WorkloadDetailModal({
  title,
  fields,
  breakdown,
  tabs,
  rowKeyPrefix,
  onClose,
  notesSections = [],
  footer,
  historyAction,
  onEditModeToggle,
  breakdownEditMode = false,
  onBreakdownRowChange,
  onBreakdownRowAdd,
  onBreakdownRowRemove,
  readonlyBreakdownTabs = ["Research (residual)"],
}: WorkloadDetailModalProps) {
  const [activeTab, setActiveTab] = useState<WorkloadBreakdownCategory>(tabs[0] ?? "Teaching");
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setActiveTab(tabs[0] ?? "Teaching");
  }, [rowKeyPrefix, tabs]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    notesSections.forEach((section) => {
      next[section.label] = section.defaultExpanded ?? !section.collapsible;
    });
    setExpandedNotes(next);
  }, [rowKeyPrefix, notesSections]);

  const rows = useMemo(
    () => breakdown[activeTab] ?? [],
    [activeTab, breakdown]
  );
  const tabTotal = useMemo(
    () => rows.reduce((sum, row) => sum + (row.excludeFromWorkloadTotal ? 0 : Number(row.hours || 0)), 0),
    [rows]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-sm bg-white p-0 shadow" onClick={(event) => event.stopPropagation()}>
        <div className="rounded-sm border border-black">
          <div className="flex items-center justify-between rounded-t-sm bg-[#2f4d9c] px-5 py-3 text-white">
            <div className="text-lg font-bold">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
            >
              <span className="text-xl leading-none">x</span>
            </button>
          </div>

          <div className="max-h-[72vh] overflow-y-auto space-y-4 px-5 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <InfoField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                  className={field.className}
                  inputClassName={field.inputClassName}
                  tooltipText={field.tooltipText}
                  tooltipClassName={field.tooltipClassName}
                />
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-slate-500">Workload Breakdown</div>
                {onEditModeToggle && (
                  <button
                    type="button"
                    onClick={onEditModeToggle}
                    className="rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white hover:bg-[#264183]"
                  >
                    {breakdownEditMode ? "Done" : "Edit"}
                  </button>
                )}
              </div>
              <div className="mt-1 overflow-hidden rounded border border-slate-300">
                <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded px-3 py-1 text-xs font-semibold ${
                        activeTab === tab
                          ? "bg-[#2f4d9c] text-white"
                          : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {(() => {
                  const isEditing = breakdownEditMode && !readonlyBreakdownTabs.includes(activeTab);
                  const showActionCol = isEditing;
                  return (
                    <table className="min-w-full">
                      <thead className="bg-white">
                        <tr className="text-left text-xs font-semibold uppercase text-slate-600">
                          <th className="px-3 py-2">{activeTab}</th>
                          <th className="px-3 py-2 text-right">Hours</th>
                          {showActionCol && <th className="w-[88px] px-3 py-2 text-center">Action</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                        {rows.map((row, idx) => {
                          const isHdrSummaryRow = activeTab === "HDR" && row.name === "HDR Total";
                          const conflictHighlightRow = Boolean(row.roleHourConflict || row.teachingDuplicateUnit);
                          return (
                            <tr
                              key={`${rowKeyPrefix}-${activeTab}-${idx}`}
                              className={conflictHighlightRow ? "bg-red-50" : isHdrSummaryRow ? "bg-slate-50" : undefined}
                            >
                              <td className={`px-3 py-2 ${isHdrSummaryRow ? "font-bold text-slate-800" : ""} ${conflictHighlightRow ? "font-semibold text-red-900" : ""}`}>
                                {isEditing ? (
                                  <input
                                    value={row.name}
                                    onChange={(e) => onBreakdownRowChange?.(activeTab, idx, "name", e.target.value)}
                                    maxLength={60}
                                    className="w-[220px] max-w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                  />
                                ) : row.name}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums font-sans ${isHdrSummaryRow ? "font-bold text-slate-800" : ""} ${conflictHighlightRow ? "font-semibold text-red-900" : ""}`}>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    maxLength={8}
                                    value={String(row.hours)}
                                    onChange={(e) => onBreakdownRowChange?.(activeTab, idx, "hours", e.target.value)}
                                    className="ml-auto w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums font-sans"
                                  />
                                ) : row.hours}
                              </td>
                              {showActionCol && (
                                <td className="px-3 py-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => onBreakdownRowRemove?.(activeTab, idx)}
                                    disabled={rows.length <= 1}
                                    className="rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {isEditing && (
                          <tr>
                            <td colSpan={3} className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => onBreakdownRowAdd?.(activeTab)}
                                className="rounded bg-[#2f4d9c] px-3 py-1 text-xs font-semibold text-white hover:bg-[#264183]"
                              >
                                + Add Row
                              </button>
                            </td>
                          </tr>
                        )}
                        {activeTab !== "HDR" && (
                          <tr className="bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-800">
                              {workloadBreakdownTotalLabel(activeTab)}
                            </td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums font-sans text-slate-800">
                              {tabTotal}
                            </td>
                            {showActionCol && <td />}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>

            {notesSections.map((section) => {
              const expanded = expandedNotes[section.label] ?? !section.collapsible;
              return (
                <div key={section.label}>
                  {section.collapsible ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedNotes((prev) => ({ ...prev, [section.label]: !expanded }))
                      }
                      className="flex w-full items-center justify-between rounded border border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500"
                    >
                      <span>{section.label}</span>
                      <span className="text-base leading-none">{expanded ? "-" : "+"}</span>
                    </button>
                  ) : (
                    <div className="mb-1 text-xs font-semibold text-slate-500">{section.label}</div>
                  )}
                  {expanded && (
                    <textarea
                      readOnly
                      value={section.value}
                      placeholder={section.placeholder}
                      rows={section.rows ?? 4}
                      className="mt-1 w-full resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-500 read-only:bg-slate-50"
                    />
                  )}
                </div>
              );
            })}

            {historyAction ? <div className="flex justify-end pt-1">{historyAction}</div> : null}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

function workloadBreakdownTotalLabel(tab: WorkloadBreakdownCategory): string {
  switch (tab) {
    case "Teaching":
      return "Teaching Total";
    case "HDR":
      return "HDR Total";
    case "Service":
      return "Service Total";
    case "Assigned Roles":
      return "Assigned Roles Total";
    case "Research (residual)":
      return "Research Total";
    default:
      return "Total";
  }
}
