import type { ChangeEvent } from "react";
import ProfileModalFieldGrid, { type ProfileModalUser } from "./ProfileModalFieldGrid";

export type { ProfileModalUser };

type ProfileModalProps = {
  open: boolean;
  onClose: () => void;
  avatarSrc: string | null;
  onAvatarUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  user: ProfileModalUser;
};

export default function ProfileModal({
  open,
  onClose,
  avatarSrc,
  onAvatarUpload,
  user,
}: ProfileModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-2xl font-semibold text-slate-800">Profile</div>
          <button
            type="button"
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-200"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="mb-6 flex items-center gap-4">
          <div className="h-20 w-20 overflow-hidden rounded-full bg-slate-200">
            {avatarSrc ? (
              <img src={avatarSrc} alt="Profile avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-slate-200" />
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]">
            Upload Avatar
            <input type="file" accept="image/*" className="hidden" onChange={onAvatarUpload} />
          </label>
        </div>

        <ProfileModalFieldGrid user={user} />
      </div>
    </div>
  );
}
