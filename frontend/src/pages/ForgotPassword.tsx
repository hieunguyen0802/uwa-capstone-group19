import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayoutFrame from "../components/common/AuthLayoutFrame";
import PasswordField from "../components/common/PasswordField";

export default function ForgotPassword() {
  const MAX_PASSWORD_LENGTH = 64;
  const MAX_EMAIL_LENGTH = 254;
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [sendCooldown, setSendCooldown] = useState(0);
  const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  const emailRule = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const codeRule = /^\d{6}$/;
  const isPasswordInvalid = password.length > 0 && !passwordRule.test(password);
  const isConfirmPasswordInvalid = confirmPassword.length > 0 && password !== confirmPassword;

  useEffect(() => {
    if (sendCooldown <= 0) return;
    const timer = window.setTimeout(() => setSendCooldown((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [sendCooldown]);

  const handleSendCode = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required before sending verification code.");
      return;
    }
    if (!emailRule.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
      setError(`Email address must be no more than ${MAX_EMAIL_LENGTH} characters.`);
      return;
    }

    const mockCode = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedCode(mockCode);
    setError("");
    setSuccessMessage("Verification code sent. Please check your email.");
    setSendCooldown(60);
    alert(`Demo verification code: ${mockCode}`);
  };

  const handleResetPassword = () => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!password.trim()) {
      setError("New Password is required.");
      return;
    }
    if (!confirmPassword.trim()) {
      setError("Confirm Password is required.");
      return;
    }
    if (!emailRule.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (email.trim().length > MAX_EMAIL_LENGTH) {
      setError(`Email address must be no more than ${MAX_EMAIL_LENGTH} characters.`);
      return;
    }
    if (!passwordRule.test(password)) {
      setError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      );
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!generatedCode) {
      setError("Please send the verification code first.");
      return;
    }
    if (!verificationCode.trim()) {
      setError("Verification code is required.");
      return;
    }
    if (!codeRule.test(verificationCode.trim())) {
      setError("Verification code must be exactly 6 digits.");
      return;
    }
    if (verificationCode.trim() !== generatedCode) {
      setError("Verification code is incorrect. Please enter the 6-digit code.");
      return;
    }

    setError("");
    setSuccessMessage("");
    alert("Password reset successfully. Please sign in.");
    navigate("/login");
  };

  return (
    <AuthLayoutFrame>
      <div className="mx-auto mt-8 w-full max-w-md text-left">
        <h2 className="text-center text-4xl font-semibold text-[#2f4d9c]">Forgot Password</h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Reset your password using email verification code.
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-700">Email Address</label>
            <input
              type="email"
              value={email}
              placeholder="john.doe@example.com"
              onChange={(e) => setEmail(e.target.value)}
              maxLength={MAX_EMAIL_LENGTH}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={verificationCode}
                placeholder="Enter 6-digit code"
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendCooldown > 0}
                className="rounded bg-[#2f4d9c] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {sendCooldown > 0 ? `${sendCooldown}s` : "Send Code"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Verification code must be 6 digits.</p>
          </div>

          <PasswordField
            label="New Password"
            value={password}
            onChange={setPassword}
            placeholder="Enter new password"
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword((prev) => !prev)}
            maxLength={MAX_PASSWORD_LENGTH}
            isInvalid={isPasswordInvalid}
            helperText="Must include at least 8 characters, uppercase, lowercase, number, and special character."
            helperTextClassName={`mt-1 text-xs ${isPasswordInvalid ? "text-red-600" : "text-slate-500"}`}
            toggleAriaLabel="Toggle new password visibility"
          />

          <PasswordField
            label="Confirm Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="re-enter password"
            showPassword={showConfirmPassword}
            onToggleShowPassword={() => setShowConfirmPassword((prev) => !prev)}
            maxLength={MAX_PASSWORD_LENGTH}
            isInvalid={isConfirmPasswordInvalid}
            helperText={isConfirmPasswordInvalid ? "Passwords do not match." : undefined}
            helperTextClassName="mt-1 text-xs font-medium text-red-600"
            toggleAriaLabel="Toggle confirm password visibility"
          />

          <button
            type="button"
            onClick={handleResetPassword}
            className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
          >
            Reset Password
          </button>

          {successMessage ? <p className="text-sm text-green-600">{successMessage}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </AuthLayoutFrame>
  );
}
