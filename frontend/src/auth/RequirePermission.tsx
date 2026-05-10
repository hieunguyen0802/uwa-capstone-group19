/**
 * RequirePermission: route guard that lets a child render only if the
 * authenticated user holds the given permission codename.
 *
 * Unauthenticated -> /login
 * Authenticated but lacking permission -> Access denied
 * Still loading the profile -> inline spinner
 */
import { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type Props = {
  permission: string;
  children: ReactNode;
};

export default function RequirePermission({ permission, children }: Props) {
  const navigate = useNavigate();
  const { profile, loading, logout } = useAuth();
  const rawPermissions = profile?.permissions;
  const permissions = Array.isArray(rawPermissions) ? rawPermissions : [];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (!permissions.includes(permission)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4 py-10 font-serif">
        <section className="w-full max-w-lg rounded-md border border-slate-200 bg-white px-8 py-9 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#2f4d9c] text-lg font-semibold text-white">
            !
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-900">
            Access denied
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your current account does not have permission to open this page.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(homeRouteForRole(profile.role), { replace: true })}
              className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
            >
              My dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}

function homeRouteForRole(role: string): string {
  switch (role) {
    case "HOS":
      return "/school-head";
    case "SCHOOL_OPS":
      return "/school-operations";
    case "ACADEMIC":
      return "/academic";
    case "HOD":
    default:
      return "/role";
  }
}
