import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export default function SignUpPage() {
  return (
    <div className="overflow-x-hidden bg-background font-body text-on-surface antialiased">
      <header className="fixed top-0 z-50 w-full bg-white/80 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center px-6 py-4">
          <Link
            className="font-headline text-2xl font-bold tracking-tighter text-blue-600"
            href="/"
          >
            SPO
          </Link>
        </div>
      </header>

      <main className="relative flex min-h-[calc(100vh-6rem)] items-center justify-center overflow-hidden pb-12 pt-24">
        <div className="absolute left-[-5%] top-[-10%] h-[40vw] w-[40vw] rounded-full bg-primary-container/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] h-[35vw] w-[35vw] rounded-full bg-surface-tint/5 blur-[100px]" />

        <section className="container relative z-10 px-4">
          <div className="mx-auto max-w-[480px]">
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-8 shadow-[0_40px_60px_-15px_rgba(25,28,29,0.05)] md:p-10">
              <AuthForm
                buttonText="회원가입"
                description="함께 공부하고 장학금 받는 새로운 습관"
                endpoint="/auth/sign-up"
                fields={[
                  {
                    name: "userType",
                    label: "가입 유형",
                    type: "segmented",
                    options: [
                      { label: "학생 가입자", value: "student" },
                      { label: "학원 가입자", value: "academy" },
                    ],
                  },
                  {
                    name: "profileImage",
                    label: "프로필 이미지",
                    type: "file",
                    accept: "image/png,image/jpeg,image/webp,image/gif",
                  },
                  { name: "name", label: "이름", placeholder: "홍길동" },
                  { name: "loginId", label: "아이디", placeholder: "honggildong" },
                  {
                    name: "email",
                    label: "이메일",
                    placeholder: "example@spo.ac.kr",
                    type: "email",
                  },
                  {
                    name: "password",
                    label: "비밀번호",
                    placeholder: "8자 이상 입력해주세요",
                    type: "password",
                  },
                  {
                    name: "passwordConfirm",
                    label: "비밀번호 확인",
                    placeholder: "비밀번호를 다시 입력해주세요",
                    type: "password",
                  },
                  {
                    name: "phoneNumber",
                    label: "전화번호",
                    placeholder: "01012345678",
                    type: "tel",
                  },
                  {
                    name: "academyName",
                    label: "학원명",
                    placeholder: "SPO 강남캠퍼스",
                    visibleWhen: { field: "userType", equals: "academy" },
                  },
                  {
                    name: "businessRegistrationNumber",
                    label: "사업자번호",
                    placeholder: "숫자 10자리",
                    inputMode: "numeric",
                    visibleWhen: { field: "userType", equals: "academy" },
                  },
                  {
                    name: "academyAddress",
                    label: "학원 주소",
                    placeholder: "서울특별시 강남구 ...",
                    type: "textarea",
                    visibleWhen: { field: "userType", equals: "academy" },
                  },
                  {
                    name: "termsAgreed",
                    label: "이용약관 및 개인정보 수집·이용 동의(필수)",
                    type: "checkbox",
                  },
                ]}
                initialValues={{
                  userType: "student",
                  name: "",
                  loginId: "",
                  email: "",
                  password: "",
                  passwordConfirm: "",
                  phoneNumber: "",
                  academyName: "",
                  businessRegistrationNumber: "",
                  academyAddress: "",
                  termsAgreed: "false",
                }}
                resultFields={[
                  { key: "user.name", label: "이름" },
                  { key: "user.loginId", label: "아이디" },
                  { key: "user.email", label: "이메일" },
                  { key: "user.phoneNumber", label: "전화번호" },
                  { key: "user.profileImageUrl", label: "프로필 이미지 URL" },
                ]}
                title="SPO에 오신 것을 환영합니다"
              />

              <div className="mt-6 text-center">
                <p className="text-sm font-medium text-on-surface-variant">
                  이미 계정이 있으신가요?
                  <Link className="ml-2 font-bold text-primary hover:underline" href="/sign-in">
                    로그인
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
