import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export default function FindPasswordPage() {
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
              buttonText="비밀번호 재설정"
              description={"가입한 아이디(또는 이메일)와 이메일을 입력한 뒤\n새 비밀번호를 설정할 수 있습니다."}
              endpoint="/auth/find-password"
              fields={[
                {
                  name: "loginIdOrEmail",
                  label: "이메일 / 아이디",
                  placeholder: "아이디 또는 이메일을 입력해주세요",
                },
                {
                  name: "email",
                  label: "가입 이메일",
                  placeholder: "example@spo.ac.kr",
                  type: "email",
                },
                {
                  name: "newPassword",
                  label: "새 비밀번호",
                  placeholder: "8자 이상 입력해주세요",
                  type: "password",
                },
              ]}
              initialValues={{ loginIdOrEmail: "", email: "", newPassword: "" }}
              resultFields={[
                { key: "loginId", label: "아이디" },
                { key: "email", label: "이메일" },
              ]}
              title="비밀번호 찾기"
            />

            <div className="mt-8 flex justify-center gap-6 text-xs font-medium text-slate-500">
              <Link className="transition-colors hover:text-primary" href="/sign-in">
                로그인
              </Link>
              <span className="h-3 w-px bg-slate-200" />
              <Link className="transition-colors hover:text-primary" href="/find-id">
                아이디 찾기
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
