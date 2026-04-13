"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthForm from "@/components/auth/AuthForm";

export default function SignInPage() {
  const [isSessionChecking, setIsSessionChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const verifySession = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          user?: {
            role?: string;
          };
        };

        if (!cancelled && response.ok && data.user) {
          window.location.replace("/main");
          return;
        }
      } finally {
        if (!cancelled) {
          setIsSessionChecking(false);
        }
      }
    };

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isSessionChecking) {
    return (
      <div className="flex min-h-[calc(100vh-13rem)] items-center justify-center px-4 py-20">
        <p className="text-sm font-semibold text-slate-600">로그인 상태를 확인하는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="bg-background text-on-background antialiased">
      <header className="fixed top-0 z-50 w-full bg-white/80 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center px-6 py-4">
          <Link
            className="font-headline text-2xl font-bold tracking-tighter text-blue-600"
            href="/"
          >
            SPO
          </Link>
        </div>
      </header>

      <main className="relative flex min-h-[calc(100vh-6rem)] items-center justify-center overflow-hidden px-4 pb-12 pt-24">
        <div className="absolute left-[-5%] top-[-10%] h-[40vw] w-[40vw] rounded-full bg-primary-container/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] h-[35vw] w-[35vw] rounded-full bg-surface-tint/5 blur-[100px]" />

        <div className="z-10 w-full max-w-[480px]">
          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-8 shadow-[0_40px_60px_-15px_rgba(25,28,29,0.05)] md:p-10">
            <AuthForm
              buttonText="로그인"
              description="공부하고 장학금 받는 새로운 습관"
              endpoint="/auth/sign-in"
              fields={[
                {
                  name: "loginIdOrEmail",
                  label: "아이디",
                  placeholder: "아이디를 입력해주세요",
                },
                {
                  name: "password",
                  label: "비밀번호",
                  placeholder: "비밀번호를 입력해주세요",
                  type: "password",
                },
              ]}
              initialValues={{ loginIdOrEmail: "", password: "" }}
              resultFields={[
                { key: "user.name", label: "이름" },
                { key: "user.loginId", label: "아이디" },
                { key: "user.email", label: "이메일" },
              ]}
              title="SPO에 오신 것을 환영합니다"
            />

            <div className="mt-8 flex justify-center gap-6 text-xs font-medium text-slate-500">
              <Link className="transition-colors hover:text-primary" href="/find-id">
                아이디 찾기
              </Link>
              <span className="h-3 w-px bg-slate-200" />
              <Link className="transition-colors hover:text-primary" href="/find-password">
                비밀번호 찾기
              </Link>
              <span className="h-3 w-px bg-slate-200" />
              <Link className="transition-colors hover:text-primary" href="/sign-up">
                회원가입
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
