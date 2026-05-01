type VisualizationSummary = {
  totalAcademics: number;
  totalWorkHours: number;
  workHoursPerAcademic: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
};

type VisualizationSummaryCardsProps = {
  summary: VisualizationSummary;
};

export default function VisualizationSummaryCards({ summary }: VisualizationSummaryCardsProps) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Academics</div>
        <div className="mt-1 text-2xl font-bold text-slate-800">{summary.totalAcademics}</div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Work Hours</div>
        <div className="mt-1 text-2xl font-bold text-slate-800">{summary.totalWorkHours}</div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Work Hours per Academic</div>
        <div className="mt-1 text-2xl font-bold text-slate-800">{summary.workHoursPerAcademic}</div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Pending Requests</div>
        <div className="mt-1 text-2xl font-bold text-[#d97706]">{summary.pendingRequests}</div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Approved Requests</div>
        <div className="mt-1 text-2xl font-bold text-[#16a34a]">{summary.approvedRequests}</div>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Rejected Requests</div>
        <div className="mt-1 text-2xl font-bold text-[#dc2626]">{summary.rejectedRequests}</div>
      </div>
    </div>
  );
}
