import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayoutFrame from "../components/common/AuthLayoutFrame";

type StaffAuthRecord = {
  staffId: string;
  email: string;
  roles: string[];
};

const KNOWN_STAFF: StaffAuthRecord[] = [
  { staffId: "50123451", email: "ann.culhane@uwa.edu.au", roles: ["HOD", "ACADEMIC"] },
  { staffId: "50123462", email: "oliver.stone@uwa.edu.au", roles: ["ACADEMIC"] },
  { staffId: "50123473", email: "ahmed.adhyyasar@uwa.edu.au", roles: ["ACADEMIC"] },
  { staffId: "50123484", email: "lisa.brown@uwa.edu.au", roles: ["ACADEMIC"] },
  { staffId: "50123495", email: "mary.smith@uwa.edu.au", roles: ["ACADEMIC"] },
];

export default function Login() {
  const MAX_IDENTIFIER_LENGTH = 254;
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [sendCooldown, setSendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");
  const [loginError, setLoginError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = window.setTimeout(() => setSendCooldown((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [sendCooldown]);

  function resolveStaff(input: string) {
    const normalized = input.trim().toLowerCase();
    return KNOWN_STAFF.find(
      (item) => item.staffId.toLowerCase() === normalized || item.email.toLowerCase() === normalized
    );
  }

  const handleSendOtp = () => {
    const normalizedInput = identifier.trim();
    if (normalizedInput.length > MAX_IDENTIFIER_LENGTH) {
      setLoginError(`Staff ID or Email Address must be no more than ${MAX_IDENTIFIER_LENGTH} characters.`);
      return;
    }
    const staff = resolveStaff(normalizedInput);
    if (!staff) {
      setLoginError("该员工当前不存在系统中，请先联系行政管理人员。");
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedCode(code);
    setLoginError("");
    setSuccessMessage(`验证码已发送至 ${staff.email}`);
    setSendCooldown(60);
    alert(`Demo OTP code: ${code}`);
  };

  const handleLogin = () => {
    const normalizedInput = identifier.trim();
    const staff = resolveStaff(normalizedInput);
    if (!staff) {
      setLoginError("该员工当前不存在系统中，请先联系行政管理人员。");
      return;
    }
    if (!generatedCode) {
      setLoginError("请先发送验证码。");
      return;
    }
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setLoginError("验证码必须是 6 位数字。");
      return;
    }
    if (otpCode.trim() !== generatedCode) {
      setLoginError("验证码错误，请重新输入。");
      return;
    }

    const userPayload = {
      username: staff.email,
      role: staff.roles[0],
      roles: staff.roles,
    };
    localStorage.setItem("user", JSON.stringify(userPayload));
    localStorage.setItem("auth_identifier", normalizedInput);
    setLoginError("");
    setSuccessMessage("");
    navigate("/role");
  };

  return (
    <AuthLayoutFrame>
      <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-3">
        <img src="/logo512.png" alt="UWA Logo" className="h-20 w-20 object-contain" />
        <div className="text-left font-['Times_New_Roman',Times,serif] text-[#2f4d9c]">
          <div className="text-[18px] font-semibold uppercase leading-[1.05] tracking-[0.03em]">
            THE UNIVERSITY OF
          </div>
          <div className="text-[52px] font-semibold uppercase leading-[0.9] tracking-[0.01em]">
            WESTERN
          </div>
          <div className="text-[52px] font-semibold uppercase leading-[0.9] tracking-[0.01em]">
            AUSTRALIA
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-md space-y-4 text-left">
        <div>
          <label className="mb-1 block text-sm text-slate-700">Staff ID or Email Address</label>
          <input
            type="text"
            value={identifier}
            placeholder="8-digit staff ID or john.doe@example.com"
            onChange={(e) => setIdentifier(e.target.value)}
            maxLength={MAX_IDENTIFIER_LENGTH}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-700">Verification Code</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={otpCode}
              placeholder="Enter 6-digit code"
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
            />
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={sendCooldown > 0}
              className="rounded bg-[#2f4d9c] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {sendCooldown > 0 ? `${sendCooldown}s` : "Send Code"}
            </button>
          </div>
        </div>

        <button
          onClick={handleLogin}
          className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
        >
          Sign In
        </button>

        {successMessage ? <p className="text-sm text-green-600">{successMessage}</p> : null}
        {loginError ? <p className="text-sm text-red-600">{loginError}</p> : null}
      </div>
    </AuthLayoutFrame>
  );
}