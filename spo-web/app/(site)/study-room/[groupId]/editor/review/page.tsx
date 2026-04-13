'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
};

type StudySession = {
  id: number;
  studyGroupId: number;
  topicTitle: string;
  topicDescription?: string | null;
  scheduledStartAt?: string | null;
  studyDurationMinutes?: number;
  studyStartedAt?: string | null;
  aiReviewedAt?: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
};

type StudyRoomContextResponse = {
  studies?: StudyGroup[];
};

type StudySessionsResponse = {
  sessions?: StudySession[];
};

type SessionMutationResponse = {
  session?: StudySession;
  message?: string;
};

type AiIssueFeedback = {
  quote: string;
  feedback: string;
  severity: 'low' | 'medium' | 'high';
};

type AiReviewResult = {
  score: number;
  sourceCoverageScore: number;
  factAccuracyScore: number;
  discussionDepthScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  issueFeedbacks: AiIssueFeedback[];
  answerLength: number;
  generatedBy?: string;
  warning?: string | null;
};

type StoredDiscussionPayload = {
  schema?: string;
  reviewTimerMinutes?: number;
  reviewTimerStartedAt?: string | null;
  reviewTimerEndedAt?: string | null;
  reviewTimerCompleted?: boolean;
  reviewTimerPaused?: boolean;
  reviewTimerRemainingSeconds?: number;
  uploadedMaterialId?: number | null;
  uploadedPdfName?: string;
  ocrExtractedText?: string;
  aiTopicSuggestions?: string[];
  selectedTopicDraft?: string;
  confirmedTopic?: string;
  pageTitleDraft?: string;
  answerDraft?: string;
  aiReview?: AiReviewResult | null;
  studyDurationMinutes?: number;
  aiReviewedAt?: string | null;
};

type EditorDraftCachePayload = {
  schema?: string;
  groupId?: number;
  dateKey?: string;
  uploadedMaterialId?: number | null;
  confirmedTopic?: string;
  pageTitleDraft?: string;
  answerDraft?: string;
};

type TimerCachePayload = {
  schema?: string;
  groupId?: number;
  dateKey?: string;
  reviewTimerMinutes?: number;
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
  timerCompleted?: boolean;
  timerPaused?: boolean;
  timerRemainingSeconds?: number;
};

type MaterialAnalyzeResponse = {
  message?: string;
  review?: AiReviewResult;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const MIN_REVIEW_MINUTES = 0;
const MAX_REVIEW_MINUTES = 240;
const TOPIC_BUNDLE_SEPARATOR = '||';
const EDITOR_DRAFT_CACHE_SCHEMA = 'spo-editor-draft-v1';
const buildEditorDraftCacheKey = (groupId: number, dateKey: string) => `spo-editor-draft:${groupId}:${dateKey}`;
const TIMER_CACHE_SCHEMA = 'spo-review-timer-cache-v2';
const buildTimerCacheKey = (groupId: number, dateKey: string) => `spo-review-timer:${groupId}:${dateKey}`;

const normalizeDate = (value: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const scheduleAtKst = (dateKey: string) => `${dateKey}T20:00:00+09:00`;

const clampReviewMinutes = (value: number) => {
  const parsed = Number.isFinite(value) ? Math.floor(value) : MIN_REVIEW_MINUTES;
  return Math.max(MIN_REVIEW_MINUTES, Math.min(MAX_REVIEW_MINUTES, parsed));
};

const computeActiveStudyDurationMinutes = ({
  reviewTimerMinutes,
  timerRemainingSeconds,
  timerCompleted,
}: {
  reviewTimerMinutes: number;
  timerRemainingSeconds: number;
  timerCompleted: boolean;
}) => {
  const totalSeconds = clampReviewMinutes(reviewTimerMinutes) * 60;
  const normalizedRemainingSeconds = timerCompleted
    ? 0
    : Math.max(0, Math.min(totalSeconds, Math.floor(Number(timerRemainingSeconds || 0))));
  const elapsedSeconds = Math.max(0, totalSeconds - normalizedRemainingSeconds);
  return Math.max(0, Math.floor(elapsedSeconds / 60));
};

const parseValidDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const readTimerCache = (groupId: number, dateKey: string): TimerCachePayload | null => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(groupId) || !dateKey) return null;

  try {
    const raw = window.localStorage.getItem(buildTimerCacheKey(groupId, dateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimerCachePayload;
    if (parsed.schema !== TIMER_CACHE_SCHEMA) return null;
    if (Number(parsed.groupId) !== groupId) return null;
    if (String(parsed.dateKey || '') !== dateKey) return null;

    const parsedReviewTimerMinutes = Number(parsed.reviewTimerMinutes ?? MIN_REVIEW_MINUTES);
    const reviewTimerMinutes = clampReviewMinutes(
      Number.isFinite(parsedReviewTimerMinutes) ? parsedReviewTimerMinutes : MIN_REVIEW_MINUTES,
    );
    const totalSeconds = reviewTimerMinutes * 60;
    const normalizedRemainingSeconds = Math.max(
      0,
      Math.min(
        totalSeconds,
        Number.isFinite(Number(parsed.timerRemainingSeconds)) ? Math.floor(Number(parsed.timerRemainingSeconds)) : 0,
      ),
    );

    return {
      ...parsed,
      reviewTimerMinutes,
      timerStartedAt: typeof parsed.timerStartedAt === 'string' ? parsed.timerStartedAt : null,
      timerEndedAt: typeof parsed.timerEndedAt === 'string' ? parsed.timerEndedAt : null,
      timerCompleted: Boolean(parsed.timerCompleted),
      timerPaused: Boolean(parsed.timerPaused),
      timerRemainingSeconds: normalizedRemainingSeconds,
    };
  } catch {
    return null;
  }
};

const parseTopicBundle = (value: string, max = 10) => {
  if (!value.trim()) return [];
  const values = value
    .split(TOPIC_BUNDLE_SEPARATOR)
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const deduped: string[] = [];
  values.forEach((item) => {
    if (!deduped.includes(item)) deduped.push(item);
  });
  return deduped.slice(0, max);
};

const pickNonEmptyString = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const chooseTopicBundle = (sessionValue: unknown, draftValue: unknown) => {
  const sessionBundle = parseTopicBundle(String(sessionValue || ''));
  const draftBundle = parseTopicBundle(String(draftValue || ''));
  if (draftBundle.length > sessionBundle.length) {
    return draftBundle.join(TOPIC_BUNDLE_SEPARATOR);
  }
  if (sessionBundle.length > 0) {
    return sessionBundle.join(TOPIC_BUNDLE_SEPARATOR);
  }
  return draftBundle.join(TOPIC_BUNDLE_SEPARATOR);
};

const chooseAnswerDraft = (sessionValue: unknown, draftValue: unknown) => {
  const sessionDraft = String(sessionValue || '');
  const draftDraft = String(draftValue || '');
  const sessionTextLength = extractTextFromEditorHtml(sessionDraft).length;
  const draftTextLength = extractTextFromEditorHtml(draftDraft).length;
  if (draftTextLength > sessionTextLength) return draftDraft;
  return sessionDraft || draftDraft;
};

const extractTextFromEditorHtml = (value: string) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const readEditorDraftCache = (groupId: number, dateKey: string): EditorDraftCachePayload | null => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(groupId) || !dateKey) return null;

  try {
    const raw = window.localStorage.getItem(buildEditorDraftCacheKey(groupId, dateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorDraftCachePayload>;
    if (String(parsed.schema || '') !== EDITOR_DRAFT_CACHE_SCHEMA) return null;
    if (Number(parsed.groupId) !== groupId) return null;
    if (String(parsed.dateKey || '') !== dateKey) return null;
    return parsed;
  } catch {
    return null;
  }
};

const normalizeReviewResult = (value: unknown): AiReviewResult | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AiReviewResult>;
  const toScore = (input: unknown, fallback = 0) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(fallback)));
    return Math.max(0, Math.min(100, Math.round(parsed)));
  };
  const strengths = Array.isArray(raw.strengths) ? raw.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3) : [];
  const improvements = Array.isArray(raw.improvements)
    ? raw.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const issueFeedbacks = Array.isArray(raw.issueFeedbacks)
    ? raw.issueFeedbacks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const quote = String((item as Partial<AiIssueFeedback>).quote || '').trim();
          const feedback = String((item as Partial<AiIssueFeedback>).feedback || '').trim();
          const severityRaw = String((item as Partial<AiIssueFeedback>).severity || '').trim().toLowerCase();
          const severity = severityRaw === 'high' || severityRaw === 'low' ? severityRaw : 'medium';
          if (!quote || !feedback) return null;
          return { quote, feedback, severity } as AiIssueFeedback;
        })
        .filter((item): item is AiIssueFeedback => Boolean(item))
        .slice(0, 6)
    : [];

  return {
    score: toScore(raw.score),
    sourceCoverageScore: toScore(raw.sourceCoverageScore, raw.score as number),
    factAccuracyScore: toScore(raw.factAccuracyScore, raw.score as number),
    discussionDepthScore: toScore(raw.discussionDepthScore, raw.score as number),
    summary: String(raw.summary || '').trim(),
    strengths: strengths.length > 0 ? strengths : ['핵심 주제 중심으로 작성한 점이 좋습니다.'],
    improvements: improvements.length > 0 ? improvements : ['근거 문장을 더 구체적으로 연결해보세요.'],
    issueFeedbacks,
    answerLength: Math.max(0, Math.floor(Number(raw.answerLength || 0))),
    generatedBy: typeof raw.generatedBy === 'string' ? raw.generatedBy : undefined,
    warning: typeof raw.warning === 'string' ? raw.warning : null,
  };
};

export default function StudyEditorReviewPage() {
  const params = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupId = Number(params.groupId);
  const selectedDate = normalizeDate(searchParams.get('date')) || normalizeDate(new Date().toISOString());

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [reviewResult, setReviewResult] = useState<AiReviewResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [studyGroupName, setStudyGroupName] = useState('');
  const [topicTitle, setTopicTitle] = useState('');
  const progressTimerRef = useRef<number | null>(null);

  const progressLabel = useMemo(() => {
    if (progress < 35) return '학습자료 기반 비교 분석 중';
    if (progress < 70) return '팩트 기반 검증 중';
    if (progress < 100) return '토론 품질 평가 및 결과 정리 중';
    return '검사 완료';
  }, [progress]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const [contextResponse, sessionsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app/study-room/context`, { method: 'GET', credentials: 'include', cache: 'no-store' }),
          fetch(`${API_BASE_URL}/app/study-sessions`, { method: 'GET', credentials: 'include', cache: 'no-store' }),
        ]);
        const contextData = (await contextResponse.json().catch(() => ({}))) as StudyRoomContextResponse;
        const sessionsData = (await sessionsResponse.json().catch(() => ({}))) as StudySessionsResponse;

        if (contextResponse.status === 401 || sessionsResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }
        if (!contextResponse.ok || !sessionsResponse.ok) {
          throw new Error('스터디 정보를 불러오지 못했습니다.');
        }

        const foundGroup = (contextData.studies || []).find((study) => study.id === groupId) || null;
        const matchedSession =
          (sessionsData.sessions || []).find(
            (session) =>
              Number(session.studyGroupId) === groupId &&
              normalizeDate(session.scheduledStartAt || null) === selectedDate,
          ) || null;

        if (!foundGroup || !matchedSession) {
          throw new Error('검사할 스터디 세션을 찾지 못했습니다.');
        }

        setStudyGroupName(foundGroup.name || '');
        setTopicTitle(matchedSession.topicTitle || '');

        const payloadFromSession = (() => {
          try {
            const parsed = JSON.parse(String(matchedSession.topicDescription || '{}'));
            return parsed && typeof parsed === 'object' ? (parsed as StoredDiscussionPayload) : null;
          } catch {
            return null;
          }
        })();
        const payloadFromDraft = readEditorDraftCache(groupId, selectedDate);
        if (!payloadFromSession && !payloadFromDraft) {
          throw new Error('검사할 스터디 데이터가 없습니다.');
        }

        const payload: StoredDiscussionPayload = {
          ...(payloadFromSession || {}),
          uploadedMaterialId: Number(payloadFromSession?.uploadedMaterialId || 0)
            ? payloadFromSession?.uploadedMaterialId
            : payloadFromDraft?.uploadedMaterialId || null,
          confirmedTopic: chooseTopicBundle(payloadFromSession?.confirmedTopic, payloadFromDraft?.confirmedTopic),
          pageTitleDraft: pickNonEmptyString(payloadFromDraft?.pageTitleDraft, payloadFromSession?.pageTitleDraft),
          answerDraft: chooseAnswerDraft(payloadFromSession?.answerDraft, payloadFromDraft?.answerDraft),
        };

        const cachedTimer = readTimerCache(groupId, selectedDate);
        if (cachedTimer) {
          payload.reviewTimerMinutes = cachedTimer.reviewTimerMinutes;
          payload.reviewTimerStartedAt = cachedTimer.timerStartedAt;
          payload.reviewTimerEndedAt = cachedTimer.timerEndedAt;
          payload.reviewTimerCompleted = cachedTimer.timerCompleted;
          payload.reviewTimerPaused = cachedTimer.timerPaused;
          payload.reviewTimerRemainingSeconds = cachedTimer.timerRemainingSeconds;
        }

        const uploadedMaterialId = Number(payload.uploadedMaterialId || 0);
        const confirmedTopics = parseTopicBundle(String(payload.confirmedTopic || ''));
        const answerText = extractTextFromEditorHtml(String(payload.answerDraft || ''));
        if (!uploadedMaterialId) throw new Error('업로드된 학습자료가 없어 AI 검사를 진행할 수 없습니다.');
        if (confirmedTopics.length < 5) throw new Error('확정된 토론 주제가 최소 5개 필요합니다.');
        if (!answerText) throw new Error('작성된 답변이 없어 AI 검사를 진행할 수 없습니다.');

        setRunning(true);
        setProgress(6);
        progressTimerRef.current = window.setInterval(() => {
          setProgress((prev) => {
            if (prev >= 92) return prev;
            return Math.min(92, prev + (prev < 50 ? 3 : 2));
          });
        }, 220);

        const analyzeResponse = await fetch(`${API_BASE_URL}/app/materials/${uploadedMaterialId}/analyze`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisType: 'review',
            answerText,
            confirmedTopics,
            notificationLink: `/study-room/${groupId}/editor?date=${selectedDate}`,
          }),
        });
        const analyzeData = (await analyzeResponse.json().catch(() => ({}))) as MaterialAnalyzeResponse;

        if (analyzeResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }
        if (!analyzeResponse.ok || !analyzeData.review) {
          throw new Error(analyzeData.message || 'AI 검사 결과를 받지 못했습니다.');
        }

        const normalizedReview = normalizeReviewResult(analyzeData.review);
        if (!normalizedReview) {
          throw new Error('AI 검사 결과 형식이 올바르지 않습니다.');
        }

        const nextStudyDurationMinutes = computeActiveStudyDurationMinutes({
          reviewTimerMinutes: Number(payload.reviewTimerMinutes ?? MIN_REVIEW_MINUTES),
          timerRemainingSeconds: Number(payload.reviewTimerRemainingSeconds || 0),
          timerCompleted: Boolean(payload.reviewTimerCompleted),
        });
        const startedAtCandidate =
          String(payload.reviewTimerStartedAt || '').trim() || String(matchedSession.studyStartedAt || '').trim();
        const startedAtDate = parseValidDate(startedAtCandidate);
        const nowDate = new Date();
        const minimumReviewedAtDate =
          startedAtDate && Number.isFinite(startedAtDate.getTime())
            ? new Date(startedAtDate.getTime() + Math.max(0, nextStudyDurationMinutes) * 60 * 1000)
            : null;
        const reviewedAtDate =
          minimumReviewedAtDate && nowDate.getTime() < minimumReviewedAtDate.getTime()
            ? minimumReviewedAtDate
            : nowDate;
        const reviewedAt = reviewedAtDate.toISOString();
        const nextPayload: StoredDiscussionPayload = {
          ...payload,
          schema: 'spo-ocr-discussion-v2',
          aiReview: normalizedReview,
          aiReviewedAt: reviewedAt,
          studyDurationMinutes: nextStudyDurationMinutes,
        };

        const updateResponse = await fetch(`${API_BASE_URL}/app/study-sessions/${matchedSession.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicTitle:
              String(payload.pageTitleDraft || '').trim() ||
              String(matchedSession.topicTitle || '').trim() ||
              `${selectedDate} 스터디`,
            topicDescription: JSON.stringify(nextPayload),
            scheduledStartAt: matchedSession.scheduledStartAt || scheduleAtKst(selectedDate),
            status: matchedSession.status || 'scheduled',
            studyDurationMinutes: nextStudyDurationMinutes,
            studyStartedAt: startedAtDate ? startedAtDate.toISOString() : payload.reviewTimerStartedAt || matchedSession.studyStartedAt || null,
            aiReviewedAt: reviewedAt,
          }),
        });
        const updateData = (await updateResponse.json().catch(() => ({}))) as SessionMutationResponse;
        if (!updateResponse.ok || !updateData.session) {
          throw new Error(updateData.message || 'AI 검사 결과 저장에 실패했습니다.');
        }

        if (cancelled) return;
        setProgress(100);
        setReviewResult(normalizedReview);
        setSaved(true);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'AI 검사 중 오류가 발생했습니다.');
      } finally {
        if (progressTimerRef.current) {
          window.clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        if (!cancelled) {
          setRunning(false);
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [groupId, selectedDate]);

  if (loading || running) {
    return (
      <div className="flex h-screen overflow-hidden bg-[#f7f7f5] text-[#191c1d]">
        <AppSidebar activeItem="study-room" />
        <main className="flex min-w-0 flex-1 items-center justify-center p-6">
          <article className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">AI REVIEW</p>
            <h1 className="mt-2 text-2xl font-black text-slate-900">AI 검사 진행 중</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">{progressLabel}</p>
            <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#1f6fff] transition-all duration-300" style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{studyGroupName || '스터디룸'}</span>
              <span>{Math.max(progress, 2)}%</span>
            </div>
          </article>
        </main>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex h-screen overflow-hidden bg-[#f7f7f5] text-[#191c1d]">
        <AppSidebar activeItem="study-room" />
        <main className="flex min-w-0 flex-1 items-center justify-center p-6">
          <article className="w-full max-w-2xl rounded-2xl border border-rose-200 bg-white p-7 shadow-sm">
            <h1 className="text-2xl font-black text-slate-900">AI 검사 실패</h1>
            <p className="mt-2 text-sm font-semibold text-rose-700">{errorMessage}</p>
            <button
              type="button"
              onClick={() => router.replace(`/study-room/${groupId}/editor?date=${selectedDate}`)}
              className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
            >
              에디터로 돌아가기
            </button>
          </article>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f7f5] text-[#191c1d]">
      <AppSidebar activeItem="study-room" />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <article className="rounded-2xl border border-[#e6e8eb] bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">AI REVIEW RESULT</p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">{topicTitle || `${selectedDate} 스터디`}</h1>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-[#e6e8eb] bg-[#fafafa] p-3 sm:col-span-1">
                <p className="text-xs font-bold text-slate-500">종합 점수</p>
                <p className="mt-1 text-3xl font-black text-slate-900">{reviewResult?.score ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-[#e6e8eb] bg-[#fafafa] p-3 text-sm font-semibold text-slate-700">
                자료 반영 {reviewResult?.sourceCoverageScore ?? 0}점
              </div>
              <div className="rounded-2xl border border-[#e6e8eb] bg-[#fafafa] p-3 text-sm font-semibold text-slate-700">
                팩트 정확도 {reviewResult?.factAccuracyScore ?? 0}점
              </div>
              <div className="rounded-2xl border border-[#e6e8eb] bg-[#fafafa] p-3 text-sm font-semibold text-slate-700">
                토론 깊이 {reviewResult?.discussionDepthScore ?? 0}점
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-600">{reviewResult?.summary || ''}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">답변 길이: {reviewResult?.answerLength || 0}자</p>
          </article>

          <article className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
            <div>
              <h2 className="text-sm font-black text-emerald-700">칭찬할 점</h2>
              <ul className="mt-2 space-y-2">
                {(reviewResult?.strengths || []).slice(0, 3).map((item, index) => (
                  <li key={`strength-${index}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-black text-amber-700">개선할 점</h2>
              <ul className="mt-2 space-y-2">
                {(reviewResult?.improvements || []).slice(0, 3).map((item, index) => (
                  <li key={`improvement-${index}`} className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </article>

          {(reviewResult?.issueFeedbacks || []).length > 0 ? (
            <article className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-black text-rose-700">수정이 필요한 내용</h2>
              <div className="mt-2 space-y-2">
                {(reviewResult?.issueFeedbacks || []).map((item, index) => (
                  <div key={`issue-${index}`} className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2">
                    <p className="text-sm font-semibold text-rose-700">"{item.quote}"</p>
                    <p className="mt-1 text-sm font-semibold text-rose-800">{item.feedback}</p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => router.replace(`/study-room/${groupId}/editor?date=${selectedDate}`)}
              className="rounded-lg bg-[#1f6fff] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#175cd3]"
            >
              {saved ? '결과 반영 완료 · 에디터로 돌아가기' : '에디터로 돌아가기'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
