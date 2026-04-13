'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice } from '@/lib/ui/swal';

type StudyRecruitment = {
  id: number;
  title: string;
  status: 'open' | 'matching' | 'completed' | 'closed';
  teamSize: number;
};

type TeamMember = {
  userId: number;
  name: string;
  loginId: string;
  role: 'leader' | 'member';
};

type MyTeam = {
  teamId: number;
  teamNumber: number;
  studyGroupId: number;
  firstMeetingAt: string | null;
  firstMeetingLabel: string | null;
  studyRoomPath: string;
  members: TeamMember[];
};

type ResultResponse = {
  recruitment?: StudyRecruitment;
  totalApplicants?: number;
  assignmentCompleted?: boolean;
  assignedApplicants?: number;
  waitlistedApplicants?: number;
  assignedTeamsCount?: number;
  teamSize?: number;
  myStatus?: 'not_applied' | 'skipped' | 'pending' | 'assigned' | 'waitlisted' | 'unassigned';
  myTeam?: MyTeam | null;
  waitlist?: {
    order: number;
  } | null;
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const statusLabel: Record<NonNullable<ResultResponse['myStatus']>, string> = {
  not_applied: '미신청',
  skipped: '이번 모집은 참여 안 함',
  pending: '배정 대기 중',
  assigned: '팀 배정 완료',
  waitlisted: '대기자',
  unassigned: '미배정',
};

export default function StudyRecruitmentResultPage() {
  const params = useParams<{ recruitmentId: string }>();
  const router = useRouter();
  const recruitmentId = Number(params.recruitmentId);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<ResultResponse | null>(null);

  const loadResult = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitmentId}/my-result`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      const data = (await response.json().catch(() => ({}))) as ResultResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok || !data.recruitment) {
        await fireSpoNotice({
          icon: 'error',
          title: '결과 조회 실패',
          text: data.message || '매칭 결과를 불러오지 못했습니다.',
        });
        router.replace('/study-room');
        return;
      }

      setResult(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!Number.isInteger(recruitmentId) || recruitmentId <= 0) {
        await fireSpoNotice({
          icon: 'error',
          title: '잘못된 접근',
          text: '유효한 모집 결과 페이지가 아닙니다.',
        });
        router.replace('/study-room');
        return;
      }

      await loadResult();

      if (cancelled) return;
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [recruitmentId, router]);

  useEffect(() => {
    if (loading || !result || result.assignmentCompleted) return;

    const intervalId = window.setInterval(() => {
      void loadResult();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading, result]);

  const teamSummaryText = useMemo(() => {
    if (!result?.assignmentCompleted) return '아직 배정이 완료되지 않았습니다.';

    const teamSize = Number(result.teamSize || 0);
    const teamCount = Number(result.assignedTeamsCount || 0);
    const waitlisted = Number(result.waitlistedApplicants || 0);

    if (teamCount <= 0) {
      return `신청자 ${result.totalApplicants || 0}명 중 현재 배정된 팀이 없습니다.`;
    }

    if (waitlisted > 0) {
      return `${teamSize}명씩 ${teamCount}팀 + ${waitlisted}명 대기`;
    }

    return `${teamSize}명씩 ${teamCount}팀 편성 완료`;
  }, [result]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">매칭 결과를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (!result || !result.recruitment) {
    return (
      <div className="flex min-h-screen bg-[#f4f6fb]">
        <AppSidebar activeItem="study-room" />
        <main className="flex flex-1 items-center justify-center px-6 py-8">
          <p className="text-sm font-semibold text-slate-600">결과 정보를 확인할 수 없습니다.</p>
        </main>
      </div>
    );
  }

  const myStatus = result.myStatus || 'not_applied';
  const firstMeetingDisplay = result.myTeam?.firstMeetingLabel || formatDateTime(result.myTeam?.firstMeetingAt) || '-';

  return (
    <div className="flex min-h-screen bg-[#f4f6fb]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <header>
            <Link href={`/study-room/recruitments/${result.recruitment.id}`} className="text-sm font-bold text-[#0052FF] hover:underline">
              ← 모집 페이지로
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">매칭 결과</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">신청이 완료되면 여기에서 팀 배정 결과를 확인할 수 있습니다.</p>
          </header>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">총 신청 인원</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{Number(result.totalApplicants || 0)}명</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">배정 상태</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{result.assignmentCompleted ? '배정 완료' : '배정 대기'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">팀 편성 요약</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">{teamSummaryText}</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600">내 상태: {statusLabel[myStatus]}</p>
              <button
                type="button"
                onClick={() => {
                  void loadResult(true);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
              >
                {refreshing ? '새로고침 중...' : '새로고침'}
              </button>
            </div>
          </section>

          {result.myTeam ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black text-slate-900">내 배정 팀</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">배정 팀</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{result.myTeam.teamNumber}팀</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">첫 모임 시간</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{firstMeetingDisplay}</p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">팀원 목록</p>
                <ul className="mt-2 space-y-2">
                  {result.myTeam.members.map((member) => (
                    <li key={member.userId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {member.name} ({member.loginId})
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                        {member.role === 'leader' ? '리더' : '멤버'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 flex justify-end">
                <Link
                  href={result.myTeam.studyRoomPath}
                  className="rounded-xl bg-[#0052FF] px-5 py-2 text-sm font-extrabold text-white transition hover:bg-[#003ec0]"
                >
                  스터디룸 입장
                </Link>
              </div>
            </section>
          ) : null}

          {!result.myTeam && result.waitlist ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-lg font-black text-amber-900">대기 명단 안내</h2>
              <p className="mt-1 text-sm font-semibold text-amber-800">현재 대기 순번은 {result.waitlist.order}번입니다.</p>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
