import { useEffect, useMemo, useState } from "react";

type AcademicItem = {
  id: number;
  name: string;
  employeeId: string;
  description: string;
  hours: number;
  status: "pending" | "approved" | "rejected" | "";
  confirmation: "confirmed" | "unconfirmed";
};

type BreakdownEntry = {
  name: string;
  hours: number;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service";

type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;
type SupervisorDraftRequest = {
  id: number;
  studentId: string;
  semesterLabel: string;
  periodLabel: string;
  name: string;
  unit: string;
  description: string;
  requestReason?: string;
  title: string;
  department: string;
  rate: number;
  status: "pending";
  hours: number;
};

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";

function readAcademicStatusSync(): Record<string, "pending" | "approved" | "rejected"> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACADEMIC_STATUS_SYNC_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, "pending" | "approved" | "rejected">;
  } catch {
    return {};
  }
}

function applySyncedStatus(
  rows: AcademicItem[],
  synced: Record<string, "pending" | "approved" | "rejected">
) {
  return rows.map((item) => {
    const syncedStatus = synced[item.employeeId];
    if (!syncedStatus) return item;
    return {
      ...item,
      status: syncedStatus,
    };
  });
}

function pushedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 9 + (id % 8);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:30`;
}

function breakdownById(id: number): BreakdownData {
  const patterns: BreakdownData[] = [
    {
      Teaching: [
        { name: "CITS2401", hours: 15 },
        { name: "CITS2200", hours: 5 },
      ],
      "Assigned Roles": [
        { name: "Program Chair", hours: 20 },
        { name: "Outreach Chair", hours: 10 },
        { name: "Accreditation", hours: 20 },
      ],
      HDR: [
        { name: "Student A", hours: 2 },
        { name: "Student B", hours: 2 },
      ],
      Service: [
        { name: "Committee support", hours: 6 },
        { name: "Peer review", hours: 4 },
      ],
    },
    {
      Teaching: [
        { name: "CITS1401", hours: 8 },
        { name: "CITS1001", hours: 4 },
      ],
      "Assigned Roles": [{ name: "Course Coordinator", hours: 8 }],
      HDR: [{ name: "Student C", hours: 3 }],
      Service: [
        { name: "School events", hours: 3 },
        { name: "Exam board", hours: 2 },
      ],
    },
    {
      Teaching: [{ name: "CITS3002", hours: 15 }],
      "Assigned Roles": [
        { name: "Industry liaison", hours: 6 },
        { name: "Advisory board", hours: 4 },
      ],
      HDR: [
        { name: "Student D", hours: 3 },
        { name: "Student E", hours: 2 },
      ],
      Service: [
        { name: "Peer review", hours: 2 },
        { name: "Workshop", hours: 2 },
      ],
    },
  ];
  return patterns[id % patterns.length];
}

function statusPillClass(status: AcademicItem["status"]) {
  if (status === "approved") return "bg-[#dcfce7] text-[#16a34a] ring-1 ring-[#86efac]";
  if (status === "rejected") return "bg-[#fee2e2] text-[#dc2626] ring-1 ring-[#fca5a5]";
  if (status === "pending") return "bg-[#fff3d6] text-[#d97706] ring-1 ring-[#fcd34d]";
  return "bg-slate-100 text-slate-400 ring-1 ring-slate-200";
}

function statusLabel(status: AcademicItem["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "") return "";
  return "Pending";
}

function confirmationPillClass(confirmation: AcademicItem["confirmation"]) {
  if (confirmation === "confirmed") return "text-[#15803d]";
  return "text-[#c2410c]";
}

function confirmationLabel(confirmation: AcademicItem["confirmation"]) {
  return confirmation === "confirmed" ? "Confirmed" : "Unconfirmed";
}

function WorkHoursBadge({ hours }: { hours: number }) {
  return (
    <span className="inline-flex min-w-[54px] items-center justify-center rounded-md bg-[#e0ecff] px-2 py-1 text-sm font-bold tabular-nums font-sans text-[#1e3a8a] ring-1 ring-[#93c5fd]">
      {hours}
    </span>
  );
}

function HeaderBar() {
  return (
    <div className="flex items-center justify-between rounded-md bg-[#2f4d9c] px-6 py-3">
      <div className="flex items-center gap-3">
        <img src="/logo512.png" alt="UWA" className="h-10 w-10 rounded-full bg-white/90 object-contain" />
        <div className="leading-tight text-white">
          <div className="text-xs font-semibold tracking-wide opacity-95">THE UNIVERSITY OF</div>
          <div className="text-xl font-bold leading-none">WESTERN AUSTRALIA</div>
        </div>
      </div>
      <div className="text-center text-2xl font-semibold text-white">Workload Verification</div>
      <div className="flex items-center gap-3 text-white">
        <div className="text-right text-sm font-semibold">Hi, Sam</div>
        <div className="h-11 w-11 rounded-full bg-white/90" />
      </div>
    </div>
  );
}

function ConfirmationIndicator({ confirmation }: { confirmation: AcademicItem["confirmation"] }) {
  const confirmed = confirmation === "confirmed";
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${confirmationPillClass(confirmation)}`}>
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none ${
          confirmed ? "border-[#15803d] bg-[#15803d] text-white" : "border-[#c2410c] bg-white text-[#c2410c]"
        }`}
      >
        {confirmed ? "✓" : "○"}
      </span>
      {confirmationLabel(confirmation)}
    </span>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">{label}</div>
      <input readOnly value={value} className="rounded border border-slate-300 px-3 py-2 text-sm" />
    </div>
  );
}

function AcademicDetailModal({
  item,
  onClose,
  onConfirm,
}: {
  item: AcademicItem;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tabs: BreakdownCategory[] = ["Teaching", "Assigned Roles", "HDR", "Service"];
  const [activeTab, setActiveTab] = useState<BreakdownCategory>("Teaching");
  const breakdown = breakdownById(item.id);
  const tabRows = breakdown[activeTab];
  const tabTotal = tabRows.reduce((sum, row) => sum + row.hours, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-md bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
          <div className="text-lg font-bold">Academic Workload Detail</div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
            onClick={onClose}
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Name" value={item.name} />
            <InfoField label="Employee ID" value={item.employeeId} />
            <InfoField label="Total Work Hours" value={String(item.hours)} />
            <InfoField label="Status" value={statusLabel(item.status) || "-"} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Workload Breakdown</div>
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
              <table className="min-w-full">
                <thead className="bg-white">
                  <tr className="text-left text-xs font-semibold uppercase text-slate-600">
                    <th className="px-3 py-2">{activeTab}</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                  {tabRows.map((row, idx) => (
                    <tr key={`${item.id}-${activeTab}-${idx}`}>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-sans">{row.hours}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums font-sans">{tabTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Description</div>
            <textarea
              readOnly
              value={item.description}
              className="mt-1 h-24 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-center pt-1">
            <button
              type="button"
              onClick={onConfirm}
              className={`rounded-md px-6 py-2 text-sm font-semibold ${
                item.confirmation === "confirmed"
                  ? "bg-[#16a34a] text-white"
                  : "bg-[#2f4d9c] text-white hover:bg-[#29458c]"
              }`}
            >
              Confirmed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Academic() {
  const user = {
    surname: "Sam",
    firstName: "Yaka",
    employeeId: "2345678",
    title: "Professor",
    department: "Computer Science",
    school: "Physics",
  };

  const [items, setItems] = useState<AcademicItem[]>(() => {
    const base: AcademicItem[] = [
    {
      id: 1,
      name: "Ann Culhane",
      employeeId: "5684236526",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 10,
      status: "pending",
      confirmation: "unconfirmed",
    },
    {
      id: 2,
      name: "Ahmad Rosser",
      employeeId: "5684236527",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 20,
      status: "approved",
      confirmation: "confirmed",
    },
    {
      id: 3,
      name: "Mary Smith",
      employeeId: "5684236528",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 5,
      status: "rejected",
      confirmation: "unconfirmed",
    },
    {
      id: 4,
      name: "John Doe",
      employeeId: "5684236529",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 15,
      status: "pending",
      confirmation: "confirmed",
    },
    {
      id: 5,
      name: "Lisa Brown",
      employeeId: "5684236530",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 8,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 6,
      name: "Chris Martin",
      employeeId: "5684236531",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 12,
      status: "pending",
      confirmation: "unconfirmed",
    },
    {
      id: 7,
      name: "Emma Wilson",
      employeeId: "5684236532",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 6,
      status: "approved",
      confirmation: "confirmed",
    },
    {
      id: 8,
      name: "Oliver Stone",
      employeeId: "5684236533",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 18,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 9,
      name: "Sophia Lee",
      employeeId: "5684236534",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 9,
      status: "rejected",
      confirmation: "unconfirmed",
    },
    {
      id: 10,
      name: "David Hall",
      employeeId: "5684236535",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 14,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 11,
      name: "Mia White",
      employeeId: "5684236536",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 7,
      status: "pending",
      confirmation: "unconfirmed",
    },
    {
      id: 12,
      name: "Noah Green",
      employeeId: "5684236537",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 11,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 13,
      name: "Ivy Turner",
      employeeId: "5684236538",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 13,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 14,
      name: "Lucas King",
      employeeId: "5684236539",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 16,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 15,
      name: "Chloe Scott",
      employeeId: "5684236540",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 4,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 16,
      name: "Ethan Brooks",
      employeeId: "5684236541",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 19,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 17,
      name: "Aiden Cooper",
      employeeId: "5684236542",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 17,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 18,
      name: "Zoe Ward",
      employeeId: "5684236543",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 6,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 19,
      name: "Ryan Foster",
      employeeId: "5684236544",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 21,
      status: "",
      confirmation: "unconfirmed",
    },
    {
      id: 20,
      name: "Lily Price",
      employeeId: "5684236545",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
      hours: 9,
      status: "",
      confirmation: "unconfirmed",
    },
    ];
    const synced = readAcademicStatusSync();
    return applySyncedStatus(base, synced);
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set([1]));
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [requestReasonError, setRequestReasonError] = useState("");
  const [requestInfo, setRequestInfo] = useState("");

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((x) => x.status === filter);
  }, [items, filter]);

  const pendingCount = useMemo(() => items.filter((x) => x.status === "pending").length, [items]);

  const detailItem = useMemo(() => items.find((x) => x.id === detailId) || null, [items, detailId]);

  useEffect(() => {
    function syncFromSupervisor() {
      const synced = readAcademicStatusSync();
      setItems((prev) => applySyncedStatus(prev, synced));
    }

    function onStorage(e: StorageEvent) {
      if (e.key === ACADEMIC_STATUS_SYNC_KEY) syncFromSupervisor();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    };
  }, []);

  function toggleRow(id: number) {
    setSelectedIds((prev) => {
      if (prev.has(id)) return new Set();
      return new Set([id]);
    });
  }

  function submitRequestToSupervisor(reason: string) {
    const rows = items.filter((x) => selectedIds.has(x.id));
    if (!rows.length) return;

    const drafts: SupervisorDraftRequest[] = rows.map((row, idx) => ({
      id: Date.now() + idx,
      studentId: row.employeeId,
      semesterLabel: "Sem1",
      periodLabel: "2025-1",
      name: row.name,
      unit: "CITS 2200",
      description: row.description,
      requestReason: reason,
      title: user.title,
      department: user.department,
      rate: 70,
      status: "pending",
      hours: row.hours,
    }));

    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(SUPERVISOR_DRAFT_KEY);
      const existing = raw ? (JSON.parse(raw) as SupervisorDraftRequest[]) : [];
      window.localStorage.setItem(SUPERVISOR_DRAFT_KEY, JSON.stringify([...drafts, ...existing]));
      window.dispatchEvent(new Event(ACADEMIC_DRAFT_EVENT));
    }

    setSelectedIds(new Set());
    setItems((prev) =>
      prev.map((x) =>
        rows.some((r) => r.id === x.id) ? { ...x, status: "pending" } : x
      )
    );
    setRequestInfo(`${rows.length} request(s) have been submitted to Supervisor.`);
  }

  function openRequestModal() {
    if (selectedIds.size === 0) {
      setRequestInfo("Please select at least one row before submitting.");
      return;
    }
    setRequestReason("");
    setRequestReasonError("");
    setRequestModalOpen(true);
  }

  function handleRequestSubmit() {
    const trimmed = requestReason.trim();
    if (!trimmed) {
      setRequestReasonError("Application reason is required.");
      return;
    }
    submitRequestToSupervisor(trimmed);
    setRequestModalOpen(false);
  }

  function handleConfirmFromDetail(id: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              confirmation: "confirmed",
            }
          : item
      )
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-8">
        <HeaderBar />

        <div className="mt-6 rounded-md bg-white p-8 shadow-sm">
          <div className="mb-6 text-3xl text-slate-300">Home Page</div>

          <div className="text-center text-3xl font-semibold text-slate-700">User Information</div>

          <div className="mt-6 grid grid-cols-3 gap-10">
            <div className="space-y-5">
              <InfoField label="Surname" value={user.surname} />
              <InfoField label="First name" value={user.firstName} />
            </div>
            <div className="space-y-5">
              <InfoField label="Employee ID" value={user.employeeId} />
              <InfoField label="Title" value={user.title} />
            </div>
            <div className="space-y-5">
              <InfoField label="Department" value={user.department} />
              <InfoField label="School" value={user.school} />
            </div>
          </div>

          <div className="mt-10 text-4xl font-semibold text-slate-700">Workload Report Sem 1 - 2025</div>

          <div className="mt-6 rounded-md bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-4 flex flex-wrap items-center justify-start gap-4 rounded-md bg-[#f4f7ff] px-4 py-3">
              <div className="text-base font-semibold text-[#2f4d9c]">Status Filter:</div>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-md border px-4 py-2 text-sm font-semibold ${
                  filter === "all"
                    ? "border-[#2f4d9c] bg-[#2f4d9c] text-white"
                    : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`relative rounded-md border px-4 py-2 text-sm font-semibold ${
                  filter === "pending"
                    ? "border-[#d97706] bg-[#d97706] text-white"
                    : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                }`}
              >
                Pending
                {pendingCount > 0 && (
                  <span className="pointer-events-none absolute -right-2 -top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#d97706] text-[10px] font-bold leading-none text-white">
                    !
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setFilter("approved")}
                className={`rounded-md border px-4 py-2 text-sm font-semibold ${
                  filter === "approved"
                    ? "border-[#16a34a] bg-[#16a34a] text-white"
                    : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                }`}
              >
                Approved
              </button>
              <button
                type="button"
                onClick={() => setFilter("rejected")}
                className={`rounded-md border px-4 py-2 text-sm font-semibold ${
                  filter === "rejected"
                    ? "border-[#dc2626] bg-[#dc2626] text-white"
                    : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                }`}
              >
                Rejected
              </button>
            </div>

            <div className="overflow-x-auto">
              <div className="max-h-[520px] overflow-y-auto">
                <table className="min-w-full border-separate border-spacing-y-0">
                <thead>
                  <tr className="text-left text-sm font-bold uppercase text-slate-500">
                    <th className="w-10 px-2 py-2"></th>
                    <th className="w-10 px-2 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap min-w-[170px]">Total Work Hours</th>
                    <th className="px-3 py-2">Confirmation</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap min-w-[170px]">Pushed Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredItems.map((item, idx) => {
                    const selected = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setDetailId(item.id)}
                        className={`cursor-pointer text-sm ${selected ? "border-l-4 border-[#2f4d9c] bg-[#eef2ff]" : ""}`}
                      >
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(item.id)}
                            className="h-4 w-4 accent-[#2f4d9c]"
                          />
                        </td>
                        <td className="px-2 py-3 text-center tabular-nums font-sans text-slate-600">{idx + 1}</td>
                        <td className="px-3 py-3 font-medium text-slate-700">
                          <div>{item.name}</div>
                          <div className="text-xs text-slate-400">{item.employeeId}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{item.description}</td>
                        <td className="px-3 py-3 text-center">
                          {item.status ? (
                            <span className={`rounded px-2 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}>
                              {statusLabel(item.status)}
                            </span>
                          ) : (
                            <span className="text-sm font-semibold text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <WorkHoursBadge hours={item.hours} />
                        </td>
                        <td className="px-3 py-3">
                          <ConfirmationIndicator confirmation={item.confirmation} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-sans font-semibold text-slate-800">
                          {pushedTimeById(item.id)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-center">
            <button
              type="button"
              onClick={openRequestModal}
              className="flex items-center gap-2 rounded bg-[#2f4d9c] px-10 py-2 text-sm font-bold text-white shadow"
            >
              <span className="text-base">✓</span>
              Submit Request
            </button>
          </div>
          {requestInfo && <div className="mt-3 text-center text-sm font-semibold text-[#2f4d9c]">{requestInfo}</div>}
        </div>
      </div>

      {detailItem && (
        <AcademicDetailModal
          item={detailItem}
          onClose={() => setDetailId(null)}
          onConfirm={() => {
            handleConfirmFromDetail(detailItem.id);
            setDetailId(null);
          }}
        />
      )}
      {requestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-lg">
            <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
              <div className="text-base font-bold">Submit Application</div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                onClick={() => setRequestModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="text-sm font-semibold text-slate-700">Application reason (required)</div>
              <textarea
                value={requestReason}
                onChange={(e) => {
                  setRequestReason(e.target.value);
                  if (requestReasonError) setRequestReasonError("");
                }}
                placeholder="Please write the reason for this submission."
                className="h-28 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
              />
              {requestReasonError && <div className="text-sm font-semibold text-[#dc2626]">{requestReasonError}</div>}
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRequestModalOpen(false)}
                  className="rounded bg-slate-200 px-6 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRequestSubmit}
                  className="rounded bg-[#2f4d9c] px-6 py-2 text-sm font-semibold text-white"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}