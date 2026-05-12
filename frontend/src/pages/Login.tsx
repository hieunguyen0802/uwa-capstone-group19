import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AxiosError } from "axios";
import AuthLayoutFrame from "../components/common/AuthLayoutFrame";
import { requestOtp, verifyOtp } from "../api/auth";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const MAX_IDENTIFIER_LENGTH = 254;

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sendCooldown, setSendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { reload } = useAuth();

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setSendCooldown((prev) => prev - 1),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [sendCooldown]);

  function resolveEmail(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.includes("@")) return trimmed;
    return null;
  }

  const handleSendOtp = async () => {
    const email = resolveEmail(identifier);
    if (!email) {
      setLoginError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setLoginError("");
    try {
      await requestOtp(email);
      setSuccessMessage(`Verification code sent to ${email}`);
      setSendCooldown(60);
    } catch (err) {
      setLoginError(extractErrorMessage(err, "Failed to send verification code."));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    const email = resolveEmail(identifier);
    if (!email) {
      setLoginError("Please enter a valid email address.");
      return;
    }
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setLoginError("Verification code must be 6 digits.");
      return;
    }

    setBusy(true);
    setLoginError("");
    try {
      const result = await verifyOtp(email, otpCode.trim());
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.setItem(ACCESS_TOKEN_KEY, result.access);
      sessionStorage.setItem(REFRESH_TOKEN_KEY, result.refresh);
      await reload();
      navigate(homeRouteForRole(result.role), { replace: true });
    } catch (err) {
      setLoginError(extractErrorMessage(err, "Invalid or expired code."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayoutFrame>
      <div className="mx-auto mt-8 max-w-xl px-4">
        <img
          src="/uwa-crest-blue.svg"
          alt="The University of Western Australia"
          className="mx-auto h-auto w-full max-w-[560px] object-contain"
        />
      </div>

      <div className="mx-auto mt-8 max-w-md space-y-4 text-left">
        <div>
          <label className="mb-1 block text-sm text-slate-700">
            Email Address
          </label>
          <input
            type="text"
            value={identifier}
            placeholder="e.g. jiaao@uwa.edu.au"
            onChange={(e) => setIdentifier(e.target.value)}
            maxLength={MAX_IDENTIFIER_LENGTH}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">
            Verification Code
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={otpCode}
              placeholder="Enter 6-digit code"
              onChange={(e) =>
                setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              maxLength={6}
              className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
            />
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={busy || sendCooldown > 0}
              className="rounded bg-[#2f4d9c] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {sendCooldown > 0 ? `${sendCooldown}s` : "Send Code"}
            </button>
          </div>
        </div>

        <button
          onClick={handleLogin}
          disabled={busy}
          className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:bg-slate-400"
        >
          Sign In
        </button>

        {successMessage ? (
          <p className="text-sm text-green-600">{successMessage}</p>
        ) : null}
        {loginError ? (
          <p className="text-sm text-red-600">{loginError}</p>
        ) : null}
      </div>
    </AuthLayoutFrame>
  );
}

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ error?: string }>;
  return axiosErr?.response?.data?.error ?? fallback;
}

/** HOD is the only role that lands on the chooser; everyone else jumps home. */
function homeRouteForRole(role: string): string {
  switch (role) {
    case "HOS":
      return "/school-head";
    case "SCHOOL_OPS":
      return "/school-operations";
    case "ACADEMIC":
      return "/workload-platform";
    case "HOD":
    default:
      return "/role";
  }
}
