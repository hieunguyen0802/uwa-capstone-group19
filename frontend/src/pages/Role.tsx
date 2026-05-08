import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * Role landing — only HOD sees a chooser (HoD pages vs personal Academic
 * page). Every other role is forwarded directly to its single home page.
 *
 * Routing rules driven by `profile.role` (DB authority), not by guessing
 * from the menu array — menu is for permission-gated rendering elsewhere.
 */

const HOME_ROUTE_BY_ROLE: Record<string, string> = {
  ACADEMIC: "/academic",
  HOD: "/role",
  SCHOOL_OPS: "/school-operations",
  HOS: "/school-head",
};

const HOD_CHOICES = [
  {
    key: "department-head",
    label: "Head of Department",
    subtitle: "Manage and review departmental workloads",
    color: "bg-[#2f4d9c]",
    icon: "HoD",
    route: "/department-head",
  },
  {
    key: "academic",
    label: "Academic",
    subtitle: "Submit and review your own workload",
    color: "bg-[#9a8538]",
    icon: "AC",
    route: "/academic",
  },
];

export default function Role() {
  const navigate = useNavigate();
  const { profile, loading, logout } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      navigate("/login", { replace: true });
      return;
    }
    const home = HOME_ROUTE_BY_ROLE[profile.role];
    if (home && home !== "/role") {
      navigate(home, { replace: true });
    }
  }, [loading, profile, navigate]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  // Non-HOD roles are mid-redirect; render nothing while useEffect fires.
  if (profile.role !== "HOD") {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#eef3ff] px-6 py-20">
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-6xl items-start rounded-md bg-[#f7f9fc] px-8 py-16 shadow-sm">
        <div className="w-full">
          <div className="mt-8 text-center">
            <h1 className="text-5xl font-semibold text-[#2f4d9c] [text-shadow:0_2px_2px_rgba(47,77,156,0.2)]">
              Workload Verification System
            </h1>
            <h2 className="mt-10 text-4xl font-semibold text-[#2f4d9c]">
              Choose your role
            </h2>
            <p className="mt-2 text-base text-slate-500">
              Signed in as {profile.full_name || profile.email}
            </p>
          </div>

          <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-16 md:grid-cols-2">
            {HOD_CHOICES.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => navigate(card.route)}
                className={`${card.color} mx-auto flex min-h-[300px] w-full max-w-[280px] flex-col items-center justify-center rounded-lg px-6 py-8 text-white shadow-md transition hover:scale-[1.01]`}
              >
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-white text-3xl font-bold text-slate-700">
                  {card.icon}
                </div>
                <div className="text-4xl font-semibold leading-tight">
                  {card.label}
                </div>
                <p className="mt-3 text-center text-sm text-white/90">
                  {card.subtitle}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-12 text-center">
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
