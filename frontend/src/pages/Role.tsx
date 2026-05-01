import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

export default function Role() {
  const navigate = useNavigate();

  const roleCards = useMemo(
    () => [
      {
        key: "hod" as const,
        title: "Head of Department",
        subtitle: "Manage and review departmental workloads",
        color: "bg-[#2f4d9c]",
        icon: "HoD",
        route: "/supervisor",
      },
      {
        key: "academic" as const,
        title: "Academic",
        subtitle: "Submit and review your own workload",
        color: "bg-[#9a8538]",
        icon: "AC",
        route: "/academic",
      },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-[#eef3ff] px-6 py-20">
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-6xl items-start rounded-md bg-[#f7f9fc] px-8 py-16 shadow-sm">
        <div className="w-full">
        <div className="mt-8 text-center">
          <h1 className="text-5xl font-semibold text-[#2f4d9c] [text-shadow:0_2px_2px_rgba(47,77,156,0.2)]">
            Workload Verification System
          </h1>
          <h2 className="mt-10 text-4xl font-semibold text-[#2f4d9c]">Choose your role</h2>
          <p className="mt-2 text-base text-slate-500">Select your role to continue.</p>
        </div>

        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-16 md:grid-cols-2">
          {roleCards.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => navigate(card.route)}
                className={`${card.color} mx-auto flex min-h-[300px] w-full max-w-[280px] flex-col items-center justify-center rounded-lg px-6 py-8 text-white shadow-md transition hover:scale-[1.01]`}
              >
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-white text-3xl font-bold text-slate-700">
                  {card.icon}
                </div>
                <div className="text-4xl font-semibold leading-tight">{card.title}</div>
                <p className="mt-3 text-center text-sm text-white/90">{card.subtitle}</p>
              </button>
            ))}
        </div>
        </div>
      </div>
    </div>
  );
}