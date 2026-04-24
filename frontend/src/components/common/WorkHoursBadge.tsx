type WorkHoursBadgeProps = {
  hours: number;
  className?: string;
};

export default function WorkHoursBadge({ hours, className = "" }: WorkHoursBadgeProps) {
  return (
    <span
      className={`inline-flex min-w-[54px] items-center justify-center rounded-md bg-[#e0ecff] px-2 py-1 text-sm font-bold tabular-nums font-sans text-[#1e3a8a] ring-1 ring-[#93c5fd] ${className}`}
    >
      {hours}
    </span>
  );
}
