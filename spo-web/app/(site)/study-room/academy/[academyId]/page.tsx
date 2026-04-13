'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice } from '@/lib/ui/swal';

type Academy = {
  id: number;
  name: string;
  address?: string | null;
};

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
  description?: string | null;
  memberCount?: number;
  academyId?: number | null;
  academyName?: string | null;
};

type StudyRoomContextResponse = {
  academies?: Academy[];
  studies?: StudyGroup[];
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;

export default function AcademyStudyListPage() {
  const params = useParams<{ academyId: string }>();
  const router = useRouter();
  const academyId = Number(params.academyId);

  const [loading, setLoading] = useState(true);
  const [academy, setAcademy] = useState<Academy | null>(null);
  const [studies, setStudies] = useState<StudyGroup[]>([]);

  const studyCountLabel = useMemo(() => `${studies.length}개`, [studies.length]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!isPositiveInteger(academyId)) {
        await fireSpoNotice({
          icon: 'error',
          title: '잘못된 접근',
          text: '유효한 학원을 선택해주세요.',
        });
        router.replace('/study-room');
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/app/study-room/context`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as StudyRoomContextResponse;

        if (response.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!response.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '불러오기 실패',
            text: data.message || '스터디룸 정보를 불러오지 못했습니다.',
          });
          router.replace('/study-room');
          return;
        }

        const loadedAcademies = Array.isArray(data.academies) ? data.academies : [];
        const foundAcademy = loadedAcademies.find((item) => Number(item.id) === academyId) || null;
        if (!foundAcademy) {
          await fireSpoNotice({
            icon: 'warning',
            title: '학원 없음',
            text: '선택한 학원은 등록 목록에 없습니다.',
          });
          router.replace('/study-room');
          return;
        }

        const loadedStudies = Array.isArray(data.studies) ? data.studies : [];
        const normalizedAcademyName = String(foundAcademy.name || '').trim().toLowerCase();
        const filteredStudies = loadedStudies.filter((study) => {
          const studyAcademyId = Number(study.academyId);
          if (isPositiveInteger(studyAcademyId)) {
            return studyAcademyId === academyId;
          }

          const studyAcademyName = String(study.academyName || '').trim().toLowerCase();
          if (studyAcademyName && normalizedAcademyName) {
            return studyAcademyName === normalizedAcademyName;
          }

          return false;
        });

        if (cancelled) return;
        setAcademy(foundAcademy);
        setStudies(filteredStudies);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [academyId, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">학원 스터디 리스트를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (!academy) {
    return (
      <div className="flex min-h-screen bg-[#f4f6fb]">
        <AppSidebar activeItem="study-room" />
        <main className="flex flex-1 items-center justify-center px-6 py-8">
          <p className="text-sm font-semibold text-slate-600">학원 정보를 확인하는 중입니다...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <header>
            <Link href="/study-room" className="text-sm font-bold text-[#0052FF] hover:underline">
              ← 등록 학원 리스트로
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{academy.name} 스터디 리스트</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              참여 가능한 스터디를 확인하고 스터디룸으로 이동할 수 있어요.
            </p>
          </header>

          <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-500">Selected Academy</p>
                <p className="mt-1 text-lg font-black text-slate-900">{academy.name}</p>
                <p className="mt-1 text-sm text-slate-600">{academy.address || '주소 정보 없음'}</p>
              </div>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-blue-700">
                스터디 {studyCountLabel}
              </span>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            {studies.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <p className="text-lg font-black text-slate-900">등록된 스터디가 없습니다</p>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  새로운 스터디가 열리면 이 페이지에서 바로 확인할 수 있습니다.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {studies.map((study) => (
                  <article key={study.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900">{study.name}</p>
                        <p className="mt-1 text-sm font-semibold text-[#0052FF]">{study.subject}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">
                        {study.memberCount != null ? `${study.memberCount}명` : '인원 미정'}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">
                      {study.description || '스터디 설명이 아직 등록되지 않았습니다.'}
                    </p>
                    <div className="mt-4 flex justify-end">
                      <Link
                        href={`/study-room/${study.id}`}
                        className="rounded-xl bg-[#0052FF] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#003ec0]"
                      >
                        스터디룸 입장
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
