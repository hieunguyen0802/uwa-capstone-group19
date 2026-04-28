type YearRangeSemesterActionRowProps = {
  yearFrom: string;
  yearTo: string;
  semester: "All" | "S1" | "S2";
  onYearFromChange: (value: string) => void;
  onYearToChange: (value: string) => void;
  onSemesterChange: (value: "All" | "S1" | "S2") => void;
  actionLabel: string;
  onActionClick: () => void;
  yearFromPlaceholder?: string;
  yearToPlaceholder?: string;
};

export default function YearRangeSemesterActionRow({
  yearFrom,
  yearTo,
  semester,
  onYearFromChange,
  onYearToChange,
  onSemesterChange,
  actionLabel,
  onActionClick,
  yearFromPlaceholder = "e.g. 2024",
  yearToPlaceholder = "e.g. 2026",
}: YearRangeSemesterActionRowProps) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[260px_260px_280px_auto]">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year From</span>
        <input
          value={yearFrom}
          onChange={(e) => onYearFromChange(e.target.value)}
          placeholder={yearFromPlaceholder}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year To</span>
        <input
          value={yearTo}
          onChange={(e) => onYearToChange(e.target.value)}
          placeholder={yearToPlaceholder}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Semester</span>
        <select
          value={semester}
          onChange={(e) => onSemesterChange(e.target.value as "All" | "S1" | "S2")}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="All">All</option>
          <option value="S1">S1</option>
          <option value="S2">S2</option>
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <span className="select-none text-xs font-semibold uppercase text-transparent">Action</span>
        <button
          type="button"
          onClick={onActionClick}
          className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
