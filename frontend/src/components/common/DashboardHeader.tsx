import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";

type DashboardHeaderProps = {
  title: string;
  hasNewMessage?: boolean;
  onMessageClick?: () => void;
  showMessageButton?: boolean;
  greetingName?: string;
  onAvatarClick: () => void;
  avatarSrc: string | null;
};

export default function DashboardHeader({
  title,
  hasNewMessage = false,
  onMessageClick,
  showMessageButton = true,
  greetingName = "Sam",
  onAvatarClick,
  avatarSrc,
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-md bg-[#2f4d9c] px-4 py-3 text-white md:grid-cols-[minmax(230px,1fr)_auto_minmax(230px,1fr)] md:items-center md:px-6">
      <div className="flex min-w-0 justify-center md:justify-start">
        <img
          src="/uwa-logo-reversed.svg"
          alt="The University of Western Australia"
          className="h-14 w-full max-w-[260px] object-contain object-left"
        />
      </div>

      <div className="min-w-0 text-center text-2xl font-semibold leading-tight text-white">{title}</div>

      <div className="flex min-w-0 items-center justify-center gap-3 text-white md:justify-end">
        {showMessageButton && (
          <button
            type="button"
            aria-label="Messages"
            className="inline-flex items-center justify-center text-white"
            onClick={onMessageClick}
          >
            <span className="relative inline-flex h-10 w-10 items-center justify-center" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />
                <path d="M4.5 8l7.5 6 7.5-6" />
              </svg>
              {hasNewMessage && (
                <span className="absolute right-[1px] top-[1px] h-3 w-3 rounded-full bg-red-500 ring-2 ring-[#2f4d9c]" />
              )}
            </span>
          </button>
        )}
        <div className="text-right text-sm font-semibold">Hi, {greetingName}</div>
        <button
          type="button"
          aria-label="Open profile"
          onClick={onAvatarClick}
          className="h-11 w-11 overflow-hidden rounded-full bg-white/90"
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-white/90" />
          )}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded px-2 py-1 text-sm font-semibold text-white hover:bg-white/15"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
