"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const errors: Record<string, string> = {
  AccessDenied: "Access is limited to verified tossdown.com accounts.",
  Configuration: "Google sign-in is not configured yet. Please contact an administrator.",
  OAuthSignin: "Google sign-in could not be started. Please try again.",
  OAuthCallback: "Google sign-in could not be completed. Please try again.",
  Verification: "The sign-in link is invalid or has expired.",
};

function SignInForm() {
  const error = useSearchParams().get("error");
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-2xl font-semibold">tossdown <span className="text-accent">AI</span></div>
        <p className="mt-3 text-neutral-500">Sign in with your verified tossdown.com Google account.</p>
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errors[error] || "Sign-in failed. Please try again."}</p>}
        <button onClick={() => signIn("google", { callbackUrl: "/" })} className="mt-6 w-full rounded-lg bg-accent px-5 py-3 text-white">Sign in with Google</button>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return <Suspense fallback={<main className="min-h-screen flex items-center justify-center p-6">Loading…</main>}><SignInForm /></Suspense>;
}
