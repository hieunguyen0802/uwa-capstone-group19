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
  return (
    <div className="flex items-center justify-between rounded-md bg-[#2f4d9c] px-6 py-3">
      <div className="flex items-center gap-3">
        <img src="/logo512.png" alt="UWA" className="h-10 w-10 rounded-full bg-white/90 object-contain" />
        <div className="leading-tight text-white">
          <div className="text-xs font-semibold tracking-wide opacity-95">THE UNIVERSITY OF</div>
          <div className="text-xl font-bold leading-none">WESTERN AUSTRALIA</div>
        </div>
      </div>

      <div className="text-center text-2xl font-semibold text-white">{title}</div>

      <div className="flex items-center gap-3 text-white">
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
        <button type="button" className="rounded px-2 py-1 text-sm font-semibold text-white hover:bg-white/15">
          Logout
        </button>
      </div>
    </div>
  );
}
