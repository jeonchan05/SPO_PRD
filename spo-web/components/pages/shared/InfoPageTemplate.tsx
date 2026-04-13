import Link from "next/link";

type InfoPageTemplateProps = {
  badge: string;
  title: string;
  description: string;
  points: string[];
  mainClassName?: string;
};

export function InfoPageTemplate({
  badge,
  title,
  description,
  points,
  mainClassName,
}: InfoPageTemplateProps) {
  const mainClasses = ["px-6 pb-24 pt-32", mainClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={mainClasses}>
      <section className="mx-auto max-w-5xl rounded-3xl border border-white/40 bg-white/35 p-10 shadow-xl backdrop-blur-xl lg:p-14">
        <p className="inline-flex items-center rounded-full border border-blue-200/60 bg-blue-100/70 px-4 py-2 text-sm font-bold tracking-wide text-primary">
          {badge}
        </p>

        <h1 className="mt-8 font-headline text-4xl font-extrabold leading-tight text-on-background lg:text-5xl">
          {title}
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-on-surface-variant">
          {description}
        </p>

        <div className="mt-10 grid gap-4">
          {points.map((point) => (
            <div
              key={point}
              className="glass-card flex items-center gap-3 rounded-2xl px-5 py-4"
            >
              <span className="material-symbols-outlined text-primary">check_circle</span>
              <p className="font-semibold text-on-surface">{point}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-primary px-7 py-3 font-bold text-on-primary transition-all hover:bg-primary-container"
            href="/sign-up"
          >
            시작하기
          </Link>
          <Link
            className="glass-card rounded-full px-7 py-3 font-bold text-primary transition-all hover:bg-white/60"
            href="/"
          >
            홈으로
          </Link>
        </div>
      </section>
    </main>
  );
}
