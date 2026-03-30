import { useMemo, useState } from "react";

type MockRequest = {
  id: number;
  studentId: string;
  semesterLabel: string;
  periodLabel: string;
  name: string;
  unit: string;
  description: string;
  title: string;
  department: string;
  rate: number;
  status: "pending" | "approved" | "rejected";
  hours: number;
};

const RATE = 70; // Placeholder until you tell us rate/total calculation rules

function formatMoney(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export default function Supervisor() {
  const [loading] = useState(false);
  const [pending, setPending] = useState<MockRequest[]>(() => {
    // Fake data: initial 5 rows (you'll replace later with real API fields)
    return [
      {
        id: 1,
        studentId: "2345678",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ann Culhane",
        unit: "CITS 2206",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 10,
      },
      {
        id: 2,
        studentId: "2345679",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ahmed Adhyyasar",
        unit: "CITS 1201",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 20,
      },
      {
        id: 3,
        studentId: "2345680",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Mary Smith",
        unit: "CITS 1302",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "rejected",
        hours: 5,
      },
      {
        id: 4,
        studentId: "2345681",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "John Doe",
        unit: "CITS 2103",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "approved",
        hours: 15,
      },
      {
        id: 5,
        studentId: "2345682",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Lisa Brown",
        unit: "CITS 2304",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 8,
      },
      {
        id: 6,
        studentId: "2345683",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Chris Martin",
        unit: "CITS 3401",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 12,
      },
      {
        id: 7,
        studentId: "2345684",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Emma Wilson",
        unit: "CITS 3100",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 6,
      },
      {
        id: 8,
        studentId: "2345685",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Oliver Stone",
        unit: "CITS 4202",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 18,
      },
      {
        id: 9,
        studentId: "2345686",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Sophia Lee",
        unit: "CITS 2008",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 9,
      },
      {
        id: 10,
        studentId: "2345687",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Daniel Smith",
        unit: "CITS 2601",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 11,
      },
      {
        id: 11,
        studentId: "2345688",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Grace Taylor",
        unit: "CITS 2803",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "pending",
        hours: 7,
      },
      {
        id: 12,
        studentId: "2345689",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Henry Clark",
        unit: "CITS 1500",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "rejected",
        hours: 14,
      },
      {
        id: 13,
        studentId: "2345690",
        semesterLabel: "Sem1",
        periodLabel: "2025-1",
        name: "Ava Robinson",
        unit: "CITS 4101",
        description:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla...",
        title: "Professor",
        department: "Computer Science",
        rate: 70,
        status: "approved",
        hours: 8,
      },
    ];
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 10; // Items per page
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("pending");

  const [popup, setPopup] = useState<{
    open: boolean;
    title: string;
    message: string;
    status: "pending" | "approved" | "rejected";
  }>({
    open: false,
    title: "",
    message: "",
    status: "pending",
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<MockRequest | null>(null);

  const userInfo = useMemo(
    () => ({
      surname: "Sam",
      firstName: "Yaka",
      employeeId: "2345678",
      department: "Computer Science",
      school: "Physics",
      title: "Professor",
    }),
    []
  );

  const pendingCount = useMemo(
    () => pending.filter((it) => it.status === "pending").length,
    [pending]
  );

  const itemsForFilter = useMemo(() => {
    if (statusFilter === "all") return pending;
    return pending.filter((it) => it.status === statusFilter);
  }, [pending, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(itemsForFilter.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return itemsForFilter.slice(start, start + pageSize);
  }, [itemsForFilter, page]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function statusLabel(status: string) {
    if (status === "pending") return "Open";
    if (status === "approved") return "Paid";
    if (status === "rejected") return "Rejected";
    return status;
  }

  function statusPillClass(status: MockRequest["status"]) {
    if (status === "pending")
      return "bg-[#fff3d6] text-[#d97706] ring-1 ring-[#fef08a]";
    if (status === "approved")
      return "bg-[#dcfce7] text-[#16a34a] ring-1 ring-[#86efac]";
    return "bg-[#fee2e2] text-[#dc2626] ring-1 ring-[#fca5a5]";
  }

  const canSubmit =
    statusFilter === "pending" && selectedIds.size > 0 && !submitting;

  async function handleDecision(kind: "approve" | "reject") {
    if (!canSubmit) return;
    setSubmitting(true);

    // Fake: update status locally
    const nextStatus: MockRequest["status"] =
      kind === "approve" ? "approved" : "rejected";
    const count = selectedIds.size;
    const next: MockRequest[] = pending.map((it) => {
      if (!selectedIds.has(it.id)) return it;
      return { ...it, status: nextStatus };
    });

    // Small delay to feel like a real request
    await new Promise((r) => setTimeout(r, 300));
    setPending(next);
    setSelectedIds(new Set());
    setSubmitting(false);

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message:
        count === 1
          ? `1 request has been marked as ${kind === "approve" ? "Approved" : "Rejected"}.`
          : `${count} requests have been marked as ${
              kind === "approve" ? "Approved" : "Rejected"
            }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  async function handleDecisionForId(kind: "approve" | "reject", id: number) {
    setSubmitting(true);
    try {
      const nextStatus: MockRequest["status"] =
        kind === "approve" ? "approved" : "rejected";
      setPending((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: nextStatus } : it))
      );
      // Clear selection if it contains the same row.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setSubmitting(false);
    }

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message: `The request has been marked as ${
        kind === "approve" ? "Approved" : "Rejected"
      }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  async function handleWithdrawForId(id: number) {
    setSubmitting(true);
    try {
      setPending((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: "pending" } : it))
      );
    } finally {
      setSubmitting(false);
    }

    setStatusFilter("pending");
    setSelectedIds(new Set());
    setPage(1);
    setDetailsOpen(false);
    setDetailsItem(null);
    setPopup({
      open: true,
      title: "Withdrawn",
      message:
        "This request has been moved back to Pending. Please review it in the Pending list.",
      status: "pending",
    });
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-3 pb-10 pt-8">
        {/* Header Bar */}
        <div className="flex items-center justify-between rounded-md bg-[#2f4d9c] px-6 py-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo512.png"
              alt="UWA"
              className="h-10 w-10 rounded-full bg-white/90 object-contain"
            />
            <div className="leading-tight text-white">
              <div className="text-xs font-semibold tracking-wide opacity-95">
                THE UNIVERSITY OF
              </div>
              <div className="text-xl font-bold leading-none">
                WESTERN AUSTRALIA
              </div>
            </div>
          </div>

          <div className="text-center text-2xl font-semibold text-white">
            Workload Verification
          </div>

          <div className="flex items-center gap-3 text-white">
            <div className="text-right text-sm">
              <div className="font-semibold">Hi, Sam</div>
            </div>
            <div className="h-11 w-11 rounded-full bg-white/90" />
          </div>
        </div>

        {/* Body Card */}
        <div className="mt-6 rounded-md bg-white p-8 shadow-sm">
          {popup.open && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
              onClick={() => setPopup((p) => ({ ...p, open: false }))}
            >
              <div
                className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between bg-[#2f4d9c] px-5 py-3 text-white">
                  <div className="text-lg font-extrabold">{popup.title}</div>
                  <button
                    type="button"
                    aria-label="Close"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
                    onClick={() => setPopup((p) => ({ ...p, open: false }))}
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>

                {/* Body */}
                <div className="px-5 py-4">
                  <div className="text-base text-slate-800">{popup.message}</div>
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("pending");
                        setSelectedIds(new Set());
                        setPage(1);
                        setDetailsOpen(false);
                        setDetailsItem(null);
                        setPopup((p) => ({ ...p, open: false }));
                      }}
                      className={`rounded-md px-5 py-2 text-sm font-semibold text-white hover:brightness-95 ${
                        popup.status === "approved"
                          ? "bg-[#16a34a]"
                          : popup.status === "rejected"
                            ? "bg-[#dc2626]"
                            : "bg-[#d97706]"
                      }`}
                    >
                      {popup.status === "approved"
                        ? "Approval Completed"
                        : popup.status === "rejected"
                          ? "Rejection Completed"
                          : "Back to Pending List"}
                    </button>
                  </div>
                </div>

                {/* Status color bar */}
                <div className="h-1.5 w-full bg-[#2f4d9c]" />
              </div>
            </div>
          )}

          {/* User Info */}
          <div className="grid grid-cols-3 gap-8">
            <div className="space-y-5">
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  Surname
                </div>
                <input
                  readOnly
                  value={userInfo.surname}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  First name
                </div>
                <input
                  readOnly
                  value={userInfo.firstName}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  Employee ID
                </div>
                <input
                  readOnly
                  value={userInfo.employeeId}
                  className="rounded border border-slate-300 px-3 py-2 text-sm tabular-nums font-sans"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  Title
                </div>
                <input
                  readOnly
                  value={userInfo.title}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  Department
                </div>
                <input
                  readOnly
                  value={userInfo.department}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                  School
                </div>
                <input
                  readOnly
                  value={userInfo.school}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Report title */}
          <div className="mt-6 text-lg font-semibold text-slate-700">
            Workload Report Sem 1 - 2025
          </div>

          {/* Table */}
          <div className="mt-6 rounded-md bg-[#f4f7ff] p-4">
            {/* Status Filter (integrated with list) */}
              <div className="mb-4 flex flex-wrap items-center justify-start gap-5">
              <div className="text-base font-semibold text-[#2f4d9c]">
                Status Filter:
              </div>

                <div className="flex flex-wrap items-center justify-start gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setSelectedIds(new Set());
                    setPage(1);
                    setDetailsOpen(false);
                    setDetailsItem(null);
                  }}
                  className={`rounded-md border px-5 py-2 text-base font-semibold ${
                    statusFilter === "all"
                      ? "border-[#2f4d9c] bg-[#2f4d9c] text-white"
                      : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                  }`}
                >
                  All
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("pending");
                    setSelectedIds(new Set());
                    setPage(1);
                    setDetailsOpen(false);
                    setDetailsItem(null);
                  }}
                  className={`relative rounded-md border px-5 py-2 text-base font-semibold ${
                    statusFilter === "pending"
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
                  onClick={() => {
                    setStatusFilter("approved");
                    setSelectedIds(new Set());
                    setPage(1);
                    setDetailsOpen(false);
                    setDetailsItem(null);
                  }}
                  className={`rounded-md border px-5 py-2 text-base font-semibold ${
                    statusFilter === "approved"
                      ? "border-[#16a34a] bg-[#16a34a] text-white"
                      : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                  }`}
                >
                  Approved
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("rejected");
                    setSelectedIds(new Set());
                    setPage(1);
                    setDetailsOpen(false);
                    setDetailsItem(null);
                  }}
                  className={`rounded-md border px-5 py-2 text-base font-semibold ${
                    statusFilter === "rejected"
                      ? "border-[#dc2626] bg-[#dc2626] text-white"
                      : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                  }`}
                >
                  Rejected
                </button>
              </div>
            </div>

            <div className="max-h-[460px] overflow-x-auto overflow-y-auto pr-1">
              <table className="min-w-full border-separate border-spacing-y-0">
                <thead>
                  <tr className="text-left text-sm font-extrabold uppercase tracking-wide text-slate-700">
                    <th className="w-10 px-2 py-2"></th>
                    <th className="w-14 px-2 py-2">Task</th>
                    <th className="px-3 py-2">NAME</th>
                    <th className="px-3 py-2">DESCRIPTION</th>
                    <th className="px-3 py-2">STATUS</th>
                    <th className="px-3 py-2 text-right">RATE</th>
                    <th className="px-3 py-2 text-right">HOUR</th>
                    <th className="px-3 py-2 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {loading && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                        Loading...
                      </td>
                    </tr>
                  )}

                  {!loading && pageItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                        {statusFilter === "pending"
                          ? "No pending requests"
                          : "No items found"}
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    pageItems.map((item, idx) => {
                      const isSelected = selectedIds.has(item.id);
                      const rowIndex = (page - 1) * pageSize + idx + 1;
                      const total = RATE * Number(item.hours || 0);
                      return (
                        <tr
                          key={item.id}
                          className={`cursor-pointer text-sm hover:bg-slate-50 ${
                            isSelected ? "border-l-4 border-[#2f4d9c] bg-[#e9f2ff]" : ""
                          }`}
                          onClick={() => {
                            setDetailsItem(item);
                            setDetailsOpen(true);
                          }}
                        >
                          <td className="px-2 py-3">
                            {statusFilter === "pending" ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  // Prevent row click from opening details
                                  e.stopPropagation();
                                  toggleSelected(item.id);
                                }}
                                className="h-4 w-4 accent-[#2f4d9c]"
                              />
                            ) : (
                              <input
                                type="checkbox"
                                checked={false}
                                disabled
                                className="h-4 w-4 accent-[#2f4d9c] opacity-40"
                              />
                            )}
                          </td>
                          <td className="px-2 py-3 text-center text-sm tabular-nums font-sans text-slate-600">
                            {rowIndex}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-700">
                            {item.name}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {item.description}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded px-2 py-1 text-xs font-semibold ${statusPillClass(
                                item.status
                              )}`}
                            >
                              {statusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums font-sans text-slate-700">
                            {formatMoney(RATE)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums font-sans text-slate-700">
                            {item.hours}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums font-sans font-semibold text-slate-800">
                            {formatMoney(total)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || submitting}
                className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <div className="text-sm tabular-nums font-sans text-slate-600">
                Page {page} / {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || submitting}
                className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>

            {/* Actions (only on To-do) */}
            {statusFilter === "pending" && (
              <div className="mt-6 flex items-center justify-center gap-6">
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => handleDecision("approve")}
                  className="flex items-center gap-2 rounded bg-[#2f4d9c] px-10 py-2 text-sm font-bold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="text-base">✓</span>
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => handleDecision("reject")}
                  className="rounded bg-slate-200 px-10 py-2 text-sm font-bold text-slate-500 shadow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            )}

            {/* Details Modal (placeholder format for now) */}
            {detailsOpen && detailsItem && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                onClick={() => {
                  setDetailsOpen(false);
                  setDetailsItem(null);
                }}
              >
                <div
                  className="w-full max-w-2xl rounded-sm bg-white p-0 shadow"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="rounded-sm border border-black">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-4 border-b border-black/30 bg-white px-5 py-3">
                      <div className="flex items-center gap-3">
                        {/* Student identifier block */}
                        <div className="rounded-sm bg-[#2f4d9c] px-4 py-2 text-sm font-bold text-white tabular-nums font-sans">
                          {detailsItem.studentId}-{detailsItem.semesterLabel}
                          {detailsItem.periodLabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white ring-1 ring-black">
                          ☁
                        </div>
                        <span className="text-base">{statusLabel(detailsItem.status)}</span>
                      </div>
                    </div>

                    {/* Form body */}
                    <form
                      className="space-y-4 px-6 py-5"
                      onSubmit={(e) => e.preventDefault()}
                    >
                      <div className="grid grid-cols-2 gap-5">
                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Full name
                          </div>
                          <input
                            readOnly
                            value={detailsItem.name}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Unit
                          </div>
                          <input
                            readOnly
                            value={detailsItem.unit}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Title
                          </div>
                          <input
                            readOnly
                            value={detailsItem.title}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Hour
                          </div>
                          <input
                            readOnly
                            value={detailsItem.hours}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base tabular-nums font-sans"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Department
                          </div>
                          <input
                            readOnly
                            value={detailsItem.department}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Rate
                          </div>
                          <input
                            readOnly
                            value={`$${detailsItem.rate}`}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base tabular-nums font-sans"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-semibold text-slate-700">
                          Reasons to cancel
                        </div>
                        <textarea
                          readOnly
                          value={
                            "- incorrect hours\n- wrong rates\n- wrong name / unit / description"
                          }
                          className="mt-2 h-28 w-full resize-none rounded-sm border border-slate-400 bg-white px-4 py-3 font-mono text-sm text-slate-700"
                        />
                      </div>

                      {detailsItem.status === "pending" ? (
                        <div className="flex items-center justify-center gap-24 pt-2">
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              handleDecisionForId("approve", detailsItem.id).then(
                                () => {
                                  setDetailsOpen(false);
                                  setDetailsItem(null);
                                }
                              );
                            }}
                            className="w-56 rounded-sm bg-[#4a9a3d] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              handleDecisionForId("reject", detailsItem.id).then(
                                () => {
                                  setDetailsOpen(false);
                                  setDetailsItem(null);
                                }
                              );
                            }}
                            className="w-56 rounded-sm bg-[#e53935] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center pt-2">
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleWithdrawForId(detailsItem.id)}
                            className="w-full max-w-md rounded-sm bg-[#2f4d9c] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}