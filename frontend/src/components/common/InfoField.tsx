type InfoFieldProps = {
  label: string;
  value: string;
  className?: string;
  inputClassName?: string;
  tooltipText?: string;
  tooltipClassName?: string;
};

export default function InfoField({
  label,
  value,
  className = "",
  inputClassName = "",
  tooltipText,
  tooltipClassName = "border-red-300 bg-red-50 text-red-800",
}: InfoFieldProps) {
  return (
    <div className={`group relative flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">{label}</div>
      <input
        readOnly
        value={value}
        className={`min-w-0 rounded border border-slate-300 px-3 py-2 text-sm ${inputClassName}`}
      />
      {tooltipText ? (
        <div
          className={`pointer-events-none absolute inset-x-0 top-full z-30 mt-2 hidden max-h-[min(50vh,22rem)] w-full max-w-[min(560px,calc(100vw-2rem))] overflow-y-auto overscroll-y-contain whitespace-pre-line break-words rounded border px-3 py-2 text-xs font-semibold leading-snug shadow-lg [overflow-wrap:anywhere] group-hover:block sm:px-4 sm:text-sm sm:leading-relaxed ${tooltipClassName}`}
        >
          {tooltipText}
        </div>
      ) : null}
    </div>
  );
}
