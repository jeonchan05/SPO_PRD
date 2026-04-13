import Link from "next/link";

const navItems = [
  { href: "/#landing-intro", label: "서비스 소개" },
  { href: "/#service-flow", label: "운영 방식" },
  { href: "/#core-features", label: "핵심 기능" },
];

export function SiteHeader() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-white/82 backdrop-blur-xl transition-all duration-300">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-4">
        <div className="flex items-center gap-8 md:gap-10">
          <Link
            className="font-headline text-2xl font-bold tracking-tighter text-blue-600"
            href="/"
          >
            SPO
          </Link>

          <div className="hidden gap-6 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                className="font-['Manrope'] font-semibold tracking-tight text-slate-600 transition-all duration-300 hover:text-blue-500"
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            className="rounded-full border border-slate-200 bg-white px-5 py-2 font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-95"
            href="/sign-in"
          >
            로그인
          </Link>
          <Link
            className="rounded-full bg-primary px-6 py-2 font-bold text-on-primary shadow-lg shadow-blue-500/20 transition-all hover:bg-primary-container active:scale-95"
            href="/sign-up"
          >
            회원가입
          </Link>
        </div>
      </div>
    </nav>
  );
}
