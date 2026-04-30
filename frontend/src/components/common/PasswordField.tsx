type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  maxLength?: number;
  isInvalid?: boolean;
  helperText?: string;
  helperTextClassName?: string;
  toggleAriaLabel: string;
};

export default function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  onToggleShowPassword,
  maxLength,
  isInvalid = false,
  helperText,
  helperTextClassName,
  toggleAriaLabel,
}: PasswordFieldProps) {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate-700">{label}</label>
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          className={`w-full rounded border bg-white px-3 py-2 pr-10 text-sm outline-none ${
            isInvalid ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-[#2f4d9c]"
          }`}
        />
        <button
          type="button"
          onClick={onToggleShowPassword}
          className="absolute inset-y-0 right-0 px-3 text-slate-500"
          aria-label={toggleAriaLabel}
        >
          {showPassword ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="3" />
              <line x1="4" y1="4" x2="20" y2="20" />
            </svg>
          )}
        </button>
      </div>
      {helperText ? <p className={helperTextClassName || "mt-1 text-xs text-slate-500"}>{helperText}</p> : null}
    </div>
  );
}
