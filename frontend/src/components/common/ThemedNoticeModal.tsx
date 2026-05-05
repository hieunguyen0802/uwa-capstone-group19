/** Shown when a workload row is cancelled/superseded — matches dashboard blue header styling. */

export const SUPERSEDED_RECORD_MESSAGE =
  "This record has been superseded by a new version.";

type ThemedNoticeModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
};

export default function ThemedNoticeModal({
  open,
  onClose,
  title = "Notice",
  message,
  confirmLabel = "OK",
}: ThemedNoticeModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-md bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="themed-notice-title"
      >
        <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
          <div id="themed-notice-title" className="text-base font-bold">
            {title}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
            onClick={onClose}
            aria-label="Close"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm leading-relaxed text-slate-700">{message}</p>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-[#2f4d9c] px-8 py-2 text-sm font-semibold text-white hover:bg-[#29458c]"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
