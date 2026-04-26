type InfoFieldProps = {
  label: string;
  value: string;
  className?: string;
};

export default function InfoField({ label, value, className = "" }: InfoFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">{label}</div>
      <input readOnly value={value} className="rounded border border-slate-300 px-3 py-2 text-sm" />
    </div>
  );
}
