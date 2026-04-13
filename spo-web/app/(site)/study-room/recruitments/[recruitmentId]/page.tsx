'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice, fireSpoSwal } from '@/lib/ui/swal';

type RecruitmentCustomCheck = {
  id: string;
  title: string;
  inputType: 'button' | 'radio';
  options: string[];
  enabled?: boolean;
};

type RecruitmentApplicationCheckConfig = {
  participationTitle: string;
  participationOptions: Array<{ key: 'join' | 'skip'; label: string }>;
  enableMbti?: boolean;
  mbtiTitle?: string;
  enablePreferredStyle?: boolean;
  styleTitle: string;
  styleOptions: string[];
  enablePersonality?: boolean;
  presentationTitle: string;
  presentationOptions: Array<{ key: 'passive' | 'normal' | 'presenter'; label: string }>;
  customChecks?: RecruitmentCustomCheck[];
};

type StudyRecruitment = {
  id: number;
  academyId: number | null;
  academyName: string | null;
  academyAddress: string | null;
  title: string;
  targetClass: string | null;
  reviewScope: string | null;
  aiTopicExamples: string[];
  recruitmentStartAt: string;
  recruitmentEndAt: string;
  minApplicants: number | null;
  maxApplicants: number | null;
  teamSize: number;
  matchingGuide: string | null;
  applicationCheckConfig?: RecruitmentApplicationCheckConfig | null;
  status: 'open' | 'matching' | 'completed' | 'closed';
};

type StudyRecruitmentApplication = {
  id: number;
  participationIntent: 'join' | 'skip';
  availableTimeSlots: string[];
  preferredStyle: string | null;
  mbtiType?: string | null;
  presentationLevel: 'passive' | 'normal' | 'presenter';
  customResponses?: Record<string, string> | null;
  updatedAt: string;
};

type RecruitmentDetailResponse = {
  recruitment?: StudyRecruitment;
  totalApplicants?: number;
  myApplication?: StudyRecruitmentApplication | null;
  permission?: {
    canRunMatching?: boolean;
  };
  message?: string;
};

type ApplicationResponse = {
  application?: StudyRecruitmentApplication;
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';

const DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG: RecruitmentApplicationCheckConfig = {
  participationTitle: '스터디 참여 의사',
  participationOptions: [
    { key: 'join', label: '참여할래요' },
    { key: 'skip', label: '이번엔 어려워요' },
  ],
  enableMbti: false,
  mbtiTitle: 'MBTI',
  enablePreferredStyle: false,
  styleTitle: '같이 하고 싶은 스타일',
  styleOptions: [
    '조용히 집중해서 함께 공부',
    '개념을 차근차근 정리하며 공부',
    '질문을 많이 주고받는 토론형',
    '문제 풀이를 함께 점검하는 피드백형',
  ],
  enablePersonality: false,
  presentationTitle: '성격',
  presentationOptions: [
    { key: 'passive', label: '소극적' },
    { key: 'normal', label: '보통' },
    { key: 'presenter', label: '활발' },
  ],
  customChecks: [],
};

const formatDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const statusLabel: Record<StudyRecruitment['status'], string> = {
  open: '모집중',
  matching: '매칭중',
  completed: '매칭완료',
  closed: '종료',
};

export default function StudyRecruitmentPage() {
  const params = useParams<{ recruitmentId: string }>();
  const router = useRouter();
  const recruitmentId = Number(params.recruitmentId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningMatching, setRunningMatching] = useState(false);
  const [recruitment, setRecruitment] = useState<StudyRecruitment | null>(null);
  const [totalApplicants, setTotalApplicants] = useState(0);
  const [participationIntent, setParticipationIntent] = useState<'join' | 'skip'>('join');
  const [mbtiType, setMbtiType] = useState('');
  const [preferredStyle, setPreferredStyle] = useState('');
  const [presentationLevel, setPresentationLevel] = useState<StudyRecruitmentApplication['presentationLevel']>('normal');
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [savedParticipationIntent, setSavedParticipationIntent] = useState<'join' | 'skip' | null>(null);
  const [canRunMatching, setCanRunMatching] = useState(false);

  const canEditApplication = recruitment?.status === 'open';
  const applicationCheckConfig = recruitment?.applicationCheckConfig ?? DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG;
  const participationOptions =
    Array.isArray(applicationCheckConfig.participationOptions) && applicationCheckConfig.participationOptions.length > 0
      ? applicationCheckConfig.participationOptions
      : DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationOptions;
  const presentationOptions =
    Array.isArray(applicationCheckConfig.presentationOptions) && applicationCheckConfig.presentationOptions.length > 0
      ? applicationCheckConfig.presentationOptions
      : DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationOptions;
  const showMbtiCheck =
    applicationCheckConfig.enableMbti ?? DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enableMbti ?? false;
  const showPreferredStyleCheck =
    applicationCheckConfig.enablePreferredStyle ?? DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePreferredStyle ?? false;
  const showPersonalityCheck =
    applicationCheckConfig.enablePersonality ?? DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePersonality ?? false;
  const styleOptions = useMemo(() => {
    const normalized = Array.isArray(applicationCheckConfig.styleOptions)
      ? applicationCheckConfig.styleOptions.filter((option) => typeof option === 'string' && option.trim())
      : [];
    const baseOptions = normalized.length > 0 ? normalized : DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleOptions;
    if (preferredStyle && !baseOptions.includes(preferredStyle)) {
      return [...baseOptions, preferredStyle];
    }
    return baseOptions;
  }, [applicationCheckConfig.styleOptions, preferredStyle]);
  const customChecks = useMemo(() => {
    const rows = Array.isArray(applicationCheckConfig.customChecks) ? applicationCheckConfig.customChecks : [];
    return rows
      .map((check, index) => {
        if (!check || typeof check !== 'object') return null;
        const title = typeof check.title === 'string' ? check.title.trim() : '';
        if (!title) return null;
        const inputType = check.inputType === 'radio' ? 'radio' : 'button';
        const options = Array.isArray(check.options)
          ? check.options.filter((option) => typeof option === 'string' && option.trim()).map((option) => option.trim())
          : [];
        if (options.length < 2) return null;
        const rawId = typeof check.id === 'string' ? check.id.trim() : '';
        const enabled = typeof check.enabled === 'boolean' ? check.enabled : true;
        return {
          id: rawId || `custom_${index + 1}`,
          title,
          inputType,
          options,
          enabled,
        } as RecruitmentCustomCheck;
      })
      .filter((check): check is RecruitmentCustomCheck => Boolean(check));
  }, [applicationCheckConfig.customChecks]);
  const enabledCustomChecks = useMemo(
    () => customChecks.filter((check) => check.enabled !== false),
    [customChecks],
  );
  const participationLabelByKey = useMemo(
    () =>
      new Map(
        participationOptions.map((option) => [
          option.key,
          option.label,
        ]),
      ),
    [participationOptions],
  );
  const applicationStatusMeta = useMemo(() => {
    if (savedParticipationIntent === 'join') {
      return {
        label: `${participationLabelByKey.get('join') || '참여할래요'} 신청 완료`,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    }
    if (savedParticipationIntent === 'skip') {
      return {
        label: `${participationLabelByKey.get('skip') || '이번엔 어려워요'} 저장됨`,
        className: 'border-slate-200 bg-slate-100 text-slate-700',
      };
    }
    return {
      label: '아직 신청 전',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }, [participationLabelByKey, savedParticipationIntent]);

  const loadDetail = async () => {
    const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitmentId}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => ({}))) as RecruitmentDetailResponse;

    if (response.status === 401) {
      window.location.replace('/sign-in');
      return;
    }

    if (!response.ok || !data.recruitment) {
      await fireSpoNotice({
        icon: 'error',
        title: '모집 정보를 불러오지 못했습니다',
        text: data.message || '잠시 후 다시 시도해주세요.',
      });
      router.replace('/study-room');
      return;
    }

    setRecruitment(data.recruitment);
    setTotalApplicants(Number(data.totalApplicants || 0));

    const application = data.myApplication;
    setParticipationIntent(application?.participationIntent || 'join');
    setMbtiType(application?.mbtiType || '');
    setPreferredStyle(application?.preferredStyle || '');
    setPresentationLevel(application?.presentationLevel || 'normal');
    setCustomResponses(
      application?.customResponses && typeof application.customResponses === 'object' ? application.customResponses : {},
    );
    setSavedParticipationIntent(application?.participationIntent || null);
    setLastUpdatedAt(application?.updatedAt || null);
    setCanRunMatching(Boolean(data.permission?.canRunMatching));
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!Number.isInteger(recruitmentId) || recruitmentId <= 0) {
        await fireSpoNotice({
          icon: 'error',
          title: '잘못된 접근',
          text: '유효한 모집 정보를 선택해주세요.',
        });
        router.replace('/study-room');
        return;
      }

      try {
        await loadDetail();
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
  }, [recruitmentId, router]);

  const handleSaveApplication = async () => {
    if (!recruitment || !canEditApplication || saving) return;

    setSaving(true);
    try {
      const normalizedCustomResponses = enabledCustomChecks.reduce<Record<string, string>>((acc, check) => {
        const selected = customResponses[check.id];
        if (selected && check.options.includes(selected)) {
          acc[check.id] = selected;
        }
        return acc;
      }, {});
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitment.id}/my-application`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          participationIntent,
          availableTimeSlots: [],
          preferredStyle: showPreferredStyleCheck ? preferredStyle : null,
          mbtiType: showMbtiCheck ? mbtiType : null,
          presentationLevel: showPersonalityCheck ? presentationLevel : 'normal',
          customResponses: normalizedCustomResponses,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ApplicationResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok || !data.application) {
        await fireSpoNotice({
          icon: 'error',
          title: '저장 실패',
          text: data.message || '신청 정보를 저장하지 못했습니다.',
        });
        return;
      }

      setSavedParticipationIntent(data.application.participationIntent || null);
      setLastUpdatedAt(data.application.updatedAt || null);
      await fireSpoNotice({
        icon: 'success',
        title: '저장 완료',
        text: '신청 정보가 저장되었습니다.',
      });
      await loadDetail();
    } finally {
      setSaving(false);
    }
  };

  const handleRunMatching = async () => {
    if (!recruitment || runningMatching || !canRunMatching) return;

    const confirmResult = await fireSpoSwal({
      icon: 'question',
      title: '랜덤 매칭을 실행할까요?',
      text: '실행하면 신청자 기준으로 팀이 배정되고, 결과 페이지에서 확인할 수 있습니다.',
      showCancelButton: true,
      confirmButtonText: '매칭 실행',
      cancelButtonText: '취소',
      buttonsStyling: false,
      customClass: {
        confirmButton:
          '!inline-flex !min-w-[160px] !justify-center !rounded-full !bg-[#2563eb] !px-6 !py-3 !text-base !font-extrabold !text-white transition hover:!bg-[#1d4ed8]',
      },
    });

    if (!confirmResult.isConfirmed) return;

    setRunningMatching(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitment.id}/run-matching`, {
        method: 'POST',
        credentials: 'include',
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '매칭 실행 실패',
          text: data.message || '매칭을 실행하지 못했습니다.',
        });
        return;
      }

      await fireSpoNotice({
        icon: 'success',
        title: '매칭 완료',
        text: data.message || '랜덤 매칭이 완료되었습니다.',
      });
      router.push(`/study-room/recruitments/${recruitment.id}/result`);
    } finally {
      setRunningMatching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">스터디 모집 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (!recruitment) {
    return (
      <div className="flex min-h-screen bg-[#f4f6fb]">
        <AppSidebar activeItem="study-room" />
        <main className="flex flex-1 items-center justify-center px-6 py-8">
          <p className="text-sm font-semibold text-slate-600">모집 정보를 확인할 수 없습니다.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <header>
            <Link href="/study-room" className="text-sm font-bold text-[#0052FF] hover:underline">
              ← 스터디룸으로
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{recruitment.title}</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              부트캠프 데일리 복습 매칭 대기실입니다. 간단한 정보만 체크하면 신청이 완료됩니다.
            </p>
          </header>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 text-sm text-slate-600">
                <p>
                  <span className="font-bold text-slate-800">운영 학원:</span> {recruitment.academyName || '미지정'}
                  {recruitment.academyAddress ? ` (${recruitment.academyAddress})` : ''}
                </p>
                <p>
                  <span className="font-bold text-slate-800">대상 수업:</span> {recruitment.targetClass || '미정'}
                </p>
                <p>
                  <span className="font-bold text-slate-800">모집 기간:</span> {formatDate(recruitment.recruitmentStartAt)} ~{' '}
                  {formatDate(recruitment.recruitmentEndAt)}
                </p>
                <p>
                  <span className="font-bold text-slate-800">모집 인원 조건:</span>{' '}
                  {recruitment.minApplicants ? `최소 ${recruitment.minApplicants}명` : '최소 인원 없음'}
                  {recruitment.maxApplicants ? ` / 최대 ${recruitment.maxApplicants}명` : ''}
                </p>
                <p>
                  <span className="font-bold text-slate-800">팀당 인원:</span> {recruitment.teamSize}명
                </p>
              </div>
              <div className="space-y-2 text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Status</p>
                <p className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-sm font-extrabold text-blue-700">
                  {statusLabel[recruitment.status]}
                </p>
                <p className="text-xs font-semibold text-slate-500">현재 신청자 {totalApplicants}명</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-slate-900">신청 체크</h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${applicationStatusMeta.className}`}
                >
                  {applicationStatusMeta.label}
                </span>
                {lastUpdatedAt ? (
                  <p className="text-xs font-semibold text-slate-500">최근 저장: {formatDate(lastUpdatedAt)}</p>
                ) : null}
              </div>
            </div>

            {!canEditApplication ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                현재 상태({statusLabel[recruitment.status]})에서는 신청 정보 수정이 불가능합니다.
              </div>
            ) : null}

            <div className="space-y-6">
              <div>
                <p className="text-sm font-extrabold text-slate-900">
                  {applicationCheckConfig.participationTitle || DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationTitle}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {participationOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      disabled={!canEditApplication || saving}
                      onClick={() => setParticipationIntent(option.key as 'join' | 'skip')}
                      className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                        participationIntent === option.key
                          ? 'bg-[#0052FF] text-white'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {showMbtiCheck ? (
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    {applicationCheckConfig.mbtiTitle || DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.mbtiTitle}
                  </p>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-[#4f88ff] focus:ring-2 focus:ring-[#4f88ff]/25"
                    value={mbtiType}
                    onChange={(event) => setMbtiType(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                    placeholder="예: INTJ"
                    disabled={!canEditApplication || saving}
                  />
                </div>
              ) : null}

              {showPreferredStyleCheck ? (
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    {applicationCheckConfig.styleTitle || DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleTitle}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {styleOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={!canEditApplication || saving}
                        onClick={() => setPreferredStyle(option)}
                        className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                          preferredStyle === option
                            ? 'border-[#0052FF] bg-blue-50 text-[#003db8]'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {showPersonalityCheck ? (
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    {applicationCheckConfig.presentationTitle || DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationTitle}
                  </p>
                  <div className="mt-2 space-y-2">
                    {presentationOptions.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                      >
                        <input
                          type="radio"
                          name="presentationLevel"
                          value={option.key}
                          checked={presentationLevel === option.key}
                          disabled={!canEditApplication || saving}
                          onChange={() => setPresentationLevel(option.key)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {enabledCustomChecks.map((check) => (
                <div key={check.id}>
                  <p className="text-sm font-extrabold text-slate-900">{check.title}</p>
                  {check.inputType === 'button' ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {check.options.map((option) => (
                        <button
                          key={`${check.id}-${option}`}
                          type="button"
                          disabled={!canEditApplication || saving}
                          onClick={() =>
                            setCustomResponses((prev) => ({
                              ...prev,
                              [check.id]: option,
                            }))
                          }
                          className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                            customResponses[check.id] === option
                              ? 'border-[#0052FF] bg-blue-50 text-[#003db8]'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {check.options.map((option) => (
                        <label
                          key={`${check.id}-${option}`}
                          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                        >
                          <input
                            type="radio"
                            name={`custom-${check.id}`}
                            value={option}
                            checked={customResponses[check.id] === option}
                            disabled={!canEditApplication || saving}
                            onChange={() =>
                              setCustomResponses((prev) => ({
                                ...prev,
                                [check.id]: option,
                              }))
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Link
                href={`/study-room/recruitments/${recruitment.id}/result`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
              >
                매칭 결과 보기
              </Link>
              <button
                type="button"
                onClick={() => {
                  void handleSaveApplication();
                }}
                disabled={!canEditApplication || saving}
                className="rounded-xl bg-[#0052FF] px-5 py-2 text-sm font-extrabold text-white transition hover:bg-[#003ec0] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? '저장중...' : '신청 저장'}
              </button>
            </div>
          </section>

          {canRunMatching ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-900">운영자 실행 영역</h3>
                  <p className="text-sm font-medium text-slate-500">
                    신청 종료 후 랜덤 매칭을 실행하면 결과 페이지에 팀 배정이 표시됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleRunMatching();
                  }}
                  disabled={recruitment.status === 'completed' || runningMatching}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {runningMatching ? '매칭 실행중...' : recruitment.status === 'completed' ? '매칭 완료됨' : '랜덤 매칭 실행'}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
