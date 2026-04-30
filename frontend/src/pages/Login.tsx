import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import AuthLayoutFrame from "../components/common/AuthLayoutFrame";
import PasswordField from "../components/common/PasswordField";

export default function Login() {
  const MAX_IDENTIFIER_LENGTH = 254;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const navigate = useNavigate();
  const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

  useEffect(() => {
    const remembered = localStorage.getItem("rememberedLogin");
    if (!remembered) return;
    try {
      const parsed = JSON.parse(remembered) as { identifier?: string; password?: string };
      setIdentifier(parsed.identifier || "");
      setPassword(parsed.password || "");
      setRememberMe(true);
    } catch {
      localStorage.removeItem("rememberedLogin");
    }
  }, []);

  const handleLogin = async () => {
    const normalizedInput = identifier.trim();
    const trimmedPassword = password.trim();
    if (normalizedInput.length > MAX_IDENTIFIER_LENGTH) {
      setLoginError(`Staff ID or Email Address must be no more than ${MAX_IDENTIFIER_LENGTH} characters.`);
      return;
    }
    if (!passwordRule.test(trimmedPassword)) {
      setLoginError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      );
      return;
    }

    try {
      setLoginError("");
      const isEmailInput = normalizedInput.includes("@");
      const res = await axios.post("http://localhost:8000/login/", {
        staff_id: isEmailInput ? "" : normalizedInput,
        email: isEmailInput ? normalizedInput : "",
        password: trimmedPassword,
      });

      console.log(res.data);

      localStorage.setItem("user", JSON.stringify(res.data));
      localStorage.setItem("auth_identifier", normalizedInput);
      if (rememberMe) {
        localStorage.setItem(
          "rememberedLogin",
          JSON.stringify({ identifier: normalizedInput, password: trimmedPassword })
        );
      } else {
        localStorage.removeItem("rememberedLogin");
      }

      navigate("/role");

    } catch (err) {
      setLoginError(
        "Employee ID does not exist or the account is inactive. Please contact admin (Senior School Coordinator)."
      );
    }
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

            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="Enter password"
              showPassword={showPassword}
              onToggleShowPassword={() => setShowPassword((prev) => !prev)}
              toggleAriaLabel="Toggle password visibility"
            />

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setRememberMe(checked);
                  if (!checked) {
                    localStorage.removeItem("rememberedLogin");
                  }
                }}
                className="h-4 w-4 accent-[#2f4d9c]"
              />
              Remember Me
            </label>
            <div className="text-right">
              <Link to="/forgot-password" className="text-sm font-medium text-[#2f4d9c] hover:underline">
                Forgot password?
              </Link>
            </div>

            <button
              onClick={handleLogin}
              className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
            >
              Sign In
            </button>

            <p className="text-center text-sm text-slate-700">
              First time using the system?{" "}
              <Link to="/register" className="font-semibold text-[#2f4d9c] hover:underline">
                Set password
              </Link>
            </p>

            {loginError ? <p className="text-sm text-red-600">{loginError}</p> : null}
      </div>
    </AuthLayoutFrame>
  );
}