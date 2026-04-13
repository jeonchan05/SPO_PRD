'use client';

import './page.css';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice, fireSpoSwal } from '@/lib/ui/swal';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';

type RecruitmentCustomCheck = {
  id: string;
  title: string;
};

type RecruitmentApplicationCheckConfig = {
  enableMbti?: boolean;
  enablePreferredStyle?: boolean;
  enablePersonality?: boolean;
  customChecks?: RecruitmentCustomCheck[];
};

type Recruitment = {
  id: number;
  title: string;
  status?: 'open' | 'matching' | 'completed' | 'closed';
  targetClass?: string | null;
  teamSize?: number | null;
  recruitmentStartAt?: string | null;
  recruitmentEndAt?: string | null;
  applicationCheckConfig?: RecruitmentApplicationCheckConfig | null;
};

type RecruitmentApplicant = {
  id: number;
  userId: number;
  userName: string;
  loginId?: string | null;
  preferredStyle?: string | null;
  mbtiType?: string | null;
  presentationLevel: 'passive' | 'normal' | 'presenter';
  customResponses?: Record<string, string> | null;
  updatedAt?: string;
  matchedTeamNumber?: number | null;
  matchedRole?: 'leader' | 'member' | null;
  waitlistOrder?: number | null;
};

type MatchingSummary = {
  completed: boolean;
  batchId?: number | null;
  assignedApplicants?: number;
  waitlistedApplicants?: number;
  teamSize?: number;
};

type ApplicantManagementResponse = {
  recruitment?: Recruitment;
  totalApplicants?: number;
  applicants?: RecruitmentApplicant[];
  matchingSummary?: MatchingSummary;
  message?: string;
};

type MatchingRunResponse = {
  message?: string;
  result?: {
    recruitmentId: number;
    teamSize: number;
    totalApplicants: number;
    assignedApplicants: number;
    waitlistedApplicants: number;
    teams: number;
    strategy: 'random' | 'ai' | 'manual' | 'ai_fallback' | 'ai_gemini_cli';
  };
};

type MatchingAssignmentPayload = {
  applicationId: number;
  teamNumber: number;
};

type TeamNamePayload = {
  teamNumber: number;
  teamName: string;
};

type AiMatchingPreviewResponse = {
  message?: string;
  preview?: {
    assignments?: MatchingAssignmentPayload[];
    assignedApplicants?: number;
    waitlistedApplicants?: number;
    teams?: number;
    warning?: string | null;
    generatedBy?: string | null;
  };
};

const PRESENTATION_LEVEL_LABEL: Record<RecruitmentApplicant['presentationLevel'], string> = {
  passive: '소극적',
  normal: '보통',
  presenter: '활발',
};

const RECRUITMENT_STATUS_LABEL: Record<NonNullable<Recruitment['status']>, string> = {
  open: '모집중',
  matching: '매칭중',
  completed: '매칭완료',
  closed: '종료',
};

const formatDateTimeLabel = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('ko-KR');
};

export default function RecruitmentApplicantsManagementPage() {
  const params = useParams<{ recruitmentId: string }>();
  const router = useRouter();
  const recruitmentId = Number(params.recruitmentId);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewingAiMatching, setPreviewingAiMatching] = useState(false);
  const [confirmingMatching, setConfirmingMatching] = useState(false);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [searchKeyword, setSearchKeyword] = useState('');

  const [recruitment, setRecruitment] = useState<Recruitment | null>(null);
  const [totalApplicants, setTotalApplicants] = useState(0);
  const [applicants, setApplicants] = useState<RecruitmentApplicant[]>([]);
  const [matchingSummary, setMatchingSummary] = useState<MatchingSummary | null>(null);
  const [manualAssignments, setManualAssignments] = useState<Record<number, string>>({});
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<string, string>>({});
  const [pendingPlanSource, setPendingPlanSource] = useState<'ai' | 'manual' | null>(null);

  const teamSize = Math.max(
    2,
    Number(recruitment?.teamSize || matchingSummary?.teamSize || 4),
  );

  const teamOptions = useMemo(() => {
    const maxTeamCount = Math.max(1, Math.min(20, Math.ceil(Math.max(applicants.length, 2) / 2)));
    return Array.from({ length: maxTeamCount }, (_, index) => index + 1);
  }, [applicants.length]);
  const aiPreviewTeams = useMemo(() => {
    const teamMap = new Map<number, RecruitmentApplicant[]>();
    applicants.forEach((applicant) => {
      const teamNumber = Number(manualAssignments[applicant.id]);
      if (!Number.isInteger(teamNumber) || teamNumber <= 0) return;
      const rows = teamMap.get(teamNumber) || [];
      rows.push(applicant);
      teamMap.set(teamNumber, rows);
    });

    return Array.from(teamMap.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([teamNumber, members]) => ({
        teamNumber,
        members: [...members].sort((left, right) => String(left.userName || '').localeCompare(String(right.userName || ''), 'ko')),
      }));
  }, [applicants, manualAssignments]);
  const aiPreviewWaitlistApplicants = useMemo(
    () =>
      applicants.filter((applicant) => {
        const teamNumber = Number(manualAssignments[applicant.id]);
        return !Number.isInteger(teamNumber) || teamNumber <= 0;
      }),
    [applicants, manualAssignments],
  );

  const customCheckTitleById = useMemo(() => {
    const map = new Map<string, string>();
    const checks = Array.isArray(recruitment?.applicationCheckConfig?.customChecks)
      ? recruitment?.applicationCheckConfig?.customChecks
      : [];
    checks.forEach((check) => {
      if (!check || typeof check.id !== 'string' || typeof check.title !== 'string') return;
      if (!check.id.trim() || !check.title.trim()) return;
      map.set(check.id.trim(), check.title.trim());
    });
    return map;
  }, [recruitment?.applicationCheckConfig?.customChecks]);
  const showMbtiCheck = Boolean(recruitment?.applicationCheckConfig?.enableMbti);
  const showPreferredStyleCheck = Boolean(recruitment?.applicationCheckConfig?.enablePreferredStyle);
  const showPersonalityCheck = Boolean(recruitment?.applicationCheckConfig?.enablePersonality);
  const matchingCriteriaLabel = useMemo(() => {
    const labels = [
      showMbtiCheck ? 'MBTI' : null,
      showPreferredStyleCheck ? '같이 하고 싶은 스타일' : null,
      showPersonalityCheck ? '성격' : null,
      customCheckTitleById.size > 0 ? '커스텀 신청 체크 응답' : null,
    ].filter((label): label is string => Boolean(label));

    if (labels.length === 0) return '신청 체크 응답';
    return labels.join(', ');
  }, [customCheckTitleById.size, showMbtiCheck, showPersonalityCheck, showPreferredStyleCheck]);

  const filteredApplicants = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return applicants;

    return applicants.filter((applicant) => {
      const customText = Object.entries(applicant.customResponses || {})
        .map(([key, value]) => `${customCheckTitleById.get(key) || key} ${value}`)
        .join(' ')
        .toLowerCase();
      const candidate = [
        applicant.userName,
        applicant.loginId,
        showMbtiCheck ? applicant.mbtiType : '',
        showPreferredStyleCheck ? applicant.preferredStyle : '',
        showPersonalityCheck ? PRESENTATION_LEVEL_LABEL[applicant.presentationLevel] : '',
        customText,
        applicant.matchedTeamNumber ? `${applicant.matchedTeamNumber}팀` : '',
      ]
        .join(' ')
        .toLowerCase();
      return candidate.includes(keyword);
    });
  }, [applicants, customCheckTitleById, searchKeyword, showMbtiCheck, showPersonalityCheck, showPreferredStyleCheck]);

  const manualTeamMemberCount = useMemo(() => {
    return Object.values(manualAssignments).reduce<Record<string, number>>((acc, value) => {
      const teamNumber = Number(value);
      if (!Number.isInteger(teamNumber) || teamNumber <= 0) return acc;
      const key = String(teamNumber);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [manualAssignments]);

  const overCapacityTeams = useMemo(() => {
    return Object.entries(manualTeamMemberCount)
      .filter(([, count]) => Number(count) > teamSize)
      .map(([teamNumber]) => teamNumber);
  }, [manualTeamMemberCount, teamSize]);
  const assignmentPayload = useMemo(
    () =>
      applicants
        .map((applicant) => {
          const teamNumber = Number(manualAssignments[applicant.id]);
          if (!Number.isInteger(teamNumber) || teamNumber <= 0) return null;
          return {
            applicationId: applicant.id,
            teamNumber,
          };
        })
        .filter((item): item is MatchingAssignmentPayload => Boolean(item)),
    [applicants, manualAssignments],
  );
  const assignedTeamNumbers = useMemo(
    () =>
      Array.from(new Set(assignmentPayload.map((assignment) => Number(assignment.teamNumber))))
        .filter((teamNumber) => Number.isInteger(teamNumber) && teamNumber > 0)
        .sort((left, right) => left - right),
    [assignmentPayload],
  );
  const defaultTeamNameBase = useMemo(() => {
    const normalizedTargetClass = String(recruitment?.targetClass || '').trim();
    if (normalizedTargetClass) return normalizedTargetClass;
    const normalizedTitle = String(recruitment?.title || '').trim();
    if (normalizedTitle) return normalizedTitle;
    return '스터디';
  }, [recruitment?.targetClass, recruitment?.title]);
  const teamNamePayload = useMemo<TeamNamePayload[]>(
    () =>
      assignedTeamNumbers.map((teamNumber) => {
        const key = String(teamNumber);
        const rawName = String(teamNameDrafts[key] || '').trim();
        return {
          teamNumber,
          teamName: rawName || `${defaultTeamNameBase} ${teamNumber}팀`,
        };
      }),
    [assignedTeamNumbers, defaultTeamNameBase, teamNameDrafts],
  );
  const hasAssignmentDraft = assignmentPayload.length > 0;
  const matchingLocked = recruitment?.status === 'completed' || recruitment?.status === 'closed';
  const canConfirmMatching = !matchingLocked && hasAssignmentDraft && overCapacityTeams.length === 0;

  useEffect(() => {
    setTeamNameDrafts((prev) => {
      if (assignedTeamNumbers.length === 0) return {};
      const next: Record<string, string> = {};
      assignedTeamNumbers.forEach((teamNumber) => {
        const key = String(teamNumber);
        const previous = String(prev[key] || '').trim();
        next[key] = previous || `${defaultTeamNameBase} ${teamNumber}팀`;
      });
      return next;
    });
  }, [assignedTeamNumbers, defaultTeamNameBase]);

  const loadApplicants = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitmentId}/applicants`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as ApplicantManagementResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok || !data.recruitment) {
        await fireSpoNotice({
          icon: 'error',
          title: '신청자 관리 정보를 불러오지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        router.replace('/academy-management?section=recruitment');
        return;
      }

      setRecruitment(data.recruitment);
      setTotalApplicants(Number(data.totalApplicants || 0));
      const nextApplicants = Array.isArray(data.applicants) ? data.applicants : [];
      setApplicants(nextApplicants);
      setMatchingSummary(data.matchingSummary || null);
      setManualAssignments(() => {
        const next: Record<number, string> = {};
        nextApplicants.forEach((applicant) => {
          if (applicant.matchedTeamNumber && applicant.matchedTeamNumber > 0) {
            next[applicant.id] = String(applicant.matchedTeamNumber);
          }
        });
        return next;
      });
      setTeamNameDrafts({});
      setPendingPlanSource(null);
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
          text: '유효한 스터디 공고를 선택해주세요.',
        });
        router.replace('/academy-management?section=recruitment');
        return;
      }

      await loadApplicants();
      if (cancelled) return;
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [recruitmentId, router]);

  const handlePreviewAiMatching = async () => {
    if (!recruitment || previewingAiMatching) return;

    if (applicants.length <= 0) {
      await fireSpoNotice({
        icon: 'warning',
        title: '신청자가 없습니다',
        text: '참여 신청자가 1명 이상일 때 배정안을 만들 수 있습니다.',
      });
      return;
    }

    const confirmResult = await fireSpoSwal({
      icon: 'question',
      title: 'AI 배정안을 만들까요?',
      text: '신청 체크 기준 유사도를 바탕으로 팀 배정안을 생성합니다. 팀 확정하기 전까지는 반영되지 않습니다.',
      showCancelButton: true,
      confirmButtonText: 'AI 배정안 만들기',
      cancelButtonText: '취소',
    });

    if (!confirmResult.isConfirmed) return;

    setPreviewingAiMatching(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitment.id}/preview-ai-matching`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as AiMatchingPreviewResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: 'AI 배정안 생성에 실패했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      const previewAssignments = Array.isArray(data.preview?.assignments) ? data.preview?.assignments : [];
      if (previewAssignments.length === 0) {
        await fireSpoNotice({
          icon: 'warning',
          title: '배정할 신청자가 부족합니다',
          text: '현재 조건으로는 팀 배정안을 만들 수 없습니다. 신청자 수와 팀 인원을 확인해주세요.',
        });
        return;
      }
      const nextAssignments: Record<number, string> = {};
      previewAssignments.forEach((assignment) => {
        if (!assignment?.applicationId || !assignment?.teamNumber) return;
        nextAssignments[assignment.applicationId] = String(assignment.teamNumber);
      });
      setManualAssignments(nextAssignments);
      setPendingPlanSource('ai');
      setMode('ai');
      const baseMessage =
        data.message || 'AI 배정안이 적용되었습니다. 필요하면 팀을 조정한 뒤 하단 팀 확정하기로 최종 반영하세요.';
      const warningMessage =
        typeof data.preview?.warning === 'string' && data.preview.warning.trim()
          ? `\n${data.preview.warning.trim()}`
          : '';
      await fireSpoNotice({
        icon: 'success',
        title: 'AI 배정안을 만들었어요',
        text: `${baseMessage}${warningMessage}`,
      });
    } finally {
      setPreviewingAiMatching(false);
    }
  };

  const handleConfirmMatching = async () => {
    if (!recruitment || confirmingMatching) return;
    const assignments = assignmentPayload;
    const confirmedSource = pendingPlanSource === 'ai' ? 'ai' : 'manual';

    if (assignments.length === 0) {
      await fireSpoNotice({
        icon: 'warning',
        title: '팀 배정안이 없습니다',
        text: 'AI 배정안을 만들거나 신청자를 팀에 배정한 뒤 팀 확정하기를 눌러주세요.',
      });
      return;
    }

    if (overCapacityTeams.length > 0) {
      await fireSpoNotice({
        icon: 'warning',
        title: '팀 인원 조건을 확인해주세요',
        text: `${overCapacityTeams.join(', ')}팀이 팀당 최대 인원(${teamSize}명)을 초과했습니다.`,
      });
      return;
    }

    const confirmResult = await fireSpoSwal({
      icon: 'question',
      title: '팀 배정을 확정할까요?',
      text: '확정하면 현재 배정안으로 스터디가 생성됩니다.',
      showCancelButton: true,
      confirmButtonText: '팀 확정하기',
      cancelButtonText: '취소',
    });

    if (!confirmResult.isConfirmed) return;

    setConfirmingMatching(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitment.id}/run-manual-matching`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignments,
          teamNames: teamNamePayload,
          source: confirmedSource,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as MatchingRunResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '팀 확정에 실패했어요',
          text: data.message || '입력한 팀 배정을 다시 확인해주세요.',
        });
        return;
      }

      await loadApplicants(true);
      setPendingPlanSource(null);
      await fireSpoNotice({
        icon: 'success',
        title: '팀 확정을 완료했어요',
        text:
          data.message ||
          (confirmedSource === 'ai'
            ? 'AI 배정안을 확정했고, 현재 배정안으로 스터디 생성이 완료되었습니다.'
            : '현재 배정안으로 스터디 생성이 완료되었습니다.'),
      });
    } finally {
      setConfirmingMatching(false);
    }
  };

  if (loading) {
    return (
      <div className="academy-applicant-loading-screen">
        <p>신청자 관리 페이지를 준비하는 중입니다...</p>
      </div>
    );
  }

  if (!recruitment) {
    return (
      <div className="academy-applicant-loading-screen">
        <p>스터디 공고 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="academy-applicant-page">
      <AppSidebar activeItem="academy-management" />
      <main className="academy-applicant-main">
        <div className="academy-applicant-shell">
          <header className="academy-applicant-header">
            <div>
              <Link href="/academy-management?section=recruitment" className="academy-applicant-back-link">
                ← 스터디 공고 관리로 돌아가기
              </Link>
              <h1 className="academy-applicant-title">신청자 관리</h1>
              <p className="academy-applicant-subtitle">신청 체크 기반 AI 매칭 또는 관리자 직접 매칭으로 팀을 편성하세요.</p>
            </div>
            <button
              type="button"
              className="academy-applicant-refresh-btn"
              onClick={() => {
                void loadApplicants(true);
              }}
              disabled={refreshing}
            >
              {refreshing ? '새로고침 중...' : '새로고침'}
            </button>
          </header>

          <section className="academy-applicant-summary-card">
            <div className="academy-applicant-summary-main">
              <p className="academy-applicant-summary-title">{recruitment.title}</p>
              <p className="academy-applicant-summary-meta">
                {recruitment.targetClass || '대상 수업 미지정'} · 모집기간 {formatDateTimeLabel(recruitment.recruitmentStartAt)} ~{' '}
                {formatDateTimeLabel(recruitment.recruitmentEndAt)}
              </p>
              <p className="academy-applicant-summary-meta">
                상태 {recruitment.status ? RECRUITMENT_STATUS_LABEL[recruitment.status] : '-'} · 신청자 {totalApplicants}명 · 팀당 {teamSize}명
              </p>
            </div>
            <div className="academy-applicant-summary-side">
              <p>배정 완료 {Number(matchingSummary?.assignedApplicants || 0)}명</p>
              <p>대기 {Number(matchingSummary?.waitlistedApplicants || 0)}명</p>
              <p>{matchingSummary?.completed ? '매칭 완료' : '매칭 미완료'}</p>
            </div>
          </section>

          <section className="academy-applicant-card">
            <div className="academy-applicant-mode-tabs" role="tablist" aria-label="매칭 모드">
              <button
                type="button"
                className={`academy-applicant-mode-tab ${mode === 'ai' ? 'academy-applicant-mode-tab-active' : ''}`}
                onClick={() => setMode('ai')}
              >
                AI 매칭
              </button>
              <button
                type="button"
                className={`academy-applicant-mode-tab ${mode === 'manual' ? 'academy-applicant-mode-tab-active' : ''}`}
                onClick={() => setMode('manual')}
              >
                관리자 직접 매칭
              </button>
            </div>

            {mode === 'ai' ? (
              <div className="academy-applicant-ai-panel">
                <div className="academy-applicant-ai-panel-head">
                  <p className="academy-applicant-ai-copy">
                    {matchingCriteriaLabel}을 기반으로 유사도가 높은 신청자끼리 우선 편성합니다.
                  </p>
                  {pendingPlanSource === 'ai' ? (
                    <p className="academy-applicant-draft-guide">
                      AI 배정안이 적용되었습니다. 바로 팀 확정하거나, 관리자 직접 매칭에서 세부 조정할 수 있습니다.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="academy-applicant-primary-btn"
                  onClick={() => {
                    void handlePreviewAiMatching();
                  }}
                  disabled={previewingAiMatching || applicants.length === 0 || matchingLocked}
                >
                  {previewingAiMatching ? 'AI 배정안 생성 중...' : 'AI 매칭 배정안 만들기'}
                </button>

                {pendingPlanSource === 'ai' ? (
                  <div className="academy-applicant-ai-preview">
                    <p className="academy-applicant-ai-preview-summary">
                      배정 {assignmentPayload.length}명 · 대기 {aiPreviewWaitlistApplicants.length}명 · 총 {aiPreviewTeams.length}팀
                    </p>
                    <div className="academy-applicant-ai-team-grid">
                      {aiPreviewTeams.map((team) => (
                        <article key={`ai-team-${team.teamNumber}`} className="academy-applicant-ai-team-card">
                          <p className="academy-applicant-ai-team-title">
                            {teamNamePayload.find((item) => item.teamNumber === team.teamNumber)?.teamName ||
                              `${defaultTeamNameBase} ${team.teamNumber}팀`}
                          </p>
                          <p className="academy-applicant-ai-team-meta">{team.teamNumber}팀 · {team.members.length}명</p>
                          <div className="academy-applicant-chip-row">
                            {team.members.map((member) => (
                              <span key={`ai-team-${team.teamNumber}-${member.id}`} className="academy-applicant-chip">
                                {member.userName || `신청자 #${member.userId}`}
                              </span>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                    {aiPreviewWaitlistApplicants.length > 0 ? (
                      <div className="academy-applicant-ai-waitlist">
                        <p className="academy-applicant-ai-team-title">대기 처리</p>
                        <div className="academy-applicant-chip-row">
                          {aiPreviewWaitlistApplicants.map((applicant) => (
                            <span key={`ai-wait-${applicant.id}`} className="academy-applicant-chip">
                              {applicant.userName || `신청자 #${applicant.userId}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="academy-applicant-manual-toolbar">
                  <input
                    className="academy-applicant-search-input"
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder="신청자 이름, MBTI, 스타일, 커스텀 응답 검색"
                  />
                </div>

                <p className="academy-applicant-manual-guide">팀당 최대 {teamSize}명이며, 팀 편성에서 제외한 신청자는 자동으로 대기 처리됩니다.</p>
                {pendingPlanSource === 'ai' ? (
                  <p className="academy-applicant-draft-guide">AI 배정안이 적용되었습니다. 필요하면 팀 배정을 수정한 뒤 확정하세요.</p>
                ) : null}

                <div className="academy-applicant-list">
                  {filteredApplicants.length === 0 ? (
                    <div className="academy-applicant-empty">검색 조건에 맞는 신청자가 없습니다.</div>
                  ) : (
                    filteredApplicants.map((applicant) => {
                      const customEntries = applicant.customResponses && typeof applicant.customResponses === 'object'
                        ? Object.entries(applicant.customResponses).filter(([, value]) => typeof value === 'string' && value.trim())
                        : [];
                      const statusLabel = applicant.matchedTeamNumber
                        ? `${applicant.matchedTeamNumber}팀`
                        : applicant.waitlistOrder
                          ? `대기 ${applicant.waitlistOrder}번`
                          : '미배정';

                      return (
                        <div key={applicant.id} className="academy-applicant-item">
                          <div className="academy-applicant-item-head">
                            <div>
                              <p className="academy-applicant-name">
                                {applicant.userName || `신청자 #${applicant.userId}`}
                                {applicant.loginId ? <span className="academy-applicant-login"> (@{applicant.loginId})</span> : null}
                              </p>
                              <p className="academy-applicant-updated">최근 저장: {formatDateTimeLabel(applicant.updatedAt || null)}</p>
                            </div>
                            <span className="academy-applicant-status-chip">{statusLabel}</span>
                          </div>

                          <div className="academy-applicant-chip-row">
                            {showMbtiCheck && applicant.mbtiType ? <span className="academy-applicant-chip">MBTI {applicant.mbtiType}</span> : null}
                            {showPreferredStyleCheck && applicant.preferredStyle ? <span className="academy-applicant-chip">{applicant.preferredStyle}</span> : null}
                            {showPersonalityCheck ? (
                              <span className="academy-applicant-chip">성격 {PRESENTATION_LEVEL_LABEL[applicant.presentationLevel]}</span>
                            ) : null}
                            {customEntries.map(([key, value]) => (
                              <span key={`${applicant.id}-${key}`} className="academy-applicant-chip">
                                {(customCheckTitleById.get(key) || key).slice(0, 40)}: {value}
                              </span>
                            ))}
                          </div>

                          <div className="academy-applicant-item-assign">
                            <label htmlFor={`manual-assign-${applicant.id}`}>팀 배정</label>
                            <select
                              id={`manual-assign-${applicant.id}`}
                              className="academy-applicant-team-select"
                              value={manualAssignments[applicant.id] || ''}
                              onChange={(event) => {
                                const value = event.target.value;
                                setManualAssignments((prev) => {
                                  const next = { ...prev };
                                  if (!value) {
                                    delete next[applicant.id];
                                    return next;
                                  }
                                  next[applicant.id] = value;
                                  return next;
                                });
                                setPendingPlanSource('manual');
                              }}
                              disabled={matchingLocked}
                            >
                              <option value="">대기 처리</option>
                              {teamOptions.map((teamNumber) => (
                                <option key={`${applicant.id}-team-${teamNumber}`} value={String(teamNumber)}>
                                  {teamNumber}팀
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {hasAssignmentDraft ? (
              <section className="academy-applicant-team-name-panel">
                <p className="academy-applicant-team-name-title">팀 명칭 지정</p>
                <p className="academy-applicant-team-name-guide">
                  팀 확정 전에 각 팀 이름을 설정할 수 있습니다. 기본값은 {defaultTeamNameBase} N팀 입니다.
                </p>
                <div className="academy-applicant-team-name-grid">
                  {assignedTeamNumbers.map((teamNumber) => {
                    const key = String(teamNumber);
                    return (
                      <div key={`team-name-${teamNumber}`} className="academy-applicant-team-name-field">
                        <label htmlFor={`team-name-${teamNumber}`}>{teamNumber}팀 명칭</label>
                        <input
                          id={`team-name-${teamNumber}`}
                          className="academy-applicant-team-name-input"
                          value={teamNameDrafts[key] || `${defaultTeamNameBase} ${teamNumber}팀`}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTeamNameDrafts((prev) => ({
                              ...prev,
                              [key]: value,
                            }));
                          }}
                          maxLength={80}
                          placeholder={`${defaultTeamNameBase} ${teamNumber}팀`}
                          disabled={matchingLocked}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="academy-applicant-confirm-bar">
              <p className="academy-applicant-confirm-copy">
                {matchingLocked
                  ? `현재 상태(${recruitment.status ? RECRUITMENT_STATUS_LABEL[recruitment.status] : '-'})에서는 팀 확정이 불가능합니다.`
                  : canConfirmMatching
                    ? '현재 팀 배정안을 확정하면 스터디가 생성됩니다.'
                    : 'AI 배정안을 만들거나 팀을 직접 배정한 뒤 팀 확정하기를 눌러주세요.'}
              </p>
              <button
                type="button"
                className="academy-applicant-primary-btn"
                onClick={() => {
                  void handleConfirmMatching();
                }}
                disabled={confirmingMatching || !canConfirmMatching}
              >
                {confirmingMatching ? '팀 확정 중...' : '팀 확정하기'}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
