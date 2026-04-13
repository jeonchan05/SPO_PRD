'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "@/app/css/pages/home.module.css";
import { LandingScrollEffects } from "./LandingScrollEffects";

export function HomeLandingPage() {
  const [startHref, setStartHref] = useState('/sign-in');

  useEffect(() => {
    if (window.localStorage.getItem('spo-user')) {
      setStartHref('/main');
    }
  }, []);

  return (
    <main className={`overflow-hidden pt-24 ${styles.page}`}>
      <LandingScrollEffects />
      <section
        id="landing-intro"
        className={`relative flex min-h-[720px] scroll-mt-24 items-center justify-center overflow-hidden px-6 ${styles.snapSection}`}
      >
        <div className="pointer-events-none absolute inset-0 z-0 opacity-20">
          <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 h-[500px] w-[500px] rounded-full bg-secondary blur-[150px]" />
        </div>

        <div className="z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div className="space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center rounded-full border border-blue-300/70 bg-blue-100/75 px-4 py-2 text-sm font-bold tracking-wide text-primary shadow-sm backdrop-blur-md">
              Academy Study Operations Platform
            </div>
            <h1 className="font-headline text-4xl font-extrabold leading-[1.1] tracking-tight text-on-background lg:text-6xl">
              학원 스터디 운영을
              <br />
              AI로 밀도 높게 만드는
              <br />
              <span className="text-primary">
                주제 선정·피드백 <span className="inline-block whitespace-nowrap">통합 서비스</span>
              </span>
            </h1>
            <p className="mx-auto max-w-lg text-lg font-medium leading-relaxed text-on-surface-variant lg:mx-0">
              학원은 모집 공고를 만들고 신청 체크 항목을 설정한 뒤 AI 배정안 또는
              관리자 직접 배정으로 팀을 확정합니다. 학생은 신청, 공지 확인, 출석과
              스터디 기록까지 한 흐름으로 이용할 수 있습니다. 특히 스터디룸에서
              AI 토론 주제 선정과 AI 피드백 리포트를 바로 확인할 수 있습니다.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 pt-2 sm:flex-row lg:justify-start">
              <Link
                className="bg-ethereal-gradient w-full rounded-full px-9 py-4 text-base font-bold text-on-primary shadow-xl shadow-blue-400/30 transition-all hover:scale-105 active:scale-95 sm:w-auto"
                href={startHref}
              >
                시작하기
              </Link>
              <Link
                className="glass-card w-full rounded-full px-9 py-4 text-base font-bold text-primary transition-all hover:bg-white/60 active:scale-95 sm:w-auto"
                href="/#service-flow"
              >
                운영 방식 보기
              </Link>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="glass-card relative aspect-square w-full max-w-md rotate-3 rounded-3xl p-4 shadow-2xl transition-transform duration-700 hover:rotate-0">
              <div className="h-full w-full overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
                <img
                  alt="Digital Abstract 3D Illustration"
                  className="h-full w-full object-cover"
                  data-alt="Modern 3D abstract floating sphere with glass textures and vibrant blue light against a clean white studio background"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCB73hAASZPy2sODDlN5PA7FyZSypE5rn3HYN70ugAOfnUM3JF2tTNQihVxwi7Y3C6eoja_WMqbeFD7X0twEUlsrI8KRHnpITM3HGP6HUQt2S7xTrxa2LQOKzNRfEosUSI7LPozpynRK0H_9GGaTkbpIahKsw-Gof2Eh4xed5rIIORWAsEAPxDow9X-iQqhVDsaNV-7CRgizrw6HJmXWsklRI58H1IDSmhYkL7woQTKprh6yRh8HaUVx-6PpM_qIJ8QfG4ywlJc4xg"
                />
              </div>
              <div className="absolute bottom-8 left-8 right-8 rounded-2xl border border-white/40 bg-white/40 p-6 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg shadow-blue-500/30">
                    <span
                      className="material-symbols-outlined text-white"
                      style={{ fontVariationSettings: '"FILL" 1' }}
                    >
                      school
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-primary">
                      AI Topic & Review
                    </p>
                    <p className="text-xl font-extrabold text-on-surface">기프티콘 도착</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-secondary-container/40 blur-3xl" />
          </div>
        </div>
      </section>

      <section
        id="service-flow"
        className={`relative scroll-mt-24 px-6 py-24 ${styles.snapSection}`}
      >
        <div className="relative z-10 mx-auto max-w-7xl">
          <div className="mb-20 space-y-4 text-center">
            <h2 className={`text-3xl lg:text-4xl ${styles.heavySectionTitle}`}>
              SPO는 이렇게 운영됩니다
            </h2>
            <p className="mx-auto text-lg font-extrabold text-on-surface [text-shadow:0_0_0.5px_rgba(15,23,42,0.2)] md:whitespace-nowrap">
              AI 주제 선정과 AI 피드백을 중심으로 공고 등록부터 팀 확정, 공지/출석 운영까지 하나의 루프로
              연결합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="glass-card group rounded-3xl p-10 transition-all hover:-translate-y-2">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-200/30 bg-blue-500/10 text-primary transition-transform group-hover:scale-110">
                <span className="material-symbols-outlined text-3xl">task_alt</span>
              </div>
              <h3 className={`mb-4 text-xl ${styles.heavyCardTitle}`}>AI 토론 주제 선정</h3>
              <p className="leading-relaxed text-on-surface-variant">
                스터디 자료와 학습 내용을 기반으로 토론 주제를 생성하고, 핵심 주제를 선택해
                팀 스터디를 바로 시작할 수 있습니다.
              </p>
            </div>

            <div className="glass-card group rounded-3xl p-10 transition-all hover:-translate-y-2">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-200/30 bg-blue-500/10 text-primary transition-transform group-hover:scale-110">
                <span className="material-symbols-outlined text-3xl">timer</span>
              </div>
              <h3 className={`mb-4 text-xl ${styles.heavyCardTitle}`}>AI 피드백 리포트</h3>
              <p className="leading-relaxed text-on-surface-variant">
                학습 종료 후 점수, 요약, 강점/개선점, 항목별 피드백을 확인해
                학생이 다음 학습에서 바로 반영할 수 있습니다.
              </p>
            </div>

            <div className="glass-card group rounded-3xl p-10 transition-all hover:-translate-y-2">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-200/30 bg-blue-500/10 text-primary transition-transform group-hover:scale-110">
                <span className="material-symbols-outlined text-3xl">workspace_premium</span>
              </div>
              <h3 className={`mb-4 text-xl ${styles.heavyCardTitle}`}>공고·매칭·운영 관리</h3>
              <p className="leading-relaxed text-on-surface-variant">
                공고 등록, 신청 접수, AI/수동 매칭, 공지, 출석, 리워드 기준 설정까지
                운영자가 필요한 기능을 한 서비스에서 관리할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="core-features"
        className={`scroll-mt-24 px-6 py-32 ${styles.snapSection}`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 flex flex-col items-end justify-between gap-6 lg:flex-row">
            <div className="space-y-4">
              <h2 className="font-headline text-4xl font-extrabold leading-tight lg:text-5xl">
                학원 운영과 학생 참여를
                <br />
                동시에 연결하는 핵심 기능
              </h2>
            </div>
            <p className="max-w-md text-lg font-medium text-on-surface-variant">
              SPO는 공고 작성부터 신청/매칭, 공지, 출석과 리워드까지 실제 학원 운영
              흐름에 맞춘 기능을 제공합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-6">
            <div className="glass-card-primary group relative overflow-hidden rounded-3xl p-12 text-on-primary md:col-span-4">
              <div className="relative z-10 space-y-6">
                <h3 className="text-3xl font-black tracking-tight [text-shadow:0_0_1px_rgba(255,255,255,0.45)]">
                  AI 주제 선정 + AI 피드백
                </h3>
                <p className="max-w-sm text-lg font-medium text-primary-fixed-dim">
                  스터디룸에서 토론 주제를 선택하고 학습 종료 후 AI 피드백 요약과
                  개선 포인트를 확인해 학습 밀도를 높일 수 있습니다.
                </p>
                <div className="pt-4">
                  <Link
                    className="rounded-full bg-white px-8 py-3 font-bold text-primary shadow-lg transition-all hover:bg-white/90"
                    href="/how-to-use"
                  >
                    AI 학습 흐름 보기
                  </Link>
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-[-10%] right-[-5%] h-80 w-80 opacity-20 transition-transform duration-700 group-hover:scale-110">
                <span
                  className="material-symbols-outlined text-[20rem]"
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  analytics
                </span>
              </div>
            </div>

            <div className="glass-card group col-span-1 flex cursor-pointer flex-col justify-between rounded-3xl p-10 transition-colors hover:bg-white/60 md:col-span-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/40 bg-white/60 shadow-md transition-transform group-hover:scale-110">
                <span className="material-symbols-outlined text-primary">account_balance</span>
              </div>
              <div>
                <h3 className="mb-2 text-xl font-black tracking-tight [text-shadow:0_0_0.7px_rgba(15,23,42,0.35)]">
                  참여 데이터 대시보드
                </h3>
                <p className="text-sm font-medium text-on-surface-variant">
                  공지, 신청, 매칭, 출석 현황을 화면에서 확인하고 필요한 관리 페이지로
                  바로 이동해 운영을 이어갈 수 있습니다.
                </p>
              </div>
            </div>

            <div className="glass-card group col-span-1 flex cursor-pointer flex-col justify-between rounded-3xl p-10 transition-colors hover:bg-white/60 md:col-span-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 shadow-lg shadow-blue-500/20 transition-transform group-hover:scale-110">
                <span className="material-symbols-outlined text-white">groups</span>
              </div>
              <div>
                <h3 className="mb-2 text-xl font-black tracking-tight [text-shadow:0_0_0.7px_rgba(15,23,42,0.35)]">
                  AI 팀 매칭
                </h3>
                <p className="text-sm font-medium text-on-surface-variant">
                  신청 체크 답변을 기준으로 AI 배정안을 만들고, 관리자가 직접 팀을
                  재배치한 뒤 확정할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="glass-card flex flex-col items-center gap-8 rounded-3xl border border-white/50 p-12 shadow-sm md:col-span-4 md:flex-row">
              <div className="flex-1 space-y-6">
                <h3 className="text-2xl font-black tracking-tight [text-shadow:0_0_0.7px_rgba(15,23,42,0.35)]">
                  출석·리워드 운영 시스템
                </h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined font-bold text-green-500">
                      check_circle
                    </span>
                    <span className="font-semibold text-on-surface">
                      월 최소 출석 횟수와 보상 내용을 학원별로 설정
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined font-bold text-green-500">
                      check_circle
                    </span>
                    <span className="font-semibold text-on-surface">
                      출석 관리 페이지에서 실제 출석 데이터를 확인
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined font-bold text-green-500">
                      check_circle
                    </span>
                    <span className="font-semibold text-on-surface">
                      학생 화면에서 리워드 반영 상태를 즉시 확인
                    </span>
                  </li>
                </ul>
              </div>
              <div className="glass-card w-full overflow-hidden rounded-[16px] p-3 md:w-72">
                <div className="rounded-[14px] border border-slate-200/80 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold tracking-wide text-slate-500">
                        운영 대시보드
                      </p>
                      <p className="text-sm font-bold text-slate-800">오늘 참여 현황</p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-600">
                      실시간
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-medium text-slate-500">진행 공고</p>
                      <p className="mt-1 text-sm font-extrabold text-slate-800">공고 4건</p>
                    </div>
                    <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-medium text-slate-500">매칭 대기</p>
                      <p className="mt-1 text-sm font-extrabold text-slate-800">12명</p>
                    </div>
                    <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-medium text-slate-500">확정 스터디</p>
                      <p className="mt-1 text-sm font-extrabold text-slate-800">3팀</p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-slate-600">주간 운영 처리</p>
                      <p className="text-[11px] font-bold text-blue-600">진행중</p>
                    </div>
                    <div className="flex h-16 items-end gap-1.5">
                      <span className="w-3 rounded-t bg-blue-200" style={{ height: "42%" }} />
                      <span className="w-3 rounded-t bg-blue-300" style={{ height: "55%" }} />
                      <span className="w-3 rounded-t bg-blue-300" style={{ height: "50%" }} />
                      <span className="w-3 rounded-t bg-blue-400" style={{ height: "70%" }} />
                      <span className="w-3 rounded-t bg-blue-400" style={{ height: "68%" }} />
                      <span className="w-3 rounded-t bg-blue-500" style={{ height: "84%" }} />
                      <span className="w-3 rounded-t bg-blue-500" style={{ height: "80%" }} />
                    </div>
                  </div>

                  <div className="mt-3 rounded-[12px] border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-slate-600">팀 확정 상태</p>
                      <p className="text-[11px] font-bold text-blue-600">3/4 완료</p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full w-[75%] rounded-full bg-blue-500" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`px-6 py-32 ${styles.snapSection}`}>
        <div className="glass-card-primary relative mx-auto max-w-5xl overflow-hidden rounded-3xl p-12 text-center text-on-primary lg:p-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent opacity-20" />
          <div className="relative z-10 space-y-10">
            <h2 className="font-headline text-4xl font-extrabold leading-tight lg:text-6xl">
              지금 바로 SPO로
              <br />
              학원 스터디 운영을 시작하세요
            </h2>
            <p className="text-xl font-medium text-primary-fixed-dim">
              공고 작성, 신청 관리, 매칭 확정, 공지, 출석, 리워드까지 하나의 서비스에서
              이어서 운영할 수 있습니다.
            </p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                className="rounded-full bg-white px-12 py-5 text-xl font-extrabold text-primary shadow-2xl transition-transform hover:scale-105 active:scale-95"
                href="/sign-up"
              >
                지금 시작하기
              </Link>
              <Link
                className="rounded-full border border-white/30 bg-white/10 px-12 py-5 text-xl font-extrabold text-white backdrop-blur-md transition-all hover:bg-white/20 active:scale-95"
                href="/benefits"
              >
                핵심 기능 보기
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
