import { ReactNode } from "react";

type AuthLayoutFrameProps = {
  children: ReactNode;
};

export default function AuthLayoutFrame({ children }: AuthLayoutFrameProps) {
  return (
    <div className="min-h-screen bg-[#eef3ff] px-6 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-7xl items-center justify-center rounded-md bg-[#f7f9fc] px-8 py-20 shadow-sm">
        <div className="mx-auto w-full max-w-3xl text-center">
          <h1 className="whitespace-nowrap text-6xl font-semibold text-[#2f4d9c] [text-shadow:0_2px_2px_rgba(47,77,156,0.25)]">
            Workload Verification System
          </h1>
          {children}
        </div>
      </div>
    </div>
  );
}
