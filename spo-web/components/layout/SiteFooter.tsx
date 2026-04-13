export function SiteFooter() {
  return (
    <footer className="site-footer w-full border-t border-white/20 bg-white/20 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-3 px-8 py-12">
        <div className="flex flex-col items-start gap-3">
          <span className="font-headline text-xl font-bold text-slate-900">SPO</span>
          <p className="font-['Inter'] text-sm font-semibold text-slate-600">
            대표자 : 강호원, 전찬
          </p>
          <p className="font-['Inter'] text-sm font-medium text-slate-500">
            © 2026 SPO (Study and Scholarship). All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
