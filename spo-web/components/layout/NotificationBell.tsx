'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
  readAt?: string | null;
};

type NotificationListResponse = {
  notifications?: NotificationItem[];
  unreadCount?: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || '/api/socket.io';
const NOTIFICATION_VISIBLE_LIMIT = 5;
const NOTIFICATION_SYNC_MIN_INTERVAL_MS = 5000;

const normalizeNotificationTimestamp = (createdAt: string) => {
  const raw = String(createdAt || '').trim();
  if (!raw) return NaN;

  const now = Date.now();
  const primary = new Date(raw).getTime();
  if (Number.isFinite(primary) && primary <= now + 5 * 60 * 1000) {
    return primary;
  }

  // MySQL DATETIME -> JS Date timezone mismatch fallback
  const rawWithoutZone = raw.replace(/Z$/i, '');
  const localIso = rawWithoutZone.includes(' ') ? rawWithoutZone.replace(' ', 'T') : rawWithoutZone;
  const fallback = new Date(localIso).getTime();
  if (Number.isFinite(fallback)) return fallback;

  return primary;
};

const toRelativeTimeLabel = (createdAt: string) => {
  const created = normalizeNotificationTimestamp(createdAt);
  if (!Number.isFinite(created)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - created) / 1000));
  if (diffSec < 60) return '1분 미만 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
};

export function NotificationBell() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const visibleUnreadCount = useMemo(() => Math.max(0, Math.min(99, unreadCount)), [unreadCount]);

  const loadNotifications = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const now = Date.now();
    if (!force) {
      if (loadingRef.current) return;
      if (now - lastLoadedAtRef.current < NOTIFICATION_SYNC_MIN_INTERVAL_MS) return;
    }

    loadingRef.current = true;
    try {
      const response = await fetch(`${API_BASE_URL}/app/notifications?limit=${NOTIFICATION_VISIBLE_LIMIT}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as NotificationListResponse;
      if (response.status === 401) {
        return;
      }
      if (!response.ok) {
        return;
      }

      setItems(Array.isArray(data.notifications) ? data.notifications.slice(0, NOTIFICATION_VISIBLE_LIMIT) : []);
      setUnreadCount(Math.max(0, Math.floor(Number(data.unreadCount || 0))));
    } catch {
      // ignore
    } finally {
      loadingRef.current = false;
      lastLoadedAtRef.current = Date.now();
    }
  }, []);

  useEffect(() => {
    void loadNotifications({ force: true });

    let socket: Socket | null = null;
    if (typeof window !== 'undefined') {
      socket = io(window.location.origin, {
        path: SOCKET_PATH,
        withCredentials: true,
        transports: ['polling', 'websocket'],
      });

      const handleRealtimeNotification = () => {
        void loadNotifications();
      };

      socket.on('connect', handleRealtimeNotification);
      socket.on('notification:event', handleRealtimeNotification);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void loadNotifications();
        }
      };

      const handleFocus = () => {
        void loadNotifications();
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        socket?.off('connect', handleRealtimeNotification);
        socket?.off('notification:event', handleRealtimeNotification);
        socket?.disconnect();
      };
    }

    return undefined;
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  const handleToggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      setLoading(true);
      await loadNotifications({ force: true });
      setLoading(false);
    }
  };

  const handleReadOne = async (item: NotificationItem) => {
    if (!item.isRead) {
      try {
        await fetch(`${API_BASE_URL}/app/notifications/${item.id}/read`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // ignore
      }

      setItems((prev) => prev.map((current) => (current.id === item.id ? { ...current, isRead: true } : current)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    if (item.linkUrl) {
      window.location.href = item.linkUrl;
    }
  };

  const handleReadAll = async () => {
    try {
      await fetch(`${API_BASE_URL}/app/notifications/read-all`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // ignore
    }

    setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
  };

  return (
    <div ref={rootRef} className="relative flex h-8 w-8 items-center justify-center">
      <button type="button" onClick={() => void handleToggle()} className="leading-none" aria-label="알림">
        <span className="material-symbols-outlined cursor-pointer text-[#595c5e] transition-colors hover:text-[#004be2]">
          notifications
        </span>
      </button>

      {visibleUnreadCount > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#004be2] px-1 text-[10px] font-black text-white">
          {visibleUnreadCount > 99 ? '99+' : visibleUnreadCount}
        </span>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-10 z-[120] w-[360px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-black text-slate-900">알림</p>
            <button
              type="button"
              onClick={() => void handleReadAll()}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50"
            >
              모두 읽음
            </button>
          </div>

          {loading ? (
            <p className="py-4 text-center text-xs font-semibold text-slate-500">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs font-semibold text-slate-500">새 알림이 없습니다.</p>
          ) : (
            <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleReadOne(item)}
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                    item.isRead ? 'border-slate-200 bg-white' : 'border-blue-100 bg-blue-50/50'
                  } hover:bg-slate-50`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-xs font-bold ${item.isRead ? 'text-slate-600' : 'text-[#0b3ab6]'}`}>{item.title}</p>
                    {!item.isRead ? <span className="mt-0.5 h-2 w-2 rounded-full bg-[#1f6fff]" /> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">{item.message}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">{toRelativeTimeLabel(item.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
