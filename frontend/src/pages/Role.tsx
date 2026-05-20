import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * Task landing — HOD users can choose between their department review work and
 * their own workload. Other roles are forwarded directly to their single home.
 */

const HOME_ROUTE_BY_ROLE: Record<string, string> = {
  ACADEMIC: "/workload-platform",
  HOD: "/role",
  SCHOOL_OPS: "/school-operations",
  HOS: "/school-head",
};

const HOD_CHOICES = [
  {
    key: "department-head",
    eyebrow: "Department work",
    label: "Review Department Workloads",
    subtitle: "Check staff submissions, adjust workload details, and record approval decisions.",
    color: "bg-[#2f4d9c]",
    accent: "border-[#2f4d9c]",
    badge: "01",
    route: "/department-head",
  },
  {
    key: "academic",
    eyebrow: "My workload",
    label: "Review My Workload",
    subtitle: "Open your own workload, submit a request, and confirm final changes.",
    color: "bg-[#9a8538]",
    accent: "border-[#9a8538]",
    badge: "02",
    route: "/workload-platform",
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

  const displayName = profile.full_name || profile.email;
  const department = profile.department || "Department not assigned";

  return (
    <div className="min-h-screen bg-[#eef3ff] px-6 py-16">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-6xl items-start rounded-md bg-[#f7f9fc] px-8 py-14 shadow-sm">
        <div className="w-full">
          <div className="text-center">
            <h1 className="text-5xl font-semibold text-[#2f4d9c] [text-shadow:0_2px_2px_rgba(47,77,156,0.2)]">
              Workload Verification System
            </h1>
            <h2 className="mt-9 text-4xl font-semibold text-[#2f4d9c]">
              Welcome, {displayName}
            </h2>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <span className="rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                Department
              </span>
              <span className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-600">
                {department}
              </span>
            </div>
            <p className="mt-5 text-base text-slate-500">
              Choose what you want to work on today.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-10 md:grid-cols-2">
            {HOD_CHOICES.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => navigate(card.route)}
                className={`mx-auto flex min-h-[280px] w-full max-w-[340px] flex-col rounded-md border-2 ${card.accent} bg-white p-0 text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg`}
              >
                <div className={`${card.color} flex items-center justify-between rounded-t-[3px] px-6 py-4 text-white`}>
                  <span className="text-sm font-bold uppercase">
                    {card.eyebrow}
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700">
                    {card.badge}
                  </span>
                </div>
                <div className="flex flex-1 flex-col justify-center px-6 py-8">
                  <div className="text-3xl font-semibold leading-tight text-slate-800">
                    {card.label}
                  </div>
                  <p className="mt-4 text-base leading-7 text-slate-600">
                    {card.subtitle}
                  </p>
                </div>
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
