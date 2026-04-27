type PaginationControlsProps = {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
  className?: string;
};

export default function PaginationControls({
  page,
  totalPages,
  onPrev,
  onNext,
  disablePrev = false,
  disableNext = false,
  className = "mt-4",
}: PaginationControlsProps) {
  return (
    <div className={`${className} flex items-center justify-center gap-4`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={disablePrev}
        className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Previous
      </button>
      <div className="text-sm tabular-nums font-sans text-slate-600">
        Page {page} / {totalPages}
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={disableNext}
        className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Next
      </button>
    </div>
  );
}
