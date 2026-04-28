type ReportingPeriodBarProps = {
  periodLabel: string;
};

export default function ReportingPeriodBar({ periodLabel }: ReportingPeriodBarProps) {
  return (
    <div className="mt-3">
      <div className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-5 py-2 text-base text-slate-800 shadow-sm">
        <span className="text-[#1e3a8a]">Reporting Period:</span>
        <span className="rounded-md border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1 font-bold text-[#1e3a8a]">
          {periodLabel}
        </span>
      </div>
    </div>
  );
}
