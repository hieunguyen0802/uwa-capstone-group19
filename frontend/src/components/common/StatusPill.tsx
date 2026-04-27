type Status = "pending" | "approved" | "rejected";

type StatusPillProps = {
  status: Status;
  variant?: "academic" | "supervisor";
};

const LABELS: Record<Status, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export default function StatusPill({ status, variant = "academic" }: StatusPillProps) {
  const className =
    status === "approved"
      ? "bg-[#dcfce7] text-[#16a34a] ring-1 ring-[#86efac]"
      : status === "rejected"
        ? "bg-[#fee2e2] text-[#dc2626] ring-1 ring-[#fca5a5]"
        : variant === "supervisor"
          ? "bg-[#fff3d6] text-[#d97706] ring-1 ring-[#fef08a]"
          : "bg-[#fff3d6] text-[#d97706] ring-1 ring-[#fcd34d]";

  return <span className={`rounded px-2 py-1 text-xs font-semibold ${className}`}>{LABELS[status]}</span>;
}
