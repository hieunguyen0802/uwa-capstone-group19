/**
 * RequirePermission — route guard that lets a child render only if the
 * authenticated user holds the given permission codename.
 *
 * Unauthenticated → /login
 * Authenticated but lacking permission → /role (neutral landing)
 * Still loading the profile → inline spinner
 */
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type Props = {
  permission: string;
  children: ReactNode;
};

export default function RequirePermission({ permission, children }: Props) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (!profile.permissions.includes(permission)) {
    return <Navigate to="/role" replace />;
  }

  return <>{children}</>;
}
