'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice } from '@/lib/ui/swal';

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
  message?: string;
};

type StudySessionsResponse = {
  sessions?: StudySession[];
  message?: string;
};

type SessionMutationResponse = {
  session?: StudySession;
  message?: string;
};

type MaterialTopicRecommendation = {
  recommendations?: Array<{ title?: string } | string>;
};

type UploadedMaterial = {
  id: number;
  originalFileName?: string;
  status?: string;
  errorMessage?: string | null;
};

type MaterialUploadResponse = {
  message?: string;
  material?: UploadedMaterial;
  processing?: {
    status?: string;
    extractionMethod?: string;
    topicRecommendation?: MaterialTopicRecommendation | null;
  };
};

type MaterialDetailResponse = {
  message?: string;
  material?: UploadedMaterial;
  pages?: Array<{
    pageNo?: number;
    rawText?: string | null;
    ocrText?: string | null;
  }>;
  summaries?: Array<{
    chunkIndex?: number;
    summaryText?: string;
    createdAt?: string;
  }>;
  topicRecommendations?: Array<{
    id?: number;
    result?: MaterialTopicRecommendation;
    createdAt?: string;
  }>;
};

type MaterialAnalyzeResponse = {
  message?: string;
  topicRecommendation?: MaterialTopicRecommendation;
};

type MaterialStatusAck = {
  ok?: boolean;
  message?: string;
  materialId?: number;
  status?: string;
  errorMessage?: string | null;
};

type MaterialStatusEvent = {
  materialId?: number;
  userId?: number;
  status?: string;
  errorMessage?: string | null;
  progressPercent?: number | null;
  stage?: string | null;
  message?: string | null;
  processedPages?: number | null;
  totalPages?: number | null;
  updatedAt?: string;
};

type AiReviewResult = {
  score: number;
  sourceCoverageScore: number;
  factAccuracyScore: number;
  discussionDepthScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  answerLength: number;
  issueFeedbacks: Array<{
    quote: string;
    feedback: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  keywordCoverage?: number;
  generatedBy?: string;
  warning?: string | null;
};

type StoredDiscussionPayloadV1 = {
  schema: 'spo-ocr-discussion-v1';
  ocrSourceText?: string;
  aiTopicSuggestions?: string[];
  selectedTopic?: string;
  answerDraft?: string;
  aiReview?: AiReviewResult | null;
};

type StoredDiscussionPayloadV2 = {
  schema: 'spo-ocr-discussion-v2';
  reviewTimerMinutes: number;
  reviewTimerStartedAt: string | null;
  reviewTimerEndedAt: string | null;
  reviewTimerCompleted: boolean;
  reviewTimerPaused: boolean;
  reviewTimerRemainingSeconds: number;
  uploadedMaterialId: number | null;
  uploadedPdfName: string;
  ocrExtractedText: string;
  aiTopicSuggestions: string[];
  selectedTopicDraft: string;
  confirmedTopic: string;
  pageTitleDraft: string;
  answerDraft: string;
  aiReview: AiReviewResult | null;
  studyDurationMinutes: number;
  aiReviewedAt: string | null;
};

type StoredDiscussionPayload = StoredDiscussionPayloadV2;

type TimerStateSource = {
  reviewTimerMinutes: number;
  timerStartedAt: string | null;
  timerEndedAt: string | null;
  timerCompleted: boolean;
  timerPaused: boolean;
  timerRemainingSeconds: number;
};

type TimerCachePayload = TimerStateSource & {
  schema: 'spo-review-timer-cache-v2';
  groupId: number;
  dateKey: string;
  savedAt: string;
};

type MaterialProgressCachePayload = {
  schema: 'spo-material-progress-v1';
  groupId: number;
  dateKey: string;
  materialId: number;
  uploadedPdfName: string;
  status: string;
  progressPercent: number;
  message: string;
  processedPages: number | null;
  totalPages: number | null;
  savedAt: string;
};

type EditorDraftCachePayload = {
  schema: 'spo-editor-draft-v1';
  groupId: number;
  dateKey: string;
  workspaceMode: boolean;
  uploadedMaterialId: number | null;
  uploadedPdfName: string;
  aiTopicSuggestions: string[];
  selectedTopicDraft: string;
  customTopicDraft: string;
  confirmedTopic: string;
  pageTitleDraft: string;
  answerDraft: string;
  topicRefreshCount: number;
  savedAt: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || '/api/socket.io';
const MIN_REVIEW_MINUTES = 0;
const MAX_REVIEW_MINUTES = 240;
const TIMER_DIAL_SIZE = 320;
const TIMER_DIAL_STROKE = 8;
const TIMER_DIAL_RADIUS = (TIMER_DIAL_SIZE - TIMER_DIAL_STROKE) / 2;
const TIMER_DIAL_CIRCUMFERENCE = 2 * Math.PI * TIMER_DIAL_RADIUS;

const MAX_TOPIC_SUGGESTIONS = 10;
const MAX_TOPIC_POOL_SIZE = 30;
const MIN_TOPIC_SELECTION = 5;
const MAX_TOPIC_SELECTION = 10;
const MAX_TOPIC_REFRESH_COUNT = 5;
const TOPIC_BUNDLE_SEPARATOR = '||';
const MATERIAL_SOCKET_TIMEOUT_MS = 900000;
const ALLOWED_MATERIAL_EXTENSIONS = new Set(['.pdf', '.ppt', '.pptx']);
const ALLOWED_MATERIAL_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const LEGACY_DUMMY_TOPIC_MARKERS = [
  '오늘 실습 코드에서 실패한 포인트를 구조적으로 정리할 수 있는가?',
  '디버깅 시간을 줄이기 위한 데일리 체크리스트 만들기',
  '핵심 개념을 팀원에게 5분 안에 설명하는 방식 토론',
  '오늘 배운 내용으로 내일 구현 우선순위 정하기',
  '주요 용어를 실제 프로젝트 예시로 바꿔 설명할 수 있는가?',
  '오늘 오류 로그를 기준으로 재발 방지 규칙 정의하기',
  '핵심 개념 3개를 연결한 한 줄 아키텍처 문장 만들기',
  '성능/가독성/유지보수성 관점에서 개선안 비교하기',
  '팀 코드리뷰에서 바로 쓸 수 있는 체크포인트 만들기',
  '내일 실습 전에 반드시 점검할 준비 항목 정리하기',
];

const TIMER_CACHE_SCHEMA = 'spo-review-timer-cache-v2';
const buildTimerCacheKey = (groupId: number, dateKey: string) => `spo-review-timer:${groupId}:${dateKey}`;
const MATERIAL_PROGRESS_CACHE_SCHEMA = 'spo-material-progress-v1';
const buildMaterialProgressCacheKey = (groupId: number, dateKey: string) => `spo-material-progress:${groupId}:${dateKey}`;
const EDITOR_DRAFT_CACHE_SCHEMA = 'spo-editor-draft-v1';
const buildEditorDraftCacheKey = (groupId: number, dateKey: string) => `spo-editor-draft:${groupId}:${dateKey}`;
const EDITOR_DRAFT_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const readTimerCache = (groupId: number, dateKey: string): TimerCachePayload | null => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(groupId) || !dateKey) return null;

  try {
    const raw = window.localStorage.getItem(buildTimerCacheKey(groupId, dateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TimerCachePayload>;
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
      schema: TIMER_CACHE_SCHEMA,
      groupId,
      dateKey,
      reviewTimerMinutes,
      timerStartedAt: typeof parsed.timerStartedAt === 'string' ? parsed.timerStartedAt : null,
      timerEndedAt: typeof parsed.timerEndedAt === 'string' ? parsed.timerEndedAt : null,
      timerCompleted: Boolean(parsed.timerCompleted),
      timerPaused: Boolean(parsed.timerPaused),
      timerRemainingSeconds: normalizedRemainingSeconds,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const writeTimerCache = (
  groupId: number,
  dateKey: string,
  timerState: TimerStateSource,
) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;

  const payload: TimerCachePayload = {
    schema: TIMER_CACHE_SCHEMA,
    groupId,
    dateKey,
    reviewTimerMinutes: clampReviewMinutes(timerState.reviewTimerMinutes),
    timerStartedAt: timerState.timerStartedAt,
    timerEndedAt: timerState.timerEndedAt,
    timerCompleted: timerState.timerCompleted,
    timerPaused: timerState.timerPaused,
    timerRemainingSeconds: Math.max(0, Math.floor(timerState.timerRemainingSeconds)),
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(buildTimerCacheKey(groupId, dateKey), JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

const clearTimerCache = (groupId: number, dateKey: string) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;
  try {
    window.localStorage.removeItem(buildTimerCacheKey(groupId, dateKey));
  } catch {
    // ignore storage failures
  }
};

const toPositiveCacheInt = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeCacheProgressPercent = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
};

const readMaterialProgressCache = (groupId: number, dateKey: string): MaterialProgressCachePayload | null => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(groupId) || !dateKey) return null;

  try {
    const raw = window.localStorage.getItem(buildMaterialProgressCacheKey(groupId, dateKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MaterialProgressCachePayload>;
    if (parsed.schema !== MATERIAL_PROGRESS_CACHE_SCHEMA) return null;
    if (Number(parsed.groupId) !== groupId) return null;
    if (String(parsed.dateKey || '') !== dateKey) return null;

    const materialId = toPositiveCacheInt(parsed.materialId);
    if (!materialId) return null;

    const processedPagesParsed = Number(parsed.processedPages);
    const totalPagesParsed = Number(parsed.totalPages);

    return {
      schema: MATERIAL_PROGRESS_CACHE_SCHEMA,
      groupId,
      dateKey,
      materialId,
      uploadedPdfName: typeof parsed.uploadedPdfName === 'string' ? parsed.uploadedPdfName : '',
      status: typeof parsed.status === 'string' ? parsed.status : '',
      progressPercent: normalizeCacheProgressPercent(parsed.progressPercent, 0),
      message: typeof parsed.message === 'string' ? parsed.message : '',
      processedPages: Number.isFinite(processedPagesParsed) ? Math.max(0, Math.floor(processedPagesParsed)) : null,
      totalPages: Number.isFinite(totalPagesParsed) ? Math.max(1, Math.floor(totalPagesParsed)) : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const writeMaterialProgressCache = (
  groupId: number,
  dateKey: string,
  payload: {
    materialId: number;
    uploadedPdfName: string;
    status: string;
    progressPercent: number;
    message: string;
    processedPages: number | null;
    totalPages: number | null;
  },
) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;
  const materialId = toPositiveCacheInt(payload.materialId);
  if (!materialId) return;

  const next: MaterialProgressCachePayload = {
    schema: MATERIAL_PROGRESS_CACHE_SCHEMA,
    groupId,
    dateKey,
    materialId,
    uploadedPdfName: String(payload.uploadedPdfName || ''),
    status: String(payload.status || ''),
    progressPercent: normalizeCacheProgressPercent(payload.progressPercent, 0),
    message: String(payload.message || ''),
    processedPages: Number.isFinite(Number(payload.processedPages))
      ? Math.max(0, Math.floor(Number(payload.processedPages)))
      : null,
    totalPages: Number.isFinite(Number(payload.totalPages))
      ? Math.max(1, Math.floor(Number(payload.totalPages)))
      : null,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(buildMaterialProgressCacheKey(groupId, dateKey), JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
};

const clearMaterialProgressCache = (groupId: number, dateKey: string) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;
  try {
    window.localStorage.removeItem(buildMaterialProgressCacheKey(groupId, dateKey));
  } catch {
    // ignore storage failures
  }
};

const readEditorDraftCache = (groupId: number, dateKey: string): EditorDraftCachePayload | null => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(groupId) || !dateKey) return null;

  try {
    const raw = window.localStorage.getItem(buildEditorDraftCacheKey(groupId, dateKey));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<EditorDraftCachePayload>;
    if (parsed.schema !== EDITOR_DRAFT_CACHE_SCHEMA) return null;
    if (Number(parsed.groupId) !== groupId) return null;
    if (String(parsed.dateKey || '') !== dateKey) return null;

    const savedAtText = typeof parsed.savedAt === 'string' ? parsed.savedAt : '';
    const savedAtMs = new Date(savedAtText).getTime();
    if (Number.isFinite(savedAtMs) && Date.now() - savedAtMs > EDITOR_DRAFT_CACHE_MAX_AGE_MS) {
      return null;
    }

    const uploadedMaterialId = toPositiveCacheInt(parsed.uploadedMaterialId);
    const topicSuggestions = Array.isArray(parsed.aiTopicSuggestions)
      ? parsed.aiTopicSuggestions
          .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, MAX_TOPIC_POOL_SIZE)
      : [];
    const normalizeBundle = (value: unknown) =>
      String(value || '')
        .split(TOPIC_BUNDLE_SEPARATOR)
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, MAX_TOPIC_SELECTION)
        .join(TOPIC_BUNDLE_SEPARATOR);

    return {
      schema: EDITOR_DRAFT_CACHE_SCHEMA,
      groupId,
      dateKey,
      workspaceMode: Boolean(parsed.workspaceMode),
      uploadedMaterialId,
      uploadedPdfName: typeof parsed.uploadedPdfName === 'string' ? parsed.uploadedPdfName : '',
      aiTopicSuggestions: topicSuggestions,
      selectedTopicDraft: normalizeBundle(parsed.selectedTopicDraft),
      customTopicDraft: typeof parsed.customTopicDraft === 'string' ? parsed.customTopicDraft : '',
      confirmedTopic: normalizeBundle(parsed.confirmedTopic),
      pageTitleDraft: typeof parsed.pageTitleDraft === 'string' ? parsed.pageTitleDraft : '',
      answerDraft: typeof parsed.answerDraft === 'string' ? parsed.answerDraft : '',
      topicRefreshCount: Math.max(0, Math.min(MAX_TOPIC_REFRESH_COUNT, Math.floor(Number(parsed.topicRefreshCount || 0)))),
      savedAt: savedAtText || new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const writeEditorDraftCache = (
  groupId: number,
  dateKey: string,
  payload: Omit<EditorDraftCachePayload, 'schema' | 'groupId' | 'dateKey' | 'savedAt'>,
) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;

  const next: EditorDraftCachePayload = {
    schema: EDITOR_DRAFT_CACHE_SCHEMA,
    groupId,
    dateKey,
    workspaceMode: Boolean(payload.workspaceMode),
    uploadedMaterialId: toPositiveCacheInt(payload.uploadedMaterialId),
    uploadedPdfName: String(payload.uploadedPdfName || ''),
    aiTopicSuggestions: (Array.isArray(payload.aiTopicSuggestions) ? payload.aiTopicSuggestions : [])
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, MAX_TOPIC_POOL_SIZE),
    selectedTopicDraft: String(payload.selectedTopicDraft || ''),
    customTopicDraft: String(payload.customTopicDraft || ''),
    confirmedTopic: String(payload.confirmedTopic || ''),
    pageTitleDraft: String(payload.pageTitleDraft || '').slice(0, 200),
    answerDraft: String(payload.answerDraft || '').slice(0, 250000),
    topicRefreshCount: Math.max(0, Math.min(MAX_TOPIC_REFRESH_COUNT, Math.floor(Number(payload.topicRefreshCount || 0)))),
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(buildEditorDraftCacheKey(groupId, dateKey), JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
};

const clearEditorDraftCache = (groupId: number, dateKey: string) => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(groupId) || !dateKey) return;
  try {
    window.localStorage.removeItem(buildEditorDraftCacheKey(groupId, dateKey));
  } catch {
    // ignore storage failures
  }
};

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

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatClockCountdown = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

const parseIsoDate = (value: string | null | undefined) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const computeTotalStudyDurationMinutes = (startedAt: Date, endedAt: Date) =>
  Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 60000));

const normalizeTimerStateForLockedDate = (timerState: TimerStateSource): TimerStateSource => {
  const normalizedMinutes = clampReviewMinutes(Number(timerState.reviewTimerMinutes ?? MIN_REVIEW_MINUTES));
  const completed = Boolean(timerState.timerCompleted);
  return {
    reviewTimerMinutes: normalizedMinutes,
    timerStartedAt: completed ? timerState.timerStartedAt || null : null,
    timerEndedAt: null,
    timerCompleted: completed,
    timerPaused: false,
    timerRemainingSeconds: 0,
  };
};

const parseDateKeyToLocalDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const compareDateKeys = (leftDateKey: string, rightDateKey: string) => {
  const leftDate = parseDateKeyToLocalDate(leftDateKey);
  const rightDate = parseDateKeyToLocalDate(rightDateKey);
  if (!leftDate || !rightDate) return 0;
  if (leftDate.getTime() < rightDate.getTime()) return -1;
  if (leftDate.getTime() > rightDate.getTime()) return 1;
  return 0;
};

const compareDateKeyToToday = (dateKey: string) => {
  const todayDateKey = normalizeDate(new Date().toISOString());
  return compareDateKeys(dateKey, todayDateKey);
};

const isPastDateKey = (dateKey: string) => {
  return compareDateKeyToToday(dateKey) < 0;
};

const isFutureDateKey = (dateKey: string) => {
  return compareDateKeyToToday(dateKey) > 0;
};

const formatStudyDurationLabel = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const restMinutes = safeMinutes % 60;
  if (hours <= 0) return `${restMinutes}분`;
  return `${hours}시간 ${restMinutes}분`;
};

const formatKoreanDateLabel = (value: Date) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  const weekday = weekDays[parsed.getDay()];
  return `${y}.${m}.${d} (${weekday})`;
};

const buildTopicSectionTemplateHtml = (topics: string[]) => {
  const normalizedTopics = topics
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const targetTopics = normalizedTopics.length > 0 ? normalizedTopics : ['주제'];
  return targetTopics
    .map((topic, index) => `<h2>${index + 1}. ${escapeHtml(topic)}</h2><p><br></p>`)
    .join('<p><br></p>');
};

const buildTopicHeadingTemplateHtml = (topics: string[]) => {
  const normalizedTopics = topics
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const targetTopics = normalizedTopics.length > 0 ? normalizedTopics : ['주제'];
  return targetTopics
    .map((topic, index) => `<h2>${index + 1}. ${escapeHtml(topic)}</h2>`)
    .join('<p><br></p>');
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const convertPlainTextToEditorHtml = (value: string) => {
  const normalized = decodeHtmlEntities(String(value || '')).trim();
  if (!normalized) return '';

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

const decodeHtmlEntities = (value: string) => {
  const source = String(value || '');
  if (!source) return '';

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = source;
    return textarea.value;
  }

  return source
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCharCode(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
};

const normalizeEditorHtml = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(normalized)) {
    return normalized.replace(/&amp;(#\d+|#x[0-9a-f]+|[a-z]+);/gi, '&$1;');
  }
  return convertPlainTextToEditorHtml(normalized);
};

const extractTextFromEditorHtml = (value: string) => {
  const html = String(value || '');
  if (!html.trim()) return '';

  if (typeof window === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const temp = document.createElement('div');
  temp.innerHTML = html;
  return (temp.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeTopicText = (value: string) => value.replace(/\s+/g, ' ').trim();

const parseTopicBundle = (value: string, max = MAX_TOPIC_SELECTION) => {
  if (!value.trim()) return [];

  const values = value
    .split(TOPIC_BUNDLE_SEPARATOR)
    .map((item) => normalizeTopicText(item))
    .filter(Boolean);

  const deduped: string[] = [];
  values.forEach((item) => {
    if (!deduped.includes(item)) {
      deduped.push(item);
    }
  });

  return deduped.slice(0, max);
};

const serializeTopicBundle = (topics: string[]) =>
  topics
    .map((item) => normalizeTopicText(item))
    .filter(Boolean)
    .slice(0, MAX_TOPIC_SELECTION)
    .join(TOPIC_BUNDLE_SEPARATOR);

const normalizeTopicHeading = (value: string) => normalizeTopicText(String(value || '').replace(/^\d+\s*[.)\-:]\s*/, ''));

const extractTopicSectionBodyMap = (answerHtml: string, knownTopics: Set<string>) => {
  const sections = new Map<string, string>();
  const normalizedAnswerHtml = normalizeEditorHtml(answerHtml);
  if (!normalizedAnswerHtml.trim() || typeof window === 'undefined') return sections;

  const root = document.createElement('div');
  root.innerHTML = normalizedAnswerHtml;

  let activeTopic = '';
  let activeBodyChunks: string[] = [];

  const flushActiveSection = () => {
    if (!activeTopic || sections.has(activeTopic)) return;
    const bodyHtml = activeBodyChunks.join('').trim();
    sections.set(activeTopic, bodyHtml || '<p><br></p>');
  };

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === 'h2') {
      const headingTopic = normalizeTopicHeading((node as HTMLElement).textContent || '');
      if (headingTopic && knownTopics.has(headingTopic)) {
        flushActiveSection();
        activeTopic = headingTopic;
        activeBodyChunks = [];
        return;
      }

      if (activeTopic) {
        activeBodyChunks.push((node as HTMLElement).outerHTML);
      }
      return;
    }

    if (!activeTopic) return;

    if (node.nodeType === Node.ELEMENT_NODE) {
      activeBodyChunks.push((node as HTMLElement).outerHTML);
      return;
    }

    if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
      activeBodyChunks.push(`<p>${escapeHtml(node.textContent || '')}</p>`);
    }
  });

  flushActiveSection();
  return sections;
};

const buildTopicMergedAnswerHtml = ({
  previousTopics,
  nextTopics,
  answerHtml,
}: {
  previousTopics: string[];
  nextTopics: string[];
  answerHtml: string;
}) => {
  const previousTopicSet = new Set(previousTopics.map((topic) => normalizeTopicText(topic)));
  const topicBodyMap = extractTopicSectionBodyMap(answerHtml, previousTopicSet);

  const mergedHtml = nextTopics
    .map((topic, index) => {
      const normalizedTopic = normalizeTopicText(topic);
      const preservedBody = previousTopicSet.has(normalizedTopic) ? topicBodyMap.get(normalizedTopic) || '' : '';
      return `<h2>${index + 1}. ${escapeHtml(normalizedTopic)}</h2>${preservedBody.trim() ? preservedBody : '<p><br></p>'}`;
    })
    .join('<p><br></p>');

  return mergedHtml.trim() ? mergedHtml : buildTopicSectionTemplateHtml(nextTopics);
};

const isLegacyDummyTopic = (value: string) => {
  const normalized = normalizeTopicText(value);
  if (!normalized) return false;
  return LEGACY_DUMMY_TOPIC_MARKERS.some((marker) => normalized.endsWith(marker));
};

const sanitizeTopics = (topics: string[], max = MAX_TOPIC_POOL_SIZE) => {
  const deduped: string[] = [];
  topics.forEach((topic) => {
    const normalized = normalizeTopicText(String(topic || ''));
    if (!normalized || isLegacyDummyTopic(normalized) || deduped.includes(normalized)) return;
    deduped.push(normalized);
  });
  return deduped.slice(0, max);
};

const buildTopicHeadline = (topics: string[]) => {
  if (topics.length === 0) return '토론 주제를 확정하세요';
  if (topics.length === 1) return topics[0];
  return `${topics[0]} 외 ${topics.length - 1}개`;
};

const buildStudyPageTitle = (dateKey: string) => `${dateKey} 스터디`;

const buildApiErrorMessage = (status: number, fallback: string) => {
  if (status === 504) {
    return 'OCR 처리 시간이 초과되었습니다. 잠시 후 다시 시도하거나 파일 용량을 줄여주세요.';
  }
  if (status === 413) {
    return '업로드 파일 용량이 너무 큽니다. 파일 크기를 줄여 다시 시도해주세요.';
  }
  if (status === 401) {
    return '로그인 정보가 만료되었습니다. 다시 로그인해주세요.';
  }
  if (status === 400) {
    return fallback || '업로드 요청 형식을 확인해주세요.';
  }
  return fallback || '요청 처리 중 오류가 발생했습니다.';
};

const toPositiveInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeProgressPercent = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
};

const extractTopicTitlesFromAiResult = (value: unknown) => {
  if (!value || typeof value !== 'object') return [];

  const rawRecommendations = (value as MaterialTopicRecommendation).recommendations;
  if (!Array.isArray(rawRecommendations)) return [];

  const deduped: string[] = [];
  rawRecommendations.forEach((item) => {
    const title =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof item.title === 'string'
          ? item.title
          : '';
    const normalized = normalizeTopicText(String(title || ''));
    if (!normalized || deduped.includes(normalized)) return;
    deduped.push(normalized);
  });

  return sanitizeTopics(deduped, MAX_TOPIC_SUGGESTIONS);
};

const buildExtractedTextFromMaterialDetail = (detail: MaterialDetailResponse) => {
  const pageTexts = Array.isArray(detail.pages)
    ? detail.pages
        .map((page) => String(page?.ocrText || page?.rawText || '').trim())
        .filter(Boolean)
    : [];

  if (pageTexts.length > 0) {
    return pageTexts.join('\n\n').trim();
  }

  const summaryTexts = Array.isArray(detail.summaries)
    ? detail.summaries
        .map((summary) => String(summary?.summaryText || '').trim())
        .filter(Boolean)
    : [];

  return summaryTexts.join('\n\n').trim();
};

const normalizeMaterialStatus = (value: unknown) => String(value || '').trim().toLowerCase();
const isSupportedMaterialFile = (file: File) => {
  const lowerName = String(file.name || '').toLowerCase();
  const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';
  return ALLOWED_MATERIAL_EXTENSIONS.has(extension) || ALLOWED_MATERIAL_MIME_TYPES.has(String(file.type || '').toLowerCase());
};

const isMaterialFinalStatus = (status: string) =>
  Boolean(status) && status !== 'uploaded' && status !== 'processing';

const waitForMaterialSocketStatus = (
  materialId: number,
  timeoutMs: number,
  onProgress?: (payload: MaterialStatusEvent) => void,
) =>
  new Promise<MaterialStatusEvent>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('브라우저 환경에서만 실시간 상태를 확인할 수 있습니다.'));
      return;
    }

    const socket: Socket = io(window.location.origin, {
      path: SOCKET_PATH,
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 500,
    });

    let settled = false;
    let timeoutId: number | null = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('OCR 실시간 처리 대기 시간이 초과되었습니다.'));
    }, timeoutMs);

    const cleanup = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('material:status', handleMaterialStatus);
      socket.emit('material:unsubscribe', { materialId });
      socket.disconnect();
    };

    const resolveOnce = (payload: MaterialStatusEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const rejectOnce = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const handleConnect = () => {
      socket.emit('material:subscribe', { materialId }, (ack: MaterialStatusAck) => {
        if (settled) return;
        if (!ack?.ok) {
          rejectOnce(ack?.message || 'OCR 상태 구독에 실패했습니다.');
          return;
        }

        const ackStatus = normalizeMaterialStatus(ack.status);
        if (typeof onProgress === 'function' && !isMaterialFinalStatus(ackStatus)) {
          onProgress({
            materialId,
            status: ackStatus,
            errorMessage: ack.errorMessage || null,
            progressPercent: 5,
            stage: 'processing',
            message: 'OCR 처리를 시작했습니다.',
          });
        }
        if (isMaterialFinalStatus(ackStatus)) {
          resolveOnce({
            materialId,
            status: ackStatus,
            errorMessage: ack.errorMessage || null,
          });
        }
      });
    };

    const handleConnectError = (error: Error) => {
      rejectOnce(error?.message || 'OCR 실시간 연결에 실패했습니다.');
    };

    const handleMaterialStatus = (payload: MaterialStatusEvent) => {
      const payloadMaterialId = toPositiveInteger(payload?.materialId);
      if (payloadMaterialId !== materialId) return;
      const status = normalizeMaterialStatus(payload?.status);
      if (typeof onProgress === 'function') {
        onProgress({
          ...payload,
          materialId: payloadMaterialId,
          status,
        });
      }
      if (!isMaterialFinalStatus(status)) return;

      resolveOnce({
        materialId,
        status,
        errorMessage: payload?.errorMessage || null,
        updatedAt: payload?.updatedAt,
      });
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('material:status', handleMaterialStatus);
  });

const parseStoredAiReview = (value: unknown): AiReviewResult | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<AiReviewResult>;
  const toScore = (input: unknown, fallback = 0) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(fallback)));
    return Math.max(0, Math.min(100, Math.round(parsed)));
  };
  const legacyKeywordCoverageScore = Math.round(
    Math.max(0, Math.min(1, Number(raw.keywordCoverage || 0))) * 100,
  );
  const normalizedStrengths = Array.isArray(raw.strengths)
    ? raw.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const normalizedImprovements = Array.isArray(raw.improvements)
    ? raw.improvements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const normalizedIssues = Array.isArray(raw.issueFeedbacks)
    ? raw.issueFeedbacks
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const quote = String((item as { quote?: string }).quote || '').trim();
          const feedback = String((item as { feedback?: string }).feedback || '').trim();
          const severityRaw = String((item as { severity?: string }).severity || '').trim().toLowerCase();
          const severity = severityRaw === 'high' || severityRaw === 'low' ? severityRaw : 'medium';
          if (!quote || !feedback) return null;
          return { quote, feedback, severity: severity as 'low' | 'medium' | 'high' };
        })
        .filter((item): item is { quote: string; feedback: string; severity: 'low' | 'medium' | 'high' } => Boolean(item))
        .slice(0, 6)
    : [];

  const score = toScore(raw.score || 0);
  const normalizedAnswerLength = Number.isFinite(Number(raw.answerLength))
    ? Math.max(0, Math.floor(Number(raw.answerLength)))
    : 0;
  return {
    score,
    sourceCoverageScore: toScore(raw.sourceCoverageScore, legacyKeywordCoverageScore || score),
    factAccuracyScore: toScore(raw.factAccuracyScore, score),
    discussionDepthScore: toScore(raw.discussionDepthScore, score),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    strengths: normalizedStrengths.length > 0 ? normalizedStrengths : ['핵심 주제를 기준으로 답변을 작성한 점이 좋습니다.'],
    improvements: normalizedImprovements.length > 0 ? normalizedImprovements : ['근거와 예시를 조금 더 구체적으로 작성해보세요.'],
    answerLength: normalizedAnswerLength,
    issueFeedbacks: normalizedIssues,
    keywordCoverage: Number.isFinite(Number(raw.keywordCoverage)) ? Number(raw.keywordCoverage) : undefined,
    generatedBy: typeof raw.generatedBy === 'string' ? raw.generatedBy : undefined,
    warning: typeof raw.warning === 'string' ? raw.warning : null,
  };
};

const parseStoredPayload = (raw: string | null | undefined): StoredDiscussionPayload | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.schema === 'spo-ocr-discussion-v2') {
      const payloadV2 = parsed as Partial<StoredDiscussionPayloadV2>;
      const parsedReviewTimerMinutes = Number(payloadV2.reviewTimerMinutes ?? MIN_REVIEW_MINUTES);
      const reviewTimerMinutes = clampReviewMinutes(
        Number.isFinite(parsedReviewTimerMinutes) ? parsedReviewTimerMinutes : MIN_REVIEW_MINUTES,
      );
      const normalizedRemainingSeconds = Math.max(
        0,
        Math.min(
          reviewTimerMinutes * 60,
          Number.isFinite(Number(payloadV2.reviewTimerRemainingSeconds))
            ? Math.floor(Number(payloadV2.reviewTimerRemainingSeconds))
            : 0,
        ),
      );
      const parsedSelectedTopicDraft = parseTopicBundle(
        typeof payloadV2.selectedTopicDraft === 'string' ? payloadV2.selectedTopicDraft : '',
        MAX_TOPIC_SELECTION,
      );
      const parsedConfirmedTopic = parseTopicBundle(
        typeof payloadV2.confirmedTopic === 'string' ? payloadV2.confirmedTopic : '',
        MAX_TOPIC_SELECTION,
      );
      return {
        schema: 'spo-ocr-discussion-v2',
        reviewTimerMinutes,
        reviewTimerStartedAt: typeof payloadV2.reviewTimerStartedAt === 'string' ? payloadV2.reviewTimerStartedAt : null,
        reviewTimerEndedAt: typeof payloadV2.reviewTimerEndedAt === 'string' ? payloadV2.reviewTimerEndedAt : null,
        reviewTimerCompleted: Boolean(payloadV2.reviewTimerCompleted),
        reviewTimerPaused: Boolean(payloadV2.reviewTimerPaused),
        reviewTimerRemainingSeconds: normalizedRemainingSeconds,
        uploadedMaterialId: toPositiveInteger(payloadV2.uploadedMaterialId),
        uploadedPdfName: typeof payloadV2.uploadedPdfName === 'string' ? payloadV2.uploadedPdfName : '',
        ocrExtractedText: typeof payloadV2.ocrExtractedText === 'string' ? payloadV2.ocrExtractedText : '',
        aiTopicSuggestions: Array.isArray(payloadV2.aiTopicSuggestions)
          ? sanitizeTopics(payloadV2.aiTopicSuggestions.map((item: unknown) => String(item || '').trim()), MAX_TOPIC_POOL_SIZE)
          : [],
        selectedTopicDraft: serializeTopicBundle(sanitizeTopics(parsedSelectedTopicDraft, MAX_TOPIC_SELECTION)),
        confirmedTopic: serializeTopicBundle(sanitizeTopics(parsedConfirmedTopic, MAX_TOPIC_SELECTION)),
        pageTitleDraft: typeof payloadV2.pageTitleDraft === 'string' ? payloadV2.pageTitleDraft : '',
        answerDraft: typeof payloadV2.answerDraft === 'string' ? payloadV2.answerDraft : '',
        aiReview: parseStoredAiReview(payloadV2.aiReview),
        studyDurationMinutes: Math.max(0, Math.floor(Number(payloadV2.studyDurationMinutes || 0))),
        aiReviewedAt: typeof payloadV2.aiReviewedAt === 'string' ? payloadV2.aiReviewedAt : null,
      };
    }

    if (parsed.schema === 'spo-ocr-discussion-v1') {
      const payloadV1 = parsed as Partial<StoredDiscussionPayloadV1>;
      const legacySelectedTopic = typeof payloadV1.selectedTopic === 'string' ? payloadV1.selectedTopic : '';
      const legacySource = typeof payloadV1.ocrSourceText === 'string' ? payloadV1.ocrSourceText : '';
      const legacyAnswer = typeof payloadV1.answerDraft === 'string' ? payloadV1.answerDraft : '';
      const normalizedLegacyTopic = serializeTopicBundle(
        sanitizeTopics(parseTopicBundle(legacySelectedTopic, MAX_TOPIC_SELECTION), MAX_TOPIC_SELECTION),
      );

      return {
        schema: 'spo-ocr-discussion-v2',
        reviewTimerMinutes: MIN_REVIEW_MINUTES,
        reviewTimerStartedAt: null,
        reviewTimerEndedAt: null,
        reviewTimerCompleted: Boolean(legacySource || legacySelectedTopic || legacyAnswer),
        reviewTimerPaused: false,
        reviewTimerRemainingSeconds: 0,
        uploadedMaterialId: null,
        uploadedPdfName: '',
        ocrExtractedText: legacySource,
        aiTopicSuggestions: Array.isArray(payloadV1.aiTopicSuggestions)
          ? sanitizeTopics(payloadV1.aiTopicSuggestions.map((item: unknown) => String(item || '').trim()), MAX_TOPIC_POOL_SIZE)
          : [],
        selectedTopicDraft: normalizedLegacyTopic,
        confirmedTopic: normalizedLegacyTopic,
        pageTitleDraft: '',
        answerDraft: legacyAnswer,
        aiReview: parseStoredAiReview(payloadV1.aiReview),
        studyDurationMinutes: 0,
        aiReviewedAt: null,
      };
    }

    return null;
  } catch {
    return null;
  }
};

const hasMeaningfulStudyContent = (session: StudySession | null, payload: StoredDiscussionPayload | null) => {
  if (payload) {
    const answerText = extractTextFromEditorHtml(normalizeEditorHtml(payload.answerDraft || ''));
    if (answerText.trim()) return true;
    if (parseTopicBundle(payload.confirmedTopic).length > 0) return true;
    if (String(payload.ocrExtractedText || '').trim()) return true;
    if (payload.aiReview) return true;
    if (String(payload.aiReviewedAt || '').trim()) return true;
    return false;
  }

  const rawTopicDescription = String(session?.topicDescription || '').trim();
  return Boolean(rawTopicDescription);
};

export default function StudyEditorPage() {
  const params = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const groupId = Number(params.groupId);
  const selectedDate = normalizeDate(searchParams.get('date')) || normalizeDate(new Date().toISOString());
  const stepFirstEntry = searchParams.get('entry') === 'steps';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [materialProcessStatus, setMaterialProcessStatus] = useState('');
  const [ocrProgressPercent, setOcrProgressPercent] = useState(0);
  const [ocrProgressMessage, setOcrProgressMessage] = useState('');
  const [ocrProgressDetail, setOcrProgressDetail] = useState<{ processedPages: number; totalPages: number } | null>(null);
  const [refreshingTopics, setRefreshingTopics] = useState(false);

  const [studyGroup, setStudyGroup] = useState<StudyGroup | null>(null);
  const [currentSession, setCurrentSession] = useState<StudySession | null>(null);
  const [isPastContentReadOnly, setIsPastContentReadOnly] = useState(false);

  const [reviewTimerMinutes, setReviewTimerMinutes] = useState<number>(MIN_REVIEW_MINUTES);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const [timerEndedAt, setTimerEndedAt] = useState<string | null>(null);
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState(0);
  const [timerCompleted, setTimerCompleted] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);

  const [uploadedMaterialId, setUploadedMaterialId] = useState<number | null>(null);
  const [uploadedPdfName, setUploadedPdfName] = useState('');
  const [ocrExtractedText, setOcrExtractedText] = useState('');

  const [topicRefreshCount, setTopicRefreshCount] = useState(0);
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [selectedTopicDraft, setSelectedTopicDraft] = useState('');
  const [customTopicDraft, setCustomTopicDraft] = useState('');
  const [confirmedTopic, setConfirmedTopic] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [pageTitleDraft, setPageTitleDraft] = useState('');

  const [answerDraft, setAnswerDraft] = useState('');
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [studyDurationMinutes, setStudyDurationMinutes] = useState(0);
  const [aiReviewedAt, setAiReviewedAt] = useState<string | null>(null);
  const [timerDialOpen, setTimerDialOpen] = useState(false);

  const timerFinishedNotifiedRef = useRef(false);
  const answerEditorRef = useRef<HTMLDivElement | null>(null);
  const materialRecoveryKeyRef = useRef('');
  const materialRecoveryAttemptedKeyRef = useRef('');
  const draftRestoreKeyRef = useRef('');

  const canUploadPdf = timerCompleted;
  const timerRunning = Boolean(timerStartedAt && timerEndedAt && !timerCompleted && !timerPaused);
  const timerTotalSeconds = useMemo(() => {
    if (timerStartedAt && timerEndedAt) {
      const startedMs = new Date(timerStartedAt).getTime();
      const endedMs = new Date(timerEndedAt).getTime();
      const diff = Math.floor((endedMs - startedMs) / 1000);
      if (Number.isFinite(diff) && diff > 0) return diff;
    }
    return clampReviewMinutes(reviewTimerMinutes) * 60;
  }, [timerStartedAt, timerEndedAt, reviewTimerMinutes]);
  const timerRemainingRatio = useMemo(() => {
    if (timerCompleted) return 0;
    if (!(timerRunning || timerPaused) || timerTotalSeconds <= 0) return 1;
    return Math.max(0, Math.min(1, timerRemainingSeconds / timerTotalSeconds));
  }, [timerCompleted, timerRunning, timerPaused, timerTotalSeconds, timerRemainingSeconds]);
  const timerElapsedRatio = useMemo(() => 1 - timerRemainingRatio, [timerRemainingRatio]);
  const timerElapsedArcLength = useMemo(
    () => TIMER_DIAL_CIRCUMFERENCE * timerElapsedRatio,
    [timerElapsedRatio],
  );
  const timerDotAngle = useMemo(() => timerElapsedRatio * 360 - 90, [timerElapsedRatio]);
  const timerDotPosition = useMemo(() => {
    const rad = (timerDotAngle * Math.PI) / 180;
    const center = TIMER_DIAL_SIZE / 2;
    const x = center + TIMER_DIAL_RADIUS * Math.cos(rad);
    const y = center + TIMER_DIAL_RADIUS * Math.sin(rad);
    return { x, y };
  }, [timerDotAngle]);
  const timerDisplayText = timerRunning || timerPaused
    ? formatClockCountdown(timerRemainingSeconds)
    : timerCompleted
      ? '00:00:00'
      : formatClockCountdown(clampReviewMinutes(reviewTimerMinutes) * 60);
  const todayDateLabel = formatKoreanDateLabel(new Date());
  const selectedTopicDraftList = useMemo(() => parseTopicBundle(selectedTopicDraft), [selectedTopicDraft]);
  const confirmedTopicList = useMemo(() => parseTopicBundle(confirmedTopic), [confirmedTopic]);
  const visibleTopicSuggestions = useMemo(
    () => sanitizeTopics([...topicSuggestions, ...selectedTopicDraftList, ...confirmedTopicList], MAX_TOPIC_POOL_SIZE),
    [topicSuggestions, selectedTopicDraftList, confirmedTopicList],
  );
  const notionPageTitle = buildTopicHeadline(confirmedTopicList.length > 0 ? confirmedTopicList : selectedTopicDraftList);
  const defaultStudyPageTitle = buildStudyPageTitle(selectedDate);
  const studyDurationLabel = formatStudyDurationLabel(studyDurationMinutes);
  const answerEditorHtml = useMemo(() => normalizeEditorHtml(answerDraft), [answerDraft]);
  const answerPlainText = useMemo(() => extractTextFromEditorHtml(answerEditorHtml), [answerEditorHtml]);
  const selectedDateIsPast = isPastDateKey(selectedDate);
  const selectedDateIsFuture = isFutureDateKey(selectedDate);
  const isSelectedDateLocked = selectedDateIsPast || selectedDateIsFuture;
  const readOnlyNoticeText = selectedDateIsFuture
    ? '미래 날짜에는 토론을 진행할 수 없습니다. 오늘 날짜에서만 토론을 작성할 수 있습니다.'
    : '지난 날짜에는 새 토론을 진행할 수 없습니다. 저장된 기록은 내용 확인만 가능합니다.';

  const applyTimerState = (timerState: TimerStateSource) => {
    const parsedReviewTimerMinutes = Number(timerState.reviewTimerMinutes ?? MIN_REVIEW_MINUTES);
    const normalizedMinutes = clampReviewMinutes(
      Number.isFinite(parsedReviewTimerMinutes) ? parsedReviewTimerMinutes : MIN_REVIEW_MINUTES,
    );
    const normalizedRemainingSeconds = Math.max(
      0,
      Math.min(
        normalizedMinutes * 60,
        Number.isFinite(Number(timerState.timerRemainingSeconds)) ? Math.floor(Number(timerState.timerRemainingSeconds)) : 0,
      ),
    );

    setReviewTimerMinutes(normalizedMinutes);
    setTimerStartedAt(timerState.timerStartedAt || null);

    if (timerState.timerCompleted) {
      setTimerEndedAt(timerState.timerEndedAt || null);
      setTimerPaused(false);
      setTimerCompleted(true);
      setTimerRemainingSeconds(0);
      timerFinishedNotifiedRef.current = true;
      setTimerDialOpen(true);
      return;
    }

    if (timerState.timerPaused && normalizedRemainingSeconds > 0) {
      setTimerEndedAt(null);
      setTimerPaused(true);
      setTimerCompleted(false);
      setTimerRemainingSeconds(normalizedRemainingSeconds);
      timerFinishedNotifiedRef.current = true;
      setTimerDialOpen(true);
      return;
    }

    const endedAtMs = timerState.timerEndedAt ? new Date(timerState.timerEndedAt).getTime() : NaN;
    const remaining = Number.isFinite(endedAtMs) ? Math.floor((endedAtMs - Date.now()) / 1000) : normalizedRemainingSeconds;

    if (timerState.timerStartedAt && timerState.timerEndedAt && remaining > 0) {
      setTimerEndedAt(timerState.timerEndedAt);
      setTimerPaused(false);
      setTimerCompleted(false);
      setTimerRemainingSeconds(remaining);
      timerFinishedNotifiedRef.current = true;
      setTimerDialOpen(true);
      return;
    }

    if (timerState.timerStartedAt && timerState.timerEndedAt && remaining <= 0) {
      setTimerEndedAt(timerState.timerEndedAt);
      setTimerPaused(false);
      setTimerCompleted(true);
      setTimerRemainingSeconds(0);
      timerFinishedNotifiedRef.current = true;
      setTimerDialOpen(true);
      return;
    }

    setTimerEndedAt(null);
    setTimerPaused(false);
    setTimerCompleted(false);
    setTimerRemainingSeconds(0);
    timerFinishedNotifiedRef.current = false;
    setTimerDialOpen(false);
  };

  useEffect(() => {
    if (isSelectedDateLocked) return;
    if (!timerEndedAt || timerCompleted || timerPaused) return;

    const endTimestamp = new Date(timerEndedAt).getTime();
    if (!Number.isFinite(endTimestamp)) return;

    const tick = () => {
      const remaining = Math.floor((endTimestamp - Date.now()) / 1000);
      if (remaining <= 0) {
        setTimerRemainingSeconds(0);
        setTimerPaused(false);
        setTimerCompleted(true);

        if (!timerFinishedNotifiedRef.current) {
          timerFinishedNotifiedRef.current = true;
          void fireSpoNotice({
            icon: 'success',
            title: '복습 타이머 종료',
            text: '자료 업로드가 활성화되었습니다. 자료를 올려 토론 주제를 생성하세요.',
          });
        }
        return;
      }
      setTimerRemainingSeconds(remaining);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSelectedDateLocked, timerEndedAt, timerCompleted, timerPaused]);

  useEffect(() => {
    if (timerRunning || timerPaused) {
      const timeoutId = window.setTimeout(() => {
        setTimerDialOpen(true);
      }, 20);
      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    if (!timerCompleted) {
      setTimerDialOpen(false);
    }
  }, [timerRunning, timerPaused, timerCompleted]);

  useEffect(() => {
    if (!workspaceMode) return;

    const topics = parseTopicBundle(confirmedTopic);
    if (topics.length === 0) return;
    const normalizedAnswerHtml = normalizeEditorHtml(answerDraft);
    const hasTopicHeading = /<h2(?:\s[^>]*)?>/i.test(normalizedAnswerHtml);

    if (!normalizedAnswerHtml.trim()) {
      setAnswerDraft(buildTopicSectionTemplateHtml(topics));
      return;
    }

    if (!hasTopicHeading) {
      const headingHtml = buildTopicHeadingTemplateHtml(topics);
      setAnswerDraft(`${headingHtml}<p><br></p>${normalizedAnswerHtml}`);
    }
  }, [workspaceMode, confirmedTopic, answerDraft]);

  useEffect(() => {
    if (!workspaceMode) return;
    const editor = answerEditorRef.current;
    if (!editor) return;

    if (editor.innerHTML !== answerEditorHtml) {
      editor.innerHTML = answerEditorHtml;
    }
  }, [workspaceMode, answerEditorHtml]);

  useEffect(() => {
    if (loading) return;
    if (!Number.isFinite(groupId) || !selectedDate) return;
    if (isSelectedDateLocked) {
      clearTimerCache(groupId, selectedDate);
      return;
    }

    const timerState: TimerStateSource = {
      reviewTimerMinutes: clampReviewMinutes(reviewTimerMinutes),
      timerStartedAt,
      timerEndedAt,
      timerCompleted,
      timerPaused,
      timerRemainingSeconds,
    };

    if (!timerState.timerStartedAt && !timerState.timerEndedAt && !timerState.timerCompleted) {
      clearTimerCache(groupId, selectedDate);
      return;
    }

    writeTimerCache(groupId, selectedDate, timerState);
  }, [
    loading,
    groupId,
    selectedDate,
    isSelectedDateLocked,
    reviewTimerMinutes,
    timerStartedAt,
    timerEndedAt,
    timerCompleted,
    timerPaused,
    timerRemainingSeconds,
  ]);

  useEffect(() => {
    if (loading) return;
    if (!Number.isFinite(groupId) || !selectedDate) return;

    const recoveryKey = `${groupId}:${selectedDate}`;
    const materialId = toPositiveInteger(uploadedMaterialId);
    const uploadedName = String(uploadedPdfName || '').trim();
    const extracted = String(ocrExtractedText || '').trim();
    const normalizedStatus =
      normalizeMaterialStatus(materialProcessStatus) ||
      (processingPdf ? 'processing' : materialId ? 'completed' : '');

    const shouldPersist = Boolean(materialId && (processingPdf || uploadedName || extracted || normalizedStatus));
    if (!shouldPersist || !materialId) {
      if (materialRecoveryAttemptedKeyRef.current !== recoveryKey) {
        return;
      }
      clearMaterialProgressCache(groupId, selectedDate);
      return;
    }

    writeMaterialProgressCache(groupId, selectedDate, {
      materialId,
      uploadedPdfName: uploadedPdfName || '',
      status: normalizedStatus,
      progressPercent: normalizeProgressPercent(ocrProgressPercent, normalizedStatus === 'processing' ? 5 : 100),
      message: ocrProgressMessage || '',
      processedPages: ocrProgressDetail?.processedPages ?? null,
      totalPages: ocrProgressDetail?.totalPages ?? null,
    });
  }, [
    loading,
    groupId,
    selectedDate,
    uploadedMaterialId,
    uploadedPdfName,
    ocrExtractedText,
    processingPdf,
    materialProcessStatus,
    ocrProgressPercent,
    ocrProgressMessage,
    ocrProgressDetail,
  ]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!groupId) {
        router.replace('/study-room');
        return;
      }

      try {
        const [contextResponse, sessionsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app/study-room/context`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/study-sessions`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);

        const contextData = (await contextResponse.json().catch(() => ({}))) as StudyRoomContextResponse;
        const sessionsData = (await sessionsResponse.json().catch(() => ({}))) as StudySessionsResponse;

        if (contextResponse.status === 401 || sessionsResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!contextResponse.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '불러오기 실패',
            text: contextData.message || '스터디 정보를 불러올 수 없습니다.',
          });
          router.replace('/study-room');
          return;
        }

        const serverTodayDateKey =
          normalizeDate(contextResponse.headers.get('date')) ||
          normalizeDate(sessionsResponse.headers.get('date')) ||
          normalizeDate(new Date().toISOString());
        const selectedDateCompareServerToday = compareDateKeys(selectedDate, serverTodayDateKey);
        if (selectedDateCompareServerToday > 0) {
          await fireSpoNotice({
            icon: 'info',
            title: '오늘 날짜만 편집 가능',
            text:
              `미래 날짜(${selectedDate})에는 토론을 진행할 수 없습니다. 오늘(${serverTodayDateKey}) 날짜에서만 타이머와 편집이 가능합니다.`,
          });
          router.replace(`/study-room/${groupId}`);
          return;
        }

        const foundGroup = (contextData.studies || []).find((study) => study.id === groupId) || null;
        if (!foundGroup) {
          await fireSpoNotice({
            icon: 'warning',
            title: '스터디 없음',
            text: '선택한 스터디를 찾을 수 없습니다.',
          });
          router.replace('/study-room');
          return;
        }

        const matchedSession = (sessionsData.sessions || []).find((item) => {
          if (Number(item.studyGroupId) !== groupId) return false;
          return normalizeDate(item.scheduledStartAt || null) === selectedDate;
        });
        const matchedPayload = parseStoredPayload(matchedSession?.topicDescription || null);
        const hasMatchedDiscussionRecord = hasMeaningfulStudyContent(matchedSession || null, matchedPayload);
        if (selectedDateCompareServerToday < 0 && (!matchedSession || !hasMatchedDiscussionRecord)) {
          await fireSpoNotice({
            icon: 'info',
            title: '토론 기록 없음',
            text: `${selectedDate} 날짜에는 확인할 토론 기록이 없습니다.`,
          });
          router.replace(`/study-room/${groupId}`);
          return;
        }
        const isPastSelectedDate = isPastDateKey(selectedDate);
        const isFutureSelectedDate = isFutureDateKey(selectedDate);
        const isDateLocked = isPastSelectedDate || isFutureSelectedDate;

        const defaultSuggestions: string[] = [];
        const cachedTimer = readTimerCache(groupId, selectedDate);
        const cachedTimerState: TimerStateSource | null = cachedTimer
          ? {
              reviewTimerMinutes: cachedTimer.reviewTimerMinutes,
              timerStartedAt: cachedTimer.timerStartedAt,
              timerEndedAt: cachedTimer.timerEndedAt,
              timerCompleted: cachedTimer.timerCompleted,
              timerPaused: cachedTimer.timerPaused,
              timerRemainingSeconds: cachedTimer.timerRemainingSeconds,
            }
          : null;

        if (!cancelled) {
          setStudyGroup(foundGroup);
          setCurrentSession(matchedSession || null);

          if (matchedSession) {
            const payload = matchedPayload;
            const hasSavedContent = hasMeaningfulStudyContent(matchedSession, payload);
            const isReadOnlySession = isDateLocked || (isPastSelectedDate && hasSavedContent);
            setIsPastContentReadOnly(isReadOnlySession);

            if (payload) {
              const payloadTimerState: TimerStateSource = {
                reviewTimerMinutes: clampReviewMinutes(
                  Number.isFinite(Number(payload.reviewTimerMinutes ?? MIN_REVIEW_MINUTES))
                    ? Number(payload.reviewTimerMinutes ?? MIN_REVIEW_MINUTES)
                    : MIN_REVIEW_MINUTES,
                ),
                timerStartedAt: payload.reviewTimerStartedAt || null,
                timerEndedAt: payload.reviewTimerEndedAt || null,
                timerCompleted: Boolean(payload.reviewTimerCompleted),
                timerPaused: Boolean(payload.reviewTimerPaused),
                timerRemainingSeconds: Math.max(0, Math.floor(Number(payload.reviewTimerRemainingSeconds || 0))),
              };

              const resolvedTimerState = cachedTimerState || payloadTimerState;
              applyTimerState(isDateLocked ? normalizeTimerStateForLockedDate(resolvedTimerState) : resolvedTimerState);

              setUploadedMaterialId(toPositiveInteger(payload.uploadedMaterialId));
              setUploadedPdfName(payload.uploadedPdfName || '');
              setOcrExtractedText(payload.ocrExtractedText || '');
              setMaterialProcessStatus(
                toPositiveInteger(payload.uploadedMaterialId) ? (String(payload.ocrExtractedText || '').trim() ? 'completed' : 'processing') : '',
              );

              const suggestions = payload.aiTopicSuggestions.length > 0 ? payload.aiTopicSuggestions : [];

              setTopicRefreshCount(0);
              setTopicSuggestions(suggestions.length > 0 ? suggestions : defaultSuggestions);
              const restoredDraftTopics = parseTopicBundle(payload.selectedTopicDraft || payload.confirmedTopic, MAX_TOPIC_SELECTION);
              const defaultDraftTopics = restoredDraftTopics.length > 0 ? restoredDraftTopics : [];
              const restoredConfirmedTopics = parseTopicBundle(payload.confirmedTopic, MAX_TOPIC_SELECTION);

              setSelectedTopicDraft(serializeTopicBundle(defaultDraftTopics));
              setCustomTopicDraft('');
              setConfirmedTopic(serializeTopicBundle(restoredConfirmedTopics));
              setPageTitleDraft(payload.pageTitleDraft || buildStudyPageTitle(selectedDate));
              setWorkspaceMode(isReadOnlySession ? true : stepFirstEntry ? false : restoredConfirmedTopics.length > 0);
              setAnswerDraft(payload.answerDraft || '');
              setAiReview(payload.aiReview);
              setStudyDurationMinutes(
                Math.max(
                  0,
                  Math.floor(Number(payload.studyDurationMinutes || 0)),
                  Math.floor(Number(matchedSession.studyDurationMinutes || 0)),
                ),
              );
              setAiReviewedAt(payload.aiReviewedAt || matchedSession.aiReviewedAt || null);
            } else {
              const fallbackTimerState =
                cachedTimerState || {
                  reviewTimerMinutes: MIN_REVIEW_MINUTES,
                  timerStartedAt: null,
                  timerEndedAt: null,
                  timerCompleted: true,
                  timerPaused: false,
                  timerRemainingSeconds: 0,
                };
              applyTimerState(
                isDateLocked ? normalizeTimerStateForLockedDate(fallbackTimerState) : fallbackTimerState,
              );

              setUploadedMaterialId(null);
              setUploadedPdfName('');
              setOcrExtractedText('');
              setMaterialProcessStatus('');
              setTopicRefreshCount(0);
              setTopicSuggestions(defaultSuggestions);
              const fallbackTopic = isLegacyDummyTopic(matchedSession.topicTitle || '') ? '' : matchedSession.topicTitle || '';
              const fallbackTopics = fallbackTopic ? [fallbackTopic] : [];
              setSelectedTopicDraft(serializeTopicBundle(fallbackTopics));
              setCustomTopicDraft('');
              setConfirmedTopic(serializeTopicBundle(fallbackTopics));
              setPageTitleDraft(buildStudyPageTitle(selectedDate));
              setWorkspaceMode(isReadOnlySession ? true : stepFirstEntry ? false : fallbackTopics.length > 0);
              setAnswerDraft(matchedSession.topicDescription || '');
              setAiReview(null);
              setStudyDurationMinutes(Math.max(0, Math.floor(Number(matchedSession.studyDurationMinutes || 0))));
              setAiReviewedAt(matchedSession.aiReviewedAt || null);
            }
          } else {
            setIsPastContentReadOnly(isDateLocked);
            if (!isDateLocked && cachedTimerState) {
              applyTimerState(cachedTimerState);
            } else {
              applyTimerState({
                reviewTimerMinutes: MIN_REVIEW_MINUTES,
                timerStartedAt: null,
                timerEndedAt: null,
                timerCompleted: false,
                timerPaused: false,
                timerRemainingSeconds: 0,
              });
            }

            setUploadedMaterialId(null);
            setUploadedPdfName('');
            setOcrExtractedText('');
            setMaterialProcessStatus('');
            setTopicRefreshCount(0);
            setTopicSuggestions(defaultSuggestions);
            setSelectedTopicDraft('');
            setCustomTopicDraft('');
            setConfirmedTopic('');
            setPageTitleDraft(buildStudyPageTitle(selectedDate));
            setWorkspaceMode(isDateLocked);
            setAnswerDraft('');
            setAiReview(null);
            setStudyDurationMinutes(0);
            setAiReviewedAt(null);
          }
        }
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
  }, [groupId, selectedDate, stepFirstEntry, router]);

  useEffect(() => {
    if (loading) return;
    if (!Number.isFinite(groupId) || !selectedDate) return;

    const restoreKey = `${groupId}:${selectedDate}`;
    if (draftRestoreKeyRef.current === restoreKey) return;
    draftRestoreKeyRef.current = restoreKey;

    if (isPastContentReadOnly) return;
    const cached = readEditorDraftCache(groupId, selectedDate);
    if (!cached) return;

    setWorkspaceMode(cached.workspaceMode);
    setUploadedMaterialId(cached.uploadedMaterialId);
    setUploadedPdfName(cached.uploadedPdfName);
    setTopicSuggestions(cached.aiTopicSuggestions);
    setSelectedTopicDraft(cached.selectedTopicDraft);
    setCustomTopicDraft(cached.customTopicDraft);
    setConfirmedTopic(cached.confirmedTopic);
    setPageTitleDraft(cached.pageTitleDraft || buildStudyPageTitle(selectedDate));
    setAnswerDraft(cached.answerDraft);
    setTopicRefreshCount(cached.topicRefreshCount);
  }, [loading, groupId, selectedDate, isPastContentReadOnly]);

  useEffect(() => {
    if (loading || isPastContentReadOnly) return;
    if (!Number.isFinite(groupId) || !selectedDate) return;

    const timeoutId = window.setTimeout(() => {
      writeEditorDraftCache(groupId, selectedDate, {
        workspaceMode,
        uploadedMaterialId,
        uploadedPdfName,
        aiTopicSuggestions: topicSuggestions,
        selectedTopicDraft,
        customTopicDraft,
        confirmedTopic,
        pageTitleDraft,
        answerDraft,
        topicRefreshCount,
      });
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    loading,
    isPastContentReadOnly,
    groupId,
    selectedDate,
    workspaceMode,
    uploadedMaterialId,
    uploadedPdfName,
    topicSuggestions,
    selectedTopicDraft,
    customTopicDraft,
    confirmedTopic,
    pageTitleDraft,
    answerDraft,
    topicRefreshCount,
  ]);

  const resetWorkflowAfterTimer = (nextSuggestions: string[]) => {
    setUploadedMaterialId(null);
    setUploadedPdfName('');
    setOcrExtractedText('');
    setMaterialProcessStatus('');
    setProcessingPdf(false);
    setOcrProgressPercent(0);
    setOcrProgressMessage('');
    setOcrProgressDetail(null);
    setTopicRefreshCount(0);
    setTopicSuggestions(nextSuggestions);
    setSelectedTopicDraft(serializeTopicBundle([nextSuggestions[0] || '']));
    setCustomTopicDraft('');
    setConfirmedTopic('');
    setPageTitleDraft(buildStudyPageTitle(selectedDate));
    setWorkspaceMode(false);
    setAnswerDraft('');
    setAiReview(null);
    setStudyDurationMinutes(0);
    setAiReviewedAt(null);
  };

  const handleStartTimer = async () => {
    if (isSelectedDateLocked) {
      await fireSpoNotice({
        icon: 'info',
        title: '토론 불가 날짜',
        text: readOnlyNoticeText,
      });
      return;
    }

    if (!studyGroup) return;

    if (!Number.isFinite(reviewTimerMinutes) || reviewTimerMinutes < MIN_REVIEW_MINUTES) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 최소 시간',
        text: `복습 타이머는 최소 ${MIN_REVIEW_MINUTES}분 이상 설정해야 합니다.`,
      });
      return;
    }

    const durationMinutes = clampReviewMinutes(reviewTimerMinutes);
    const started = new Date();
    const ended = new Date(started.getTime() + durationMinutes * 60 * 1000);

    const initialSuggestions: string[] = [];

    setReviewTimerMinutes(durationMinutes);
    setTimerStartedAt(started.toISOString());
    setTimerEndedAt(durationMinutes > 0 ? ended.toISOString() : started.toISOString());
    setTimerRemainingSeconds(durationMinutes * 60);
    setTimerPaused(false);
    setTimerCompleted(durationMinutes === 0);
    timerFinishedNotifiedRef.current = false;
    setTimerDialOpen(false);

    resetWorkflowAfterTimer(initialSuggestions);

    await fireSpoNotice({
      icon: 'success',
      title: '복습 타이머 시작',
      text:
        durationMinutes === 0
          ? '0분 테스트 타이머가 적용되었습니다. 바로 자료 업로드를 진행할 수 있습니다.'
          : `${durationMinutes}분 타이머가 시작되었습니다. 종료 후 자료 업로드가 열립니다.`,
    });
  };

  const handleResetTimer = () => {
    if (isSelectedDateLocked) return;

    const defaultSuggestions: string[] = [];

    setTimerStartedAt(null);
    setTimerEndedAt(null);
    setTimerRemainingSeconds(0);
    setTimerPaused(false);
    setTimerCompleted(false);
    timerFinishedNotifiedRef.current = false;
    setTimerDialOpen(false);

    resetWorkflowAfterTimer(defaultSuggestions);
  };

  const handlePauseTimer = () => {
    if (isSelectedDateLocked) return;
    if (!timerRunning) return;
    setTimerRemainingSeconds((prev) => Math.max(0, Math.floor(prev)));
    setTimerPaused(true);
    setTimerEndedAt(null);
    setTimerDialOpen(true);
  };

  const handleResumeTimer = () => {
    if (isSelectedDateLocked) return;
    if (!timerPaused || timerCompleted) return;

    const remaining = Math.max(0, Math.floor(timerRemainingSeconds));
    if (remaining <= 0) {
      setTimerPaused(false);
      setTimerRemainingSeconds(0);
      setTimerCompleted(true);
      return;
    }

    const resumedEndedAt = new Date(Date.now() + remaining * 1000).toISOString();
    if (!timerStartedAt) {
      setTimerStartedAt(new Date().toISOString());
    }
    setTimerEndedAt(resumedEndedAt);
    setTimerPaused(false);
    setTimerDialOpen(true);
  };

  const continueMaterialProcessing = async ({
    materialId,
    fallbackFileName,
    fallbackTopicRecommendation,
    showPendingNotice = true,
    showSuccessNotice = true,
  }: {
    materialId: number;
    fallbackFileName?: string;
    fallbackTopicRecommendation?: MaterialTopicRecommendation | null;
    showPendingNotice?: boolean;
    showSuccessNotice?: boolean;
  }) => {
    setUploadedMaterialId(materialId);
    if (fallbackFileName) {
      setUploadedPdfName(fallbackFileName);
    }
    setProcessingPdf(true);
    setMaterialProcessStatus('processing');

    let socketStatus: MaterialStatusEvent | null = null;
    try {
      socketStatus = await waitForMaterialSocketStatus(materialId, MATERIAL_SOCKET_TIMEOUT_MS, (progressPayload) => {
        const status = normalizeMaterialStatus(progressPayload?.status);
        const incomingPercent = normalizeProgressPercent(progressPayload?.progressPercent, status === 'processing' ? 10 : 100);
        const nextPercent = status === 'processing' ? Math.min(99, incomingPercent) : 100;
        setOcrProgressPercent((prev) => Math.max(prev, nextPercent));
        setMaterialProcessStatus(status || 'processing');

        const progressMessage = String(progressPayload?.message || '').trim();
        if (progressMessage) {
          setOcrProgressMessage(progressMessage);
        }

        const processedPages = Number(progressPayload?.processedPages);
        const totalPages = Number(progressPayload?.totalPages);
        if (Number.isFinite(processedPages) && Number.isFinite(totalPages) && totalPages > 0) {
          setOcrProgressDetail({
            processedPages: Math.max(0, Math.floor(processedPages)),
            totalPages: Math.max(1, Math.floor(totalPages)),
          });
        }
      });
    } catch (socketError) {
      const socketMessage =
        socketError instanceof Error && socketError.message.trim()
          ? socketError.message
          : 'OCR 실시간 상태 수신에 실패했습니다.';
      console.warn(`[material:${materialId}] ${socketMessage}`);
      setOcrProgressMessage('실시간 연결이 불안정합니다. 서버 상태를 재확인 중입니다.');
    }

    const detailResponse = await fetch(`${API_BASE_URL}/app/materials/${materialId}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const detailData = (await detailResponse.json().catch(() => ({}))) as MaterialDetailResponse;

    if (detailResponse.status === 401) {
      window.location.replace('/sign-in');
      return { pending: false, status: 'unauthorized' as const };
    }

    if (!detailResponse.ok) {
      throw new Error(
        buildApiErrorMessage(detailResponse.status, detailData.message || '자료 OCR 상세 정보를 불러오지 못했습니다.'),
      );
    }

    const finalStatus = normalizeMaterialStatus(detailData.material?.status || socketStatus?.status);
    setMaterialProcessStatus(finalStatus || 'processing');

    if (!isMaterialFinalStatus(finalStatus)) {
      setProcessingPdf(true);
      setOcrProgressPercent((prev) => Math.max(prev, 95));
      setOcrProgressMessage('OCR 처리가 아직 진행 중입니다. 잠시 후 다시 확인해주세요.');
      if (showPendingNotice) {
        await fireSpoNotice({
          icon: 'info',
          title: 'OCR 처리 중',
          text: '업로드는 완료되었습니다. OCR 처리가 진행 중입니다. 잠시 후 다시 확인해주세요.',
        });
      }
      return { pending: true, status: 'processing' as const };
    }

    if (finalStatus === 'failed') {
      setProcessingPdf(false);
      setOcrProgressPercent(100);
      setOcrProgressMessage('OCR 처리에 실패했습니다.');
      throw new Error(
        detailData.material?.errorMessage || socketStatus?.errorMessage || 'OCR 처리에 실패했습니다. 다른 자료로 다시 시도해주세요.',
      );
    }

    const normalizedExtracted = buildExtractedTextFromMaterialDetail(detailData);
    if (!normalizedExtracted) {
      setProcessingPdf(false);
      setOcrProgressPercent(100);
      setOcrProgressMessage('OCR 텍스트를 찾지 못했습니다.');
      setUploadedMaterialId(materialId);
      setUploadedPdfName(detailData.material?.originalFileName || fallbackFileName || '');
      setOcrExtractedText('');
      setTopicSuggestions([]);
      setSelectedTopicDraft('');
      setCustomTopicDraft('');
      setOcrProgressDetail(null);
      if (showSuccessNotice) {
        await fireSpoNotice({
          icon: 'warning',
          title: 'OCR 텍스트 없음',
          text: detailData.material?.errorMessage || '자료에서 텍스트를 추출하지 못했습니다. 텍스트가 포함된 파일을 올려주세요.',
        });
      }
      return { pending: false, status: 'completed_without_text' as const };
    }

    const latestTopicResult = detailData.topicRecommendations?.[0]?.result || fallbackTopicRecommendation || null;
    const nextSuggestionsFromAi = extractTopicTitlesFromAiResult(latestTopicResult);
    const nextSuggestions = nextSuggestionsFromAi.length > 0 ? nextSuggestionsFromAi : [];

    setTopicRefreshCount(0);
    setUploadedPdfName(detailData.material?.originalFileName || fallbackFileName || '');
    setOcrExtractedText(normalizedExtracted);
    setTopicSuggestions(nextSuggestions);
    setSelectedTopicDraft(serializeTopicBundle(nextSuggestions[0] ? [nextSuggestions[0]] : []));
    setCustomTopicDraft('');
    setOcrProgressPercent(100);
    setOcrProgressMessage('OCR 처리가 완료되었습니다.');
    setOcrProgressDetail(null);
    setProcessingPdf(false);
    setMaterialProcessStatus(finalStatus || 'completed');

    if (showSuccessNotice) {
      if (nextSuggestions.length > 0) {
        await fireSpoNotice({
          icon: 'success',
          title: 'OCR 분석 완료',
          text: '자료 업로드와 OCR/주제 분석이 완료되었습니다.',
        });
      } else {
        const topicWarning =
          latestTopicResult && typeof latestTopicResult === 'object' ? String((latestTopicResult as { warning?: string }).warning || '').trim() : '';
        await fireSpoNotice({
          icon: 'warning',
          title: 'Gemma 주제 생성 실패',
          text: topicWarning || 'Gemma가 토론 주제를 반환하지 않았습니다. 잠시 후 주제 새로고침으로 다시 시도해주세요.',
        });
      }
    }

    return { pending: false, status: finalStatus || 'completed' };
  };

  useEffect(() => {
    if (loading) return;
    if (!Number.isFinite(groupId) || !selectedDate) return;

    const recoveryKey = `${groupId}:${selectedDate}`;
    materialRecoveryAttemptedKeyRef.current = recoveryKey;
    if (materialRecoveryKeyRef.current === recoveryKey) return;
    materialRecoveryKeyRef.current = recoveryKey;

    const cached = readMaterialProgressCache(groupId, selectedDate);
    if (!cached?.materialId) return;

    const cachedStatus = normalizeMaterialStatus(cached.status);
    const recoveredMaterialId = toPositiveInteger(cached.materialId);
    if (!recoveredMaterialId) return;

    setUploadedMaterialId(recoveredMaterialId);
    if (cached.uploadedPdfName) {
      setUploadedPdfName(cached.uploadedPdfName);
    }
    setMaterialProcessStatus(cachedStatus || 'processing');
    setOcrProgressPercent(normalizeProgressPercent(cached.progressPercent, cachedStatus === 'processing' ? 10 : 100));
    if (cached.message) {
      setOcrProgressMessage(cached.message);
    }
    if (Number.isFinite(cached.processedPages) && Number.isFinite(cached.totalPages) && Number(cached.totalPages) > 0) {
      setOcrProgressDetail({
        processedPages: Math.max(0, Math.floor(Number(cached.processedPages))),
        totalPages: Math.max(1, Math.floor(Number(cached.totalPages))),
      });
    }

    if (!isMaterialFinalStatus(cachedStatus)) {
      setProcessingPdf(true);
      void continueMaterialProcessing({
        materialId: recoveredMaterialId,
        fallbackFileName: cached.uploadedPdfName,
        showPendingNotice: false,
        showSuccessNotice: false,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'OCR 상태 복구 중 오류가 발생했습니다.';
        console.warn(`[material:${recoveredMaterialId}] ${message}`);
      });
      return;
    }

    if (!ocrExtractedText.trim()) {
      void continueMaterialProcessing({
        materialId: recoveredMaterialId,
        fallbackFileName: cached.uploadedPdfName,
        showPendingNotice: false,
        showSuccessNotice: false,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'OCR 결과 복구 중 오류가 발생했습니다.';
        console.warn(`[material:${recoveredMaterialId}] ${message}`);
      });
    }
  }, [loading, groupId, selectedDate]);

  const handleUploadPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    if (!timerCompleted) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 진행 중',
        text: '복습 타이머가 끝난 뒤 자료를 업로드할 수 있습니다.',
      });
      event.currentTarget.value = '';
      return;
    }

    if (!isSupportedMaterialFile(file)) {
      await fireSpoNotice({
        icon: 'warning',
        title: '자료 형식 확인',
        text: 'PDF, PPT, PPTX 파일만 업로드할 수 있습니다.',
      });
      event.currentTarget.value = '';
      return;
    }

    setProcessingPdf(true);
    setMaterialProcessStatus('processing');
    setOcrProgressPercent(2);
    setOcrProgressMessage('자료 업로드를 준비 중입니다.');
    setOcrProgressDetail(null);
    setUploadedMaterialId(null);
    setUploadedPdfName(file.name);
    setConfirmedTopic('');
    setCustomTopicDraft('');
    setWorkspaceMode(false);
    setAiReview(null);
    setAiReviewedAt(null);
    setStudyDurationMinutes(0);

    try {
      const formData = new FormData();
      formData.append('material', file);

      const uploadResponse = await fetch(`${API_BASE_URL}/app/materials`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const uploadData = (await uploadResponse.json().catch(() => ({}))) as MaterialUploadResponse;

      if (uploadResponse.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!uploadResponse.ok || !uploadData.material?.id) {
        throw new Error(buildApiErrorMessage(uploadResponse.status, uploadData.message || '자료 업로드 또는 OCR 분석에 실패했습니다.'));
      }

      const materialId = toPositiveInteger(uploadData.material.id);
      if (!materialId) {
        throw new Error('업로드된 자료 ID를 확인할 수 없습니다.');
      }

      setUploadedMaterialId(materialId);
      setUploadedPdfName(uploadData.material.originalFileName || file.name);
      setOcrProgressPercent(10);
      setOcrProgressMessage('업로드가 완료되었습니다. OCR 서버에서 처리를 시작합니다.');
      setOcrProgressDetail(null);
      setMaterialProcessStatus('processing');

      await continueMaterialProcessing({
        materialId,
        fallbackFileName: uploadData.material.originalFileName || file.name,
        fallbackTopicRecommendation: uploadData.processing?.topicRecommendation || null,
        showPendingNotice: true,
        showSuccessNotice: true,
      });
    } catch (error) {
      setProcessingPdf(false);
      setMaterialProcessStatus('failed');
      setOcrProgressPercent(0);
      setOcrProgressMessage('');
      setOcrProgressDetail(null);
      await fireSpoNotice({
        icon: 'error',
        title: 'OCR 처리 실패',
        text:
          error instanceof Error && error.message.trim()
            ? error.message
            : '자료 처리 중 오류가 발생했습니다. 다른 파일로 다시 시도해주세요.',
      });
      setUploadedMaterialId(null);
      setUploadedPdfName('');
      setOcrExtractedText('');
      setTopicSuggestions([]);
      setSelectedTopicDraft('');
      setCustomTopicDraft('');
    } finally {
      event.currentTarget.value = '';
    }
  };

  const handleRefreshTopics = async () => {
    if (topicRefreshCount >= MAX_TOPIC_REFRESH_COUNT) {
      await fireSpoNotice({
        icon: 'warning',
        title: '새로고침 횟수 초과',
        text: `주제 새로고침은 최대 ${MAX_TOPIC_REFRESH_COUNT}회까지 가능합니다.`,
      });
      return;
    }

    const nextRefreshCount = topicRefreshCount + 1;
    setRefreshingTopics(true);
    try {
      let sourceText = ocrExtractedText.trim();
      if (!sourceText && uploadedMaterialId) {
        const detailResponse = await fetch(`${API_BASE_URL}/app/materials/${uploadedMaterialId}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const detailData = (await detailResponse.json().catch(() => ({}))) as MaterialDetailResponse;

        if (detailResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!detailResponse.ok) {
          throw new Error(
            buildApiErrorMessage(detailResponse.status, detailData.message || '자료 OCR 상세 정보를 불러오지 못했습니다.'),
          );
        }

        const materialStatus = String(detailData.material?.status || '').toLowerCase();
        if (materialStatus === 'uploaded' || materialStatus === 'processing') {
          await fireSpoNotice({
            icon: 'info',
            title: 'OCR 처리 중',
            text: '아직 OCR 처리가 진행 중입니다. 잠시 후 다시 시도해주세요.',
          });
          return;
        }

        if (materialStatus === 'failed') {
          throw new Error(detailData.material?.errorMessage || 'OCR 처리에 실패했습니다. 다른 자료로 다시 시도해주세요.');
        }

        sourceText = buildExtractedTextFromMaterialDetail(detailData).trim();
        if (sourceText) {
          setOcrExtractedText(sourceText);
          setUploadedPdfName(detailData.material?.originalFileName || uploadedPdfName);
        }
      }

      if (!sourceText) {
        await fireSpoNotice({
          icon: 'warning',
          title: 'OCR 데이터 필요',
          text: '먼저 자료를 업로드해 OCR 데이터를 준비해주세요.',
        });
        return;
      }

      let nextSuggestions: string[] = [];
      if (uploadedMaterialId) {
        const analyzeResponse = await fetch(`${API_BASE_URL}/app/materials/${uploadedMaterialId}/analyze`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ analysisType: 'topic' }),
        });
        const analyzeData = (await analyzeResponse.json().catch(() => ({}))) as MaterialAnalyzeResponse;

        if (analyzeResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!analyzeResponse.ok) {
          throw new Error(buildApiErrorMessage(analyzeResponse.status, analyzeData.message || '서버에서 주제 새로고침에 실패했습니다.'));
        }

        nextSuggestions = extractTopicTitlesFromAiResult(analyzeData.topicRecommendation);
      }

      if (nextSuggestions.length === 0) {
        throw new Error('Gemma가 토론 주제를 반환하지 않았습니다. 잠시 후 다시 시도해주세요.');
      }

      setTopicRefreshCount(nextRefreshCount);
      setTopicSuggestions(nextSuggestions);
      setSelectedTopicDraft(serializeTopicBundle([nextSuggestions[0] || '']));
      setCustomTopicDraft('');
      setConfirmedTopic('');
      setWorkspaceMode(false);
      setAiReview(null);
      setAiReviewedAt(null);
      setStudyDurationMinutes(0);
    } catch (error) {
      await fireSpoNotice({
        icon: 'warning',
        title: '주제 새로고침 실패',
        text:
          error instanceof Error && error.message.trim()
            ? error.message
            : '서버 주제 분석에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setRefreshingTopics(false);
    }
  };

  const handleToggleTopicDraft = async (topic: string) => {
    const normalizedTopic = normalizeTopicText(topic);
    if (!normalizedTopic) return;

    const current = parseTopicBundle(selectedTopicDraft);
    if (current.includes(normalizedTopic)) {
      setSelectedTopicDraft(serializeTopicBundle(current.filter((item) => item !== normalizedTopic)));
      return;
    }

    if (current.length >= MAX_TOPIC_SELECTION) {
      await fireSpoNotice({
        icon: 'warning',
        title: '선택 개수 초과',
        text: `토론 주제는 최대 ${MAX_TOPIC_SELECTION}개까지 선택할 수 있습니다.`,
      });
      return;
    }

    setSelectedTopicDraft(serializeTopicBundle([...current, normalizedTopic]));
  };

  const handleAddCustomTopic = async () => {
    const normalizedTopic = normalizeTopicText(customTopicDraft);
    if (!normalizedTopic) return;

    setTopicSuggestions((prev) =>
      sanitizeTopics([normalizedTopic, ...prev], MAX_TOPIC_POOL_SIZE),
    );

    const current = parseTopicBundle(selectedTopicDraft);
    if (current.includes(normalizedTopic)) {
      setCustomTopicDraft('');
      return;
    }

    if (current.length >= MAX_TOPIC_SELECTION) {
      setCustomTopicDraft('');
      await fireSpoNotice({
        icon: 'info',
        title: '주제 목록에 추가됨',
        text: `주제는 목록에 추가되었습니다. 선택은 최대 ${MAX_TOPIC_SELECTION}개까지 가능합니다.`,
      });
      return;
    }

    setSelectedTopicDraft(serializeTopicBundle([...current, normalizedTopic]));
    setCustomTopicDraft('');
  };

  const persistTopicSelection = async (topics: string[], nextAnswerDraft: string) => {
    if (!studyGroup) {
      throw new Error('스터디 정보를 확인할 수 없습니다.');
    }

    const serializedTopics = serializeTopicBundle(topics);
    const topicTitle = pageTitleDraft.trim() || defaultStudyPageTitle;
    const payload: StoredDiscussionPayload = {
      schema: 'spo-ocr-discussion-v2',
      reviewTimerMinutes: clampReviewMinutes(reviewTimerMinutes),
      reviewTimerStartedAt: timerStartedAt,
      reviewTimerEndedAt: timerEndedAt,
      reviewTimerCompleted: timerCompleted,
      reviewTimerPaused: timerPaused,
      reviewTimerRemainingSeconds: Math.max(0, Math.floor(timerRemainingSeconds)),
      uploadedMaterialId,
      uploadedPdfName,
      ocrExtractedText,
      aiTopicSuggestions: sanitizeTopics(topicSuggestions, MAX_TOPIC_POOL_SIZE),
      selectedTopicDraft: serializedTopics,
      confirmedTopic: serializedTopics,
      pageTitleDraft: topicTitle,
      answerDraft: nextAnswerDraft,
      aiReview: null,
      studyDurationMinutes: 0,
      aiReviewedAt: null,
    };

    const scheduledStartAt = currentSession?.scheduledStartAt || scheduleAtKst(selectedDate);
    const requestBody = currentSession
      ? {
          topicTitle,
          topicDescription: JSON.stringify(payload),
          scheduledStartAt,
          status: currentSession.status || 'scheduled',
        }
      : {
          studyGroupId: studyGroup.id,
          topicTitle,
          topicDescription: JSON.stringify(payload),
          scheduledStartAt,
          status: 'scheduled',
        };

    const response = await fetch(
      currentSession ? `${API_BASE_URL}/app/study-sessions/${currentSession.id}` : `${API_BASE_URL}/app/study-sessions`,
      {
        method: currentSession ? 'PUT' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    const data = (await response.json().catch(() => ({}))) as SessionMutationResponse;
    if (response.status === 401) {
      window.location.replace('/sign-in');
      throw new Error('로그인 정보가 만료되었습니다. 다시 로그인해주세요.');
    }

    if (!response.ok || !data.session) {
      throw new Error(data.message || '주제 확정 내용을 저장하지 못했습니다.');
    }

    setCurrentSession(data.session);
  };

  const handleConfirmTopic = async () => {
    if (isPastContentReadOnly) {
      await fireSpoNotice({
        icon: 'info',
        title: '읽기 전용 모드',
        text: readOnlyNoticeText,
      });
      return;
    }

    const selectedTopics = parseTopicBundle(selectedTopicDraft);
    if (selectedTopics.length < MIN_TOPIC_SELECTION) {
      await fireSpoNotice({
        icon: 'warning',
        title: '주제 선택 필요',
        text: `먼저 추천 주제 중에서 최소 ${MIN_TOPIC_SELECTION}개를 선택해주세요.`,
      });
      return;
    }

    const previousConfirmedTopics = parseTopicBundle(confirmedTopic);
    const previousConfirmed = serializeTopicBundle(previousConfirmedTopics);
    const nextConfirmed = serializeTopicBundle(selectedTopics);
    const topicsChanged = previousConfirmed !== '' && previousConfirmed !== nextConfirmed;
    const latestAnswerHtml = normalizeEditorHtml(answerEditorRef.current?.innerHTML || answerEditorHtml);
    const nextAnswerDraft = topicsChanged
      ? buildTopicMergedAnswerHtml({
          previousTopics: previousConfirmedTopics,
          nextTopics: selectedTopics,
          answerHtml: latestAnswerHtml,
        })
      : latestAnswerHtml;

    try {
      await persistTopicSelection(selectedTopics, nextAnswerDraft);
    } catch (error) {
      await fireSpoNotice({
        icon: 'error',
        title: '주제 확정 실패',
        text:
          error instanceof Error && error.message.trim()
            ? error.message
            : '주제 확정 내용을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.',
      });
      return;
    }

    setConfirmedTopic(serializeTopicBundle(selectedTopics));
    if (topicsChanged) {
      setAnswerDraft(nextAnswerDraft);
    }
    setWorkspaceMode(true);
    setAiReview(null);
    setAiReviewedAt(null);
    setStudyDurationMinutes(0);

    await fireSpoNotice({
      icon: 'success',
      title: '주제 확정 완료',
      text: `${selectedTopics.length}개 주제를 확정했습니다. 답변을 작성하고 AI 검사를 실행하세요.`,
    });
  };

  const handleReopenTopicSteps = () => {
    const confirmedTopics = parseTopicBundle(confirmedTopic);
    if (confirmedTopics.length > 0) {
      setSelectedTopicDraft(serializeTopicBundle(confirmedTopics));
    }
    setWorkspaceMode(false);
    setAiReview(null);
    setAiReviewedAt(null);
    setStudyDurationMinutes(0);
    router.replace(`/study-room/${groupId}/editor?date=${selectedDate}&entry=steps`);
  };

  const handleBodyEditorInput = () => {
    if (isPastContentReadOnly) return;
    const html = answerEditorRef.current?.innerHTML || '';
    setAnswerDraft(html);
  };

  const handleRunAiReview = async () => {
    if (isPastContentReadOnly) {
      await fireSpoNotice({
        icon: 'info',
        title: '읽기 전용 모드',
        text: readOnlyNoticeText,
      });
      return;
    }

    const confirmedTopics = parseTopicBundle(confirmedTopic);
    if (confirmedTopics.length < MIN_TOPIC_SELECTION) {
      await fireSpoNotice({
        icon: 'warning',
        title: '주제 확정 필요',
        text: `AI 검사를 위해 최소 ${MIN_TOPIC_SELECTION}개 주제를 확정해주세요.`,
      });
      return;
    }

    const latestAnswerHtml = normalizeEditorHtml(answerEditorRef.current?.innerHTML || answerDraft);
    const latestAnswerText = extractTextFromEditorHtml(latestAnswerHtml);
    if (!latestAnswerText.trim()) {
      await fireSpoNotice({
        icon: 'warning',
        title: '답변 작성 필요',
        text: 'AI 검사를 위해 답변을 먼저 작성해주세요.',
      });
      return;
    }

    if (!timerStartedAt) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 시작 필요',
        text: '학습시간 측정을 위해 먼저 복습 타이머를 시작해주세요.',
      });
      return;
    }

    if (latestAnswerHtml !== answerDraft) {
      setAnswerDraft(latestAnswerHtml);
    }
    writeEditorDraftCache(groupId, selectedDate, {
      workspaceMode,
      uploadedMaterialId,
      uploadedPdfName,
      aiTopicSuggestions: topicSuggestions,
      selectedTopicDraft,
      customTopicDraft,
      confirmedTopic,
      pageTitleDraft,
      answerDraft: latestAnswerHtml,
      topicRefreshCount,
    });

    router.push(`/study-room/${groupId}/editor/review?date=${selectedDate}`);
  };

  const handleSave = async () => {
    if (!studyGroup) return;

    if (isPastContentReadOnly) {
      await fireSpoNotice({
        icon: 'info',
        title: '읽기 전용 모드',
        text: readOnlyNoticeText,
      });
      return;
    }

    if (!timerCompleted) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 완료 필요',
        text: '복습 타이머 종료 후 스터디 기록을 저장할 수 있습니다.',
      });
      return;
    }

    if (!uploadedPdfName.trim()) {
      await fireSpoNotice({
        icon: 'warning',
        title: '자료 업로드 필요',
        text: '토론 주제 생성을 위해 자료를 먼저 업로드해주세요.',
      });
      return;
    }

    const confirmedTopics = parseTopicBundle(confirmedTopic);
    if (confirmedTopics.length < MIN_TOPIC_SELECTION) {
      await fireSpoNotice({
        icon: 'warning',
        title: '주제 확정 필요',
        text: `저장을 위해 최소 ${MIN_TOPIC_SELECTION}개 주제를 확정해주세요.`,
      });
      return;
    }
    const topicTitle = pageTitleDraft.trim() || defaultStudyPageTitle;

    if (!answerPlainText.trim()) {
      await fireSpoNotice({
        icon: 'warning',
        title: '답변 작성 필요',
        text: '토론 주제에 대한 답변을 작성한 뒤 저장해주세요.',
      });
      return;
    }

    if (!timerStartedAt) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 시작 필요',
        text: '학습시간 측정을 위해 복습 타이머를 먼저 시작해주세요.',
      });
      return;
    }

    const hasReviewed = Boolean(aiReview && aiReviewedAt);
    const storedStudyDurationMinutes = Math.max(0, Math.floor(Number(currentSession?.studyDurationMinutes || studyDurationMinutes || 0)));
    const timerElapsedStudyDurationMinutes = computeActiveStudyDurationMinutes({
      reviewTimerMinutes,
      timerRemainingSeconds,
      timerCompleted,
    });
    const effectiveStudyDurationMinutes = hasReviewed
      ? Math.max(storedStudyDurationMinutes, timerElapsedStudyDurationMinutes)
      : storedStudyDurationMinutes;

    const payload: StoredDiscussionPayload = {
      schema: 'spo-ocr-discussion-v2',
      reviewTimerMinutes: clampReviewMinutes(reviewTimerMinutes),
      reviewTimerStartedAt: timerStartedAt,
      reviewTimerEndedAt: timerEndedAt,
      reviewTimerCompleted: timerCompleted,
      reviewTimerPaused: timerPaused,
      reviewTimerRemainingSeconds: Math.max(0, Math.floor(timerRemainingSeconds)),
      uploadedMaterialId,
      uploadedPdfName,
      ocrExtractedText,
      aiTopicSuggestions: sanitizeTopics(topicSuggestions, MAX_TOPIC_POOL_SIZE),
      selectedTopicDraft: serializeTopicBundle(parseTopicBundle(selectedTopicDraft)),
      confirmedTopic: serializeTopicBundle(confirmedTopics),
      pageTitleDraft: topicTitle,
      answerDraft: answerEditorHtml,
      aiReview: hasReviewed ? aiReview : null,
      studyDurationMinutes: effectiveStudyDurationMinutes,
      aiReviewedAt: hasReviewed ? aiReviewedAt : null,
    };

    const scheduledStartAt = currentSession?.scheduledStartAt || scheduleAtKst(selectedDate);

    setSaving(true);
    try {
      const response = await fetch(
        currentSession ? `${API_BASE_URL}/app/study-sessions/${currentSession.id}` : `${API_BASE_URL}/app/study-sessions`,
        {
          method: currentSession ? 'PUT' : 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            currentSession
              ? {
                  topicTitle,
                  topicDescription: JSON.stringify(payload),
                  scheduledStartAt,
                  status: currentSession.status || 'scheduled',
                  studyDurationMinutes: effectiveStudyDurationMinutes,
                  studyStartedAt: timerStartedAt,
                  aiReviewedAt: hasReviewed ? aiReviewedAt : null,
                }
              : {
                  studyGroupId: studyGroup.id,
                  topicTitle,
                  topicDescription: JSON.stringify(payload),
                  scheduledStartAt,
                  status: 'scheduled',
                  studyDurationMinutes: effectiveStudyDurationMinutes,
                  studyStartedAt: timerStartedAt,
                  aiReviewedAt: hasReviewed ? aiReviewedAt : null,
                },
          ),
        },
      );

      const data = (await response.json().catch(() => ({}))) as SessionMutationResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok || !data.session) {
        await fireSpoNotice({
          icon: 'error',
          title: '저장 실패',
          text: data.message || '스터디 기록을 저장하지 못했습니다.',
        });
        return;
      }

      setCurrentSession(data.session);
      setStudyDurationMinutes(Math.max(0, Math.floor(Number(data.session.studyDurationMinutes || effectiveStudyDurationMinutes))));
      setAiReviewedAt(data.session.aiReviewedAt || null);
      clearMaterialProgressCache(groupId, selectedDate);
      clearEditorDraftCache(groupId, selectedDate);
      await fireSpoNotice({
        icon: 'success',
        title: '저장 완료',
        text: hasReviewed
          ? `학습시간 ${formatStudyDurationLabel(effectiveStudyDurationMinutes)}이(가) 포함되어 저장되었습니다.`
          : '기록이 저장되었습니다.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!studyGroup) return;

    if (isPastContentReadOnly) {
      await fireSpoNotice({
        icon: 'info',
        title: '읽기 전용 모드',
        text: readOnlyNoticeText,
      });
      return;
    }

    if (!timerCompleted) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 완료 필요',
        text: '복습 타이머 종료 후 제출할 수 있습니다.',
      });
      return;
    }

    if (!uploadedPdfName.trim()) {
      await fireSpoNotice({
        icon: 'warning',
        title: '자료 업로드 필요',
        text: '제출을 위해 자료를 먼저 업로드해주세요.',
      });
      return;
    }

    const confirmedTopics = parseTopicBundle(confirmedTopic);
    if (confirmedTopics.length < MIN_TOPIC_SELECTION) {
      await fireSpoNotice({
        icon: 'warning',
        title: '주제 확정 필요',
        text: `제출을 위해 최소 ${MIN_TOPIC_SELECTION}개 주제를 확정해주세요.`,
      });
      return;
    }

    const topicTitle = pageTitleDraft.trim() || defaultStudyPageTitle;
    if (!answerPlainText.trim()) {
      await fireSpoNotice({
        icon: 'warning',
        title: '답변 작성 필요',
        text: '제출을 위해 답변을 작성해주세요.',
      });
      return;
    }

    if (!aiReview) {
      await fireSpoNotice({
        icon: 'warning',
        title: 'AI 검사 필요',
        text: '최종 제출 전 AI 검사를 먼저 실행해주세요.',
      });
      return;
    }

    const startedAtDate = parseIsoDate(timerStartedAt || currentSession?.studyStartedAt || null);
    if (!startedAtDate) {
      await fireSpoNotice({
        icon: 'warning',
        title: '타이머 시작 필요',
        text: '학습시간 측정을 위해 복습 타이머를 먼저 시작해주세요.',
      });
      return;
    }

    const submittedAt = new Date();
    const effectiveEndedAt = submittedAt.getTime() < startedAtDate.getTime() ? startedAtDate : submittedAt;
    const finalizedAiReviewedAt = effectiveEndedAt.toISOString();
    const finalizedStudyDurationMinutes = computeTotalStudyDurationMinutes(startedAtDate, effectiveEndedAt);

    const payload: StoredDiscussionPayload = {
      schema: 'spo-ocr-discussion-v2',
      reviewTimerMinutes: clampReviewMinutes(reviewTimerMinutes),
      reviewTimerStartedAt: timerStartedAt,
      reviewTimerEndedAt: timerEndedAt,
      reviewTimerCompleted: timerCompleted,
      reviewTimerPaused: timerPaused,
      reviewTimerRemainingSeconds: Math.max(0, Math.floor(timerRemainingSeconds)),
      uploadedMaterialId,
      uploadedPdfName,
      ocrExtractedText,
      aiTopicSuggestions: sanitizeTopics(topicSuggestions, MAX_TOPIC_POOL_SIZE),
      selectedTopicDraft: serializeTopicBundle(parseTopicBundle(selectedTopicDraft)),
      confirmedTopic: serializeTopicBundle(confirmedTopics),
      pageTitleDraft: topicTitle,
      answerDraft: answerEditorHtml,
      aiReview,
      studyDurationMinutes: finalizedStudyDurationMinutes,
      aiReviewedAt: finalizedAiReviewedAt,
    };

    const scheduledStartAt = currentSession?.scheduledStartAt || scheduleAtKst(selectedDate);

    setSubmitting(true);
    try {
      const response = await fetch(
        currentSession ? `${API_BASE_URL}/app/study-sessions/${currentSession.id}` : `${API_BASE_URL}/app/study-sessions`,
        {
          method: currentSession ? 'PUT' : 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            currentSession
              ? {
                  topicTitle,
                  topicDescription: JSON.stringify(payload),
                  scheduledStartAt,
                  status: 'completed',
                  studyDurationMinutes: finalizedStudyDurationMinutes,
                  studyStartedAt: startedAtDate.toISOString(),
                  aiReviewedAt: finalizedAiReviewedAt,
                }
              : {
                  studyGroupId: studyGroup.id,
                  topicTitle,
                  topicDescription: JSON.stringify(payload),
                  scheduledStartAt,
                  status: 'completed',
                  studyDurationMinutes: finalizedStudyDurationMinutes,
                  studyStartedAt: startedAtDate.toISOString(),
                  aiReviewedAt: finalizedAiReviewedAt,
                },
          ),
        },
      );

      const data = (await response.json().catch(() => ({}))) as SessionMutationResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok || !data.session) {
        await fireSpoNotice({
          icon: 'error',
          title: '제출 실패',
          text: data.message || '스터디 기록 제출에 실패했습니다.',
        });
        return;
      }

      setCurrentSession(data.session);
      setStudyDurationMinutes(Math.max(0, Math.floor(Number(data.session.studyDurationMinutes || finalizedStudyDurationMinutes))));
      setAiReviewedAt(data.session.aiReviewedAt || finalizedAiReviewedAt);
      clearMaterialProgressCache(groupId, selectedDate);
      clearEditorDraftCache(groupId, selectedDate);
      await fireSpoNotice({
        icon: 'success',
        title: '제출 완료',
        text: `기록이 제출되었습니다. 학습시간 ${formatStudyDurationLabel(finalizedStudyDurationMinutes)}이 반영되었습니다.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4">
        <p className="text-sm font-semibold text-slate-600">스터디룸을 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f7f5] text-[#191c1d]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 px-6 pt-3">
          <div className="flex h-14 items-center rounded-2xl border border-slate-200 bg-white/90 px-6 backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>스터디룸</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span>{studyGroup?.name || 'Study Room'}</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              <span className="text-slate-700">{selectedDate}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {workspaceMode ? (
            <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
              <section className="min-w-0">
                <article className="rounded-2xl border border-[#e6e8eb] bg-white px-6 py-7 md:px-10 md:py-9">
                  <div className="mx-auto max-w-5xl">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="flex items-center gap-1.5 rounded-md bg-[#f8f8f7] px-3 py-2 text-xs font-semibold text-slate-600">
                        <span className="material-symbols-outlined text-[14px]">calendar_month</span>
                        <span>날짜</span>
                        <span className="ml-auto text-slate-700">{selectedDate}</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md bg-[#f8f8f7] px-3 py-2 text-xs font-semibold text-slate-600">
                        <span className="material-symbols-outlined text-[14px]">groups</span>
                        <span>그룹</span>
                        <span className="ml-auto truncate text-slate-700">{studyGroup?.name || '-'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-md bg-[#f8f8f7] px-3 py-2 text-xs font-semibold text-slate-600">
                        <span className="material-symbols-outlined text-[14px]">menu_book</span>
                        <span>과목</span>
                        <span className="ml-auto truncate text-slate-700">{studyGroup?.subject || '-'}</span>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={pageTitleDraft}
                      onChange={(event) => setPageTitleDraft(event.target.value)}
                      placeholder={defaultStudyPageTitle}
                      disabled={isPastContentReadOnly}
                      className="mt-3 w-full border-0 bg-transparent p-0 text-3xl font-bold leading-[1.15] tracking-[-0.02em] text-slate-900 outline-none placeholder:text-slate-300 disabled:cursor-not-allowed disabled:text-slate-500 md:text-[44px]"
                    />
                    <p className="mt-3 text-base font-semibold text-slate-600">
                      {notionPageTitle}
                    </p>
                    {isPastContentReadOnly ? (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                        {readOnlyNoticeText}
                      </p>
                    ) : null}

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-[#fafafa] px-4 py-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">확정된 주제</p>
                      {confirmedTopicList.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {confirmedTopicList.map((topic) => (
                            <span
                              key={`confirmed-topic-${topic}`}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm font-medium text-slate-500">확정된 주제를 찾지 못했습니다.</p>
                      )}
                      {!isPastContentReadOnly ? (
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={handleReopenTopicSteps}
                            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                          >
                            주제 다시 정하기
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-8 border-t border-slate-200 pt-6">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">페이지 본문</p>
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 transition focus-within:ring-4 focus-within:ring-slate-200">
                        <div
                          ref={answerEditorRef}
                          contentEditable={!isPastContentReadOnly}
                          suppressContentEditableWarning
                          onInput={handleBodyEditorInput}
                          className={`mt-2 min-h-[500px] w-full font-headline text-[16px] leading-8 text-slate-700 outline-none [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:leading-[1.35] [&_h2]:tracking-[-0.01em] [&_h2]:text-slate-900 [&_h2:first-child]:mt-0 [&_p]:my-2 [&_figure]:my-4 [&_figure>img]:max-h-[420px] [&_figure>img]:w-full [&_figure>img]:rounded-lg [&_figure>img]:object-contain [&_figure>figcaption]:mt-2 [&_figure>figcaption]:text-center [&_figure>figcaption]:text-xs [&_figure>figcaption]:font-semibold [&_figure>figcaption]:text-slate-500 ${
                            isPastContentReadOnly ? 'cursor-default bg-slate-50' : 'bg-transparent'
                          }`}
                        />
                      </div>
                      {aiReview?.issueFeedbacks?.length ? (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                          <p className="text-sm font-bold text-rose-700">수정이 필요한 문장 피드백</p>
                          <div className="mt-2 space-y-2">
                            {aiReview.issueFeedbacks.map((item, index) => (
                              <div key={`editor-issue-${index}`} className="text-sm font-semibold text-rose-700">
                                <p>"{item.quote}"</p>
                                <p className="mt-1 text-rose-800">{item.feedback}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              </section>

              <aside className="w-full xl:w-[320px] xl:shrink-0 xl:self-start xl:sticky xl:top-4">
                <div className="space-y-4 xl:max-h-[calc(100vh-32px)] xl:overflow-y-auto xl:pr-1">
                  <article className="rounded-2xl border border-[#e6e8eb] bg-white p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">문서 상태</p>
                    <div className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                      <p>업로드 자료: {uploadedPdfName || '자료 미업로드'}</p>
                      <p>
                        타이머:{' '}
                        {timerCompleted
                          ? '완료'
                          : timerRunning
                            ? formatCountdown(timerRemainingSeconds)
                            : timerPaused
                              ? `일시정지 (${formatCountdown(timerRemainingSeconds)})`
                              : `${reviewTimerMinutes}분`}
                      </p>
                      <p>학습시간: {aiReviewedAt ? studyDurationLabel : 'AI 검사 전'}</p>
                      <p>답변 길이: {answerPlainText.trim().length}자</p>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-[#e6e8eb] bg-white p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">AI 검사 결과</p>
                    {aiReview ? (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-[#fafafa] p-3">
                          <p className="text-xs font-bold text-slate-500">종합 점수</p>
                          <p className="mt-1 text-2xl font-black text-slate-900">{aiReview.score} / 100</p>
                          <p className="mt-1 text-sm font-medium text-slate-600">{aiReview.summary}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-[#fafafa] p-3 text-xs font-semibold text-slate-600">
                          <p>자료 반영: {aiReview.sourceCoverageScore}점</p>
                          <p>팩트 정확도: {aiReview.factAccuracyScore}점</p>
                          <p>토론 깊이: {aiReview.discussionDepthScore}점</p>
                          <p>답변 길이: {aiReview.answerLength}자</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-[#fafafa] p-3 text-xs font-semibold text-slate-700">
                          <p className="font-bold text-emerald-700">칭찬</p>
                          {(aiReview.strengths || []).slice(0, 3).map((item, index) => (
                            <p key={`sidebar-strength-${index}`} className="mt-1">
                              • {item}
                            </p>
                          ))}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-[#fafafa] p-3 text-xs font-semibold text-amber-700">
                          <p className="font-bold">개선</p>
                          {(aiReview.improvements || []).slice(0, 3).map((item, index) => (
                            <p key={`sidebar-improvement-${index}`} className="mt-1">
                              • {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleRunAiReview();
                        }}
                        disabled={isPastContentReadOnly || submitting}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        AI 검사
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSave();
                        }}
                        disabled={saving || submitting || isPastContentReadOnly}
                        className="rounded-md bg-[#1f6fff] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#175cd3] disabled:opacity-60"
                      >
                        {isPastContentReadOnly ? '읽기 전용' : saving ? '저장중...' : '기록 저장'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSubmit();
                        }}
                        disabled={saving || submitting || isPastContentReadOnly}
                        className="col-span-2 rounded-md border border-[#1f6fff] bg-white px-3 py-2 text-xs font-bold text-[#1f6fff] transition hover:bg-[#eff5ff] disabled:opacity-60"
                      >
                        {isPastContentReadOnly ? '읽기 전용' : submitting ? '제출중...' : '제출하기'}
                      </button>
                    </div>
                  </article>
                </div>
              </aside>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-6xl">
            <section className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">Step 1</p>
                    <h2 className="text-lg font-black text-slate-900">오늘 수업 복습 타이머 설정</h2>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                      timerCompleted
                        ? 'bg-emerald-100 text-emerald-700'
                        : timerPaused
                          ? 'bg-blue-100 text-blue-700'
                          : timerRunning
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {timerCompleted ? '타이머 완료' : timerPaused ? '타이머 일시정지' : timerRunning ? '타이머 진행 중' : '대기'}
                  </span>
                </div>

                <p className="text-sm font-medium text-slate-600">0분부터 설정 가능합니다.</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={MIN_REVIEW_MINUTES}
                    max={MAX_REVIEW_MINUTES}
                    value={reviewTimerMinutes}
                    disabled={timerRunning || timerPaused}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setReviewTimerMinutes(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : MIN_REVIEW_MINUTES);
                    }}
                    className="h-11 w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800 outline-none ring-[#0052FF]/20 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span className="text-sm font-bold text-slate-600">분</span>

                  {!timerRunning && !timerPaused ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartTimer();
                      }}
                      className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-700"
                    >
                      타이머 시작
                    </button>
                  ) : null}

                  {timerRunning ? (
                    <button
                      type="button"
                      onClick={handlePauseTimer}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                    >
                      일시정지
                    </button>
                  ) : null}

                  {timerPaused ? (
                    <button
                      type="button"
                      onClick={handleResumeTimer}
                      className="h-11 rounded-xl bg-[#0052FF] px-4 text-sm font-bold text-white transition hover:bg-[#003ec0]"
                    >
                      재개
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleResetTimer}
                    disabled={timerRunning}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    초기화
                  </button>
                </div>

                {timerRunning || timerPaused || timerCompleted ? (
                  <div
                    className={`overflow-hidden transition-all duration-500 ease-out ${
                      timerDialOpen ? 'mt-4 max-h-[520px] opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="mb-3">
                        <span className="rounded-full border border-[#0052FF]/40 bg-blue-50 px-3 py-1 text-xs font-bold text-[#0052FF]">
                          복습 타이머
                        </span>
                      </div>

                      <div className="flex justify-center">
                        <div className="relative" style={{ width: TIMER_DIAL_SIZE, height: TIMER_DIAL_SIZE }}>
                          <svg
                            className="absolute left-0 top-0 -rotate-90"
                            width={TIMER_DIAL_SIZE}
                            height={TIMER_DIAL_SIZE}
                            viewBox={`0 0 ${TIMER_DIAL_SIZE} ${TIMER_DIAL_SIZE}`}
                          >
                            <circle
                              cx={TIMER_DIAL_SIZE / 2}
                              cy={TIMER_DIAL_SIZE / 2}
                              r={TIMER_DIAL_RADIUS}
                              fill="none"
                              stroke="#0052FF"
                              strokeWidth={TIMER_DIAL_STROKE}
                            />
                            <circle
                              cx={TIMER_DIAL_SIZE / 2}
                              cy={TIMER_DIAL_SIZE / 2}
                              r={TIMER_DIAL_RADIUS}
                              fill="none"
                              stroke="#dfe3ea"
                              strokeWidth={TIMER_DIAL_STROKE}
                              strokeLinecap="round"
                              strokeDasharray={`${timerElapsedArcLength} ${TIMER_DIAL_CIRCUMFERENCE}`}
                              strokeDashoffset={0}
                              className="transition-all duration-700"
                            />
                          </svg>

                          {[...Array(12)].map((_, index) => {
                            const angle = ((index * 30 - 90) * Math.PI) / 180;
                            const markerRadius = TIMER_DIAL_RADIUS - 18;
                            const center = TIMER_DIAL_SIZE / 2;
                            const x = center + markerRadius * Math.cos(angle);
                            const y = center + markerRadius * Math.sin(angle);

                            return (
                              <span
                                key={`timer-marker-${index}`}
                                className={`absolute block h-1.5 w-1.5 rounded-full ${index % 3 === 0 ? 'bg-[#0052FF]' : 'bg-slate-300'}`}
                                style={{ left: `${x - 3}px`, top: `${y - 3}px` }}
                              />
                            );
                          })}

                          {!timerCompleted ? (
                            <span
                              className="absolute block h-4 w-4 rounded-full border-4 border-[#0052FF] bg-white"
                              style={{ left: `${timerDotPosition.x - 8}px`, top: `${timerDotPosition.y - 8}px` }}
                            />
                          ) : null}

                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#0052FF]">
                              {timerCompleted ? 'Review Done' : 'Review Countdown'}
                            </p>
                            <p className="mt-2 text-5xl font-black tracking-tight text-slate-900">{timerDisplayText}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-500">{todayDateLabel}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-slate-500">타이머를 시작하면 복습 시간이 카운트됩니다.</p>
                )}

                {timerCompleted ? (
                  <p className="mt-3 text-sm font-semibold text-[#0052FF]">타이머가 끝났습니다. 이제 자료 업로드가 가능합니다.</p>
                ) : null}
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">Step 2</p>
                    <h2 className="text-lg font-black text-slate-900">자료 업로드 및 OCR 처리</h2>
                  </div>
                  <label
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      canUploadPdf
                        ? 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                        : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    }`}
                  >
                    자료 업로드
                    <input
                      type="file"
                      accept="application/pdf,.pdf,application/vnd.ms-powerpoint,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                      className="hidden"
                      disabled={!canUploadPdf || processingPdf}
                      onChange={(event) => {
                        void handleUploadPdf(event);
                      }}
                    />
                  </label>
                </div>

                {!canUploadPdf ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                    타이머 완료 후 자료 업로드가 활성화됩니다.
                  </p>
                ) : null}

                {uploadedPdfName ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold text-slate-500">업로드된 자료</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{uploadedPdfName}</p>
                  </div>
                ) : (
                  <p className={`text-sm font-medium text-slate-500 ${!canUploadPdf ? 'mt-3' : 'mt-2'}`}>
                    타이머 종료 후 자료를 업로드하세요.
                  </p>
                )}

                {processingPdf ? (
                  <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-[#0052FF]">{ocrProgressMessage || 'OCR 처리 중...'}</p>
                      <span className="text-xs font-extrabold text-[#0052FF]">{normalizeProgressPercent(ocrProgressPercent)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                      <div
                        className="h-full rounded-full bg-[#0052FF] transition-all duration-300"
                        style={{ width: `${Math.max(2, normalizeProgressPercent(ocrProgressPercent))}%` }}
                      />
                    </div>
                    {ocrProgressDetail ? (
                      <p className="mt-2 text-xs font-semibold text-blue-700">
                        페이지 처리 진행: {ocrProgressDetail.processedPages}/{ocrProgressDetail.totalPages}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">Step 3</p>
                    <h2 className="text-lg font-black text-slate-900">주요 토론 주제 선택</h2>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleRefreshTopics();
                      }}
                      disabled={
                        processingPdf ||
                        refreshingTopics ||
                        !ocrExtractedText.trim() ||
                        topicRefreshCount >= MAX_TOPIC_REFRESH_COUNT
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {refreshingTopics ? '새로고침 중...' : '주제 새로고침'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleConfirmTopic();
                      }}
                      disabled={selectedTopicDraftList.length < MIN_TOPIC_SELECTION}
                      className="rounded-lg bg-[#0052FF] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#003ec0] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      주제 확정
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span
                    className={`rounded-full px-2.5 py-1 ${
                      selectedTopicDraftList.length >= MIN_TOPIC_SELECTION
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    선택 {selectedTopicDraftList.length}/{MAX_TOPIC_SELECTION}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">최소 {MIN_TOPIC_SELECTION}개 필요</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                    새로고침 {topicRefreshCount}/{MAX_TOPIC_REFRESH_COUNT}
                  </span>
                </div>

                {visibleTopicSuggestions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {visibleTopicSuggestions.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => {
                          void handleToggleTopicDraft(topic);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          selectedTopicDraftList.includes(topic)
                            ? 'bg-[#0052FF] text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-500">
                    OCR 완료 후 추천 주제가 표시됩니다.
                  </p>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={customTopicDraft}
                    onChange={(event) => setCustomTopicDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleAddCustomTopic();
                      }
                    }}
                    placeholder="주제 직접 입력"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none ring-[#0052FF]/20 transition focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleAddCustomTopic();
                    }}
                    disabled={!customTopicDraft.trim()}
                    className="w-full shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:min-w-[104px] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    주제 추가
                  </button>
                </div>
              </article>
            </section>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}
