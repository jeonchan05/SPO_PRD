'use client';

import './page.css';

import Head from 'next/head';
import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoSwal } from '@/lib/ui/swal';

type ProfileUser = {
  loginId?: string;
  name?: string;
  email?: string;
  phoneNumber?: string;
  profileImageUrl?: string | null;
  role?: string;
};

type ProfileResponse = {
  user?: ProfileUser;
  message?: string;
};

type ProfileSwalOptions = {
  icon: 'success' | 'error' | 'warning' | 'info';
  title: string;
  text: string;
  confirmButtonText?: string;
  confirmButtonColor?: string;
  allowOutsideClick?: boolean;
};

type PasswordFieldKey = 'currentPassword' | 'newPassword' | 'newPasswordConfirm';
type PasswordErrors = Record<PasswordFieldKey, string | null>;
type PasswordTouched = Record<PasswordFieldKey, boolean>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const DEFAULT_PROFILE_IMAGE_URL = '/default-profile-avatar.svg';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PROFILE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROFILE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const PASSWORD_RULE_MESSAGE = '비밀번호는 8~72자이며 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.';
const normalizeRole = (value?: string | null) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const showProfileSwal = async ({
  confirmButtonText = '확인',
  confirmButtonColor = '#2563eb',
  allowOutsideClick = false,
  ...options
}: ProfileSwalOptions) => {
  await fireSpoSwal({
    ...options,
    confirmButtonText,
    confirmButtonColor,
    allowOutsideClick,
  });
};

export default function ProfileSettingsPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [userRole, setUserRole] = useState('student');
  const [profileImageUrl, setProfileImageUrl] = useState(DEFAULT_PROFILE_IMAGE_URL);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState<string | null>(null);
  const [selectedProfileImageFile, setSelectedProfileImageFile] = useState<File | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({
    currentPassword: null,
    newPassword: null,
    newPasswordConfirm: null,
  });
  const [passwordTouched, setPasswordTouched] = useState<PasswordTouched>({
    currentPassword: false,
    newPassword: false,
    newPasswordConfirm: false,
  });
  const [passwordVisibility, setPasswordVisibility] = useState<Record<PasswordFieldKey, boolean>>({
    currentPassword: false,
    newPassword: false,
    newPasswordConfirm: false,
  });

  const [initialValues, setInitialValues] = useState({
    name: '',
    email: '',
    phoneNumber: '',
  });

  const profileSectionRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/app/users/me`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        const data = (await response.json().catch(() => ({}))) as ProfileResponse;
        if (!response.ok || !data.user) {
          if (!cancelled) {
            window.location.replace('/sign-in');
          }
          return;
        }

        if (cancelled) return;

        const loadedName = data.user.name || '';
        const loadedEmail = data.user.email || '';
        const loadedPhone = data.user.phoneNumber || '';

        setLoginId(data.user.loginId || '');
        setName(loadedName);
        setEmail(loadedEmail);
        setPhoneNumber(loadedPhone);
        setUserRole(normalizeRole(data.user.role) || 'student');
        setInitialValues({
          name: loadedName,
          email: loadedEmail,
          phoneNumber: loadedPhone,
        });

        if (typeof data.user.profileImageUrl === 'string' && data.user.profileImageUrl.trim()) {
          setProfileImageUrl(data.user.profileImageUrl.trim());
        }
      } catch {
        if (!cancelled) {
          window.location.replace('/sign-in');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousPreviewUrl = previousPreviewUrlRef.current;
    if (previousPreviewUrl && previousPreviewUrl !== profilePreviewUrl) {
      URL.revokeObjectURL(previousPreviewUrl);
    }
    previousPreviewUrlRef.current = profilePreviewUrl;

    return () => {
      if (previousPreviewUrlRef.current) {
        URL.revokeObjectURL(previousPreviewUrlRef.current);
        previousPreviewUrlRef.current = null;
      }
    };
  }, [profilePreviewUrl]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (profileSectionRef.current?.contains(event.target as Node)) return;
      setIsProfileMenuOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    setIsProfileMenuOpen(false);
  }, [sidebarCollapsed]);

  const getPasswordValidationErrors = (
    currentPasswordValue: string,
    newPasswordValue: string,
    newPasswordConfirmValue: string,
  ): PasswordErrors => {
    const hasPasswordInput = Boolean(currentPasswordValue || newPasswordValue || newPasswordConfirmValue);
    if (!hasPasswordInput) {
      return {
        currentPassword: null,
        newPassword: null,
        newPasswordConfirm: null,
      };
    }

    const currentPasswordError = currentPasswordValue ? null : '현재 비밀번호를 입력해주세요.';
    let newPasswordError: string | null = null;
    let newPasswordConfirmError: string | null = null;

    if (!newPasswordValue) {
      newPasswordError = '새 비밀번호를 입력해주세요.';
    } else if (
      newPasswordValue.length < 8 ||
      newPasswordValue.length > 72 ||
      !/[A-Za-z]/.test(newPasswordValue) ||
      !/\d/.test(newPasswordValue) ||
      !/[^A-Za-z0-9]/.test(newPasswordValue)
    ) {
      newPasswordError = PASSWORD_RULE_MESSAGE;
    } else if (currentPasswordValue && currentPasswordValue === newPasswordValue) {
      newPasswordError = '새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.';
    }

    if (!newPasswordConfirmValue) {
      newPasswordConfirmError = '새 비밀번호 확인을 입력해주세요.';
    } else if (newPasswordValue !== newPasswordConfirmValue) {
      newPasswordConfirmError = '새 비밀번호 확인이 일치하지 않습니다.';
    }

    return {
      currentPassword: currentPasswordError,
      newPassword: newPasswordError,
      newPasswordConfirm: newPasswordConfirmError,
    };
  };

  const updateTouchedPasswordErrors = (
    nextCurrentPassword: string,
    nextNewPassword: string,
    nextNewPasswordConfirm: string,
  ) => {
    const nextAllErrors = getPasswordValidationErrors(
      nextCurrentPassword,
      nextNewPassword,
      nextNewPasswordConfirm,
    );

    setPasswordErrors((previous) => ({
      currentPassword: passwordTouched.currentPassword
        ? nextAllErrors.currentPassword
        : previous.currentPassword,
      newPassword: passwordTouched.newPassword ? nextAllErrors.newPassword : previous.newPassword,
      newPasswordConfirm: passwordTouched.newPasswordConfirm
        ? nextAllErrors.newPasswordConfirm
        : previous.newPasswordConfirm,
    }));
  };

  const handleChooseProfileImage = () => {
    fileInputRef.current?.click();
  };

  const handleProfileImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_PROFILE_IMAGE_MIME_TYPES.has(file.type)) {
      setSelectedProfileImageFile(null);
      setProfilePreviewUrl(null);
      event.currentTarget.value = '';
      void showProfileSwal({
        icon: 'warning',
        title: '파일 형식 오류',
        text: '프로필 이미지는 JPG, PNG, WEBP, GIF 형식만 업로드할 수 있습니다.',
      });
      return;
    }

    if (file.size > MAX_PROFILE_IMAGE_SIZE_BYTES) {
      setSelectedProfileImageFile(null);
      setProfilePreviewUrl(null);
      event.currentTarget.value = '';
      void showProfileSwal({
        icon: 'warning',
        title: '파일 크기 오류',
        text: '프로필 이미지는 5MB 이하만 업로드할 수 있습니다.',
      });
      return;
    }

    setSelectedProfileImageFile(file);
    const previewUrl = URL.createObjectURL(file);
    setProfilePreviewUrl(previewUrl);
  };

  const handleCurrentPasswordChange = (value: string) => {
    setCurrentPassword(value);
    updateTouchedPasswordErrors(value, newPassword, newPasswordConfirm);
  };

  const handleNewPasswordChange = (value: string) => {
    setNewPassword(value);
    updateTouchedPasswordErrors(currentPassword, value, newPasswordConfirm);
  };

  const handleNewPasswordConfirmChange = (value: string) => {
    setNewPasswordConfirm(value);
    updateTouchedPasswordErrors(currentPassword, newPassword, value);
  };

  const handlePasswordBlur = (fieldName: PasswordFieldKey) => {
    const nextErrors = getPasswordValidationErrors(currentPassword, newPassword, newPasswordConfirm);
    setPasswordTouched((previous) => ({ ...previous, [fieldName]: true }));
    setPasswordErrors((previous) => ({ ...previous, [fieldName]: nextErrors[fieldName] }));
  };

  const togglePasswordVisibility = (fieldName: PasswordFieldKey) => {
    setPasswordVisibility((previous) => ({
      ...previous,
      [fieldName]: !previous[fieldName],
    }));
  };

  const handleCancel = () => {
    setName(initialValues.name);
    setEmail(initialValues.email);
    setPhoneNumber(initialValues.phoneNumber);
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setPasswordErrors({
      currentPassword: null,
      newPassword: null,
      newPasswordConfirm: null,
    });
    setPasswordTouched({
      currentPassword: false,
      newPassword: false,
      newPasswordConfirm: false,
    });
    setProfilePreviewUrl(null);
    setSelectedProfileImageFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await fetch(`${API_BASE_URL}/auth/sign-out`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.replace('/sign-in');
    }
  };

  const handleProfileCardClick = () => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setIsProfileMenuOpen(false);
      return;
    }

    setIsProfileMenuOpen((previous) => !previous);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const hasProfileInfoChanges =
      trimmedName !== initialValues.name || normalizedEmail !== initialValues.email.trim().toLowerCase();
    const hasProfileImageChanges = Boolean(selectedProfileImageFile);
    const hasPasswordChanges = Boolean(currentPassword || newPassword || newPasswordConfirm);

    if (!trimmedName || !normalizedEmail) {
      await showProfileSwal({
        icon: 'warning',
        title: '입력 확인',
        text: '성함과 이메일을 입력해주세요.',
      });
      return;
    }

    if (trimmedName.length < 2 || trimmedName.length > 100) {
      await showProfileSwal({
        icon: 'warning',
        title: '입력 확인',
        text: '이름은 2자 이상 100자 이하로 입력해주세요.',
      });
      return;
    }

    if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 191) {
      await showProfileSwal({
        icon: 'warning',
        title: '입력 확인',
        text: '이메일 형식이 올바르지 않습니다.',
      });
      return;
    }

    if (hasPasswordChanges) {
      const nextPasswordErrors = getPasswordValidationErrors(currentPassword, newPassword, newPasswordConfirm);
      setPasswordTouched({
        currentPassword: true,
        newPassword: true,
        newPasswordConfirm: true,
      });
      setPasswordErrors(nextPasswordErrors);

      const firstPasswordError = Object.values(nextPasswordErrors).find((errorMessage) => Boolean(errorMessage));
      if (firstPasswordError) {
        await showProfileSwal({
          icon: 'warning',
          title: '입력 확인',
          text: firstPasswordError,
        });
        return;
      }
    }

    if (!hasProfileInfoChanges && !hasProfileImageChanges && !hasPasswordChanges) {
      await showProfileSwal({
        icon: 'info',
        title: '변경사항 없음',
        text: '변경된 내용이 없습니다.',
      });
      return;
    }

    setSaving(true);
    try {
      let profileInfoUpdated = false;
      let profileImageUpdated = false;
      let passwordUpdated = false;

      if (hasProfileInfoChanges) {
        const profileResponse = await fetch(`${API_BASE_URL}/app/users/me`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: trimmedName,
            email: normalizedEmail,
          }),
        });

        const profileData = (await profileResponse.json().catch(() => ({}))) as ProfileResponse;
        if (!profileResponse.ok) {
          await showProfileSwal({
            icon: 'error',
            title: '저장 실패',
            text: profileData.message || '프로필 저장에 실패했습니다.',
          });
          return;
        }

        const updatedName = (profileData.user?.name || trimmedName).trim();
        const updatedEmail = (profileData.user?.email || normalizedEmail).trim().toLowerCase();
        setName(updatedName);
        setEmail(updatedEmail);
        setInitialValues((current) => ({
          ...current,
          name: updatedName,
          email: updatedEmail,
        }));
        profileInfoUpdated = true;
      }

      if (hasPasswordChanges) {
        const passwordResponse = await fetch(`${API_BASE_URL}/app/users/me/password`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            newPasswordConfirm,
          }),
        });

        const passwordData = (await passwordResponse.json().catch(() => ({}))) as ProfileResponse;
        if (!passwordResponse.ok) {
          await showProfileSwal({
            icon: 'error',
            title: '저장 실패',
            text: passwordData.message || '비밀번호 변경에 실패했습니다.',
          });
          return;
        }

        passwordUpdated = true;
        setCurrentPassword('');
        setNewPassword('');
        setNewPasswordConfirm('');
        setPasswordErrors({
          currentPassword: null,
          newPassword: null,
          newPasswordConfirm: null,
        });
        setPasswordTouched({
          currentPassword: false,
          newPassword: false,
          newPasswordConfirm: false,
        });
      }

      if (hasProfileImageChanges && selectedProfileImageFile) {
        const formData = new FormData();
        formData.append('profileImage', selectedProfileImageFile);

        const imageResponse = await fetch(`${API_BASE_URL}/app/users/me/profile-image`, {
          method: 'PUT',
          credentials: 'include',
          body: formData,
        });

        const imageData = (await imageResponse.json().catch(() => ({}))) as ProfileResponse;
        if (!imageResponse.ok) {
          await showProfileSwal({
            icon: 'error',
            title: '저장 실패',
            text: imageData.message || '프로필 이미지 저장에 실패했습니다.',
          });
          return;
        }

        if (typeof imageData.user?.profileImageUrl === 'string' && imageData.user.profileImageUrl.trim()) {
          setProfileImageUrl(imageData.user.profileImageUrl.trim());
        }
        setProfilePreviewUrl(null);
        setSelectedProfileImageFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        profileImageUpdated = true;
      }

      await showProfileSwal({
        icon: 'success',
        title: '저장 완료',
        text: (() => {
          const savedTargets = [
            profileInfoUpdated ? '기본 정보' : null,
            passwordUpdated ? '비밀번호' : null,
            profileImageUpdated ? '프로필 이미지' : null,
          ].filter(Boolean) as string[];

          if (savedTargets.length === 0) return '변경사항이 저장되었습니다.';
          if (savedTargets.length === 1) return `${savedTargets[0]}가 저장되었습니다.`;
          if (savedTargets.length === 2) return `${savedTargets[0]}와 ${savedTargets[1]}가 저장되었습니다.`;
          return `${savedTargets[0]}, ${savedTargets[1]}와 ${savedTargets[2]}가 저장되었습니다.`;
        })(),
      });
    } catch {
      await showProfileSwal({
        icon: 'error',
        title: '요청 실패',
        text: '네트워크 상태를 확인 후 다시 시도해주세요.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] px-4">
        <p className="text-sm font-semibold text-[#595c5e]">프로필 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  const displayProfileImageUrl = profilePreviewUrl || profileImageUrl || DEFAULT_PROFILE_IMAGE_URL;
  const isAcademyManager = userRole === 'academy' || userRole === 'mentor';
  const isStudentUser = userRole === 'student';
  const friendsMenuLabel = isAcademyManager ? '학생관리' : '친구';
  const friendsMenuIcon = isAcademyManager ? 'supervisor_account' : 'person';
  const showRewardsMenu = !isAcademyManager;
  const showScheduleMenu = isStudentUser;
  const attendanceMenuLabel = isStudentUser ? '출석' : '출석 관리';
  const displayUserName = name
    ? isAcademyManager
      ? `${name}${name.endsWith('학원관리자') ? '' : ' 학원관리자'}`
      : `${name}${name.endsWith('학생') ? '' : ' 학생'}`
    : '사용자';

  return (
    <>
      <Head>
        <title>프로필 설정 - SPO: STUDY &amp; EARN</title>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="profile-settings-page">
        <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <button
            type="button"
            className="toggle-btn"
            onClick={() => setSidebarCollapsed((previous) => !previous)}
            aria-label="Toggle sidebar"
          >
            <span className="material-symbols-outlined text-sm">
              {sidebarCollapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>

          <Link href="/main" className="brand-section flex-row">
            <div className="brand-icon">
              <span className="material-symbols-outlined filled">school</span>
            </div>
            <div className="brand-text nowrap">
              <h1 className="brand-title">SPO</h1>
              <p className="brand-subtitle">Study &amp; Earn</p>
            </div>
          </Link>

          <nav className="nav-list">
            <Link className="nav-item" href="/main">
              <span className="material-symbols-outlined">dashboard</span>
              <span className="nav-text nowrap">대시보드</span>
            </Link>
            {isAcademyManager ? (
              <>
                <div className="nav-item nav-item-static" role="presentation">
                  <span className="material-symbols-outlined">groups</span>
                  <span className="nav-text nowrap">스터디</span>
                </div>
                <div className="academy-subnav">
                  <Link className="academy-subnav-item" href="/study-room">
                    <span className="academy-subnav-dot" />
                    <span className="academy-subnav-text">스터디 관리</span>
                  </Link>
                  <Link className="academy-subnav-item" href="/academy-management?section=recruitment">
                    <span className="academy-subnav-dot" />
                    <span className="academy-subnav-text">스터디 공고 관리</span>
                  </Link>
                </div>
                <Link className="nav-item" href="/academy-management?section=notice">
                  <span className="material-symbols-outlined">campaign</span>
                  <span className="nav-text nowrap">공지사항</span>
                </Link>
                <Link className="nav-item" href="/friends">
                  <span className="material-symbols-outlined">{friendsMenuIcon}</span>
                  <span className="nav-text nowrap">{friendsMenuLabel}</span>
                </Link>
              </>
            ) : (
              <>
                <Link className="nav-item" href="/study-room">
                  <span className="material-symbols-outlined">groups</span>
                  <span className="nav-text nowrap">스터디룸</span>
                </Link>
                <Link className="nav-item" href="/attendance-management">
                  <span className="material-symbols-outlined">fact_check</span>
                  <span className="nav-text nowrap">{attendanceMenuLabel}</span>
                </Link>
                {showScheduleMenu ? (
                  <Link className="nav-item" href="/schedule-management">
                    <span className="material-symbols-outlined">calendar_month</span>
                    <span className="nav-text nowrap">일정 관리</span>
                  </Link>
                ) : null}
                <Link className="nav-item" href="/friends">
                  <span className="material-symbols-outlined">{friendsMenuIcon}</span>
                  <span className="nav-text nowrap">{friendsMenuLabel}</span>
                </Link>
                {showRewardsMenu ? (
                  <Link className="nav-item" href="/rewards">
                    <span className="material-symbols-outlined">workspace_premium</span>
                    <span className="nav-text nowrap">리워드</span>
                  </Link>
                ) : null}
              </>
            )}
            <Link className="nav-item nav-item-active" href="/profile/settings">
              <span className="material-symbols-outlined">settings</span>
              <span className="nav-text nowrap">설정</span>
            </Link>
          </nav>

          <div className="profile-section" ref={profileSectionRef}>
            <button
              type="button"
              className="profile-card profile-card-user profile-card-button"
              onClick={handleProfileCardClick}
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
            >
              <img
                alt="User profile avatar"
                className="profile-image"
                src={displayProfileImageUrl}
                onError={(event) => {
                  event.currentTarget.src = DEFAULT_PROFILE_IMAGE_URL;
                }}
              />
              <div className="profile-info-wrap">
                <p className="profile-name">{displayUserName}</p>
                <p className="profile-tier">{loginId ? `ID: ${loginId}` : 'ID: -'}</p>
              </div>
              <span className="material-symbols-outlined profile-expand-icon">
                {isProfileMenuOpen ? 'expand_more' : 'expand_less'}
              </span>
            </button>

            {isProfileMenuOpen ? (
              <div className="profile-menu" role="menu">
                <button
                  type="button"
                  className="profile-menu-item profile-menu-item-danger"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                >
                  <span className="material-symbols-outlined profile-menu-icon">logout</span>
                  <span>{isSigningOut ? '로그아웃 중...' : '로그아웃'}</span>
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className={`profile-settings-main ${sidebarCollapsed ? 'profile-settings-main-expanded' : ''}`}>
          <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-end bg-[#f5f6f8]/70 px-8 backdrop-blur-xl">
            <div className="flex items-center gap-6">
              <NotificationBell />
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white bg-[#e0e3e5]">
                <img
                  className="h-full w-full object-cover"
                  src={displayProfileImageUrl}
                  alt="User profile avatar"
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_PROFILE_IMAGE_URL;
                  }}
                />
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-5xl p-8">
            <header className="mb-6">
              <h1 className="text-3xl font-black tracking-tight text-slate-900">프로필 설정</h1>
            </header>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
              <div className="space-y-8 md:col-span-8">
                <section className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
                  <div className="mb-8 flex items-center gap-3">
                    <div className="h-6 w-2 rounded-full bg-[#004be2]" />
                    <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold tracking-tight">기본 정보</h2>
                  </div>

                  <div className="mb-8 flex flex-col items-start gap-10 border-b border-[#eff1f3] pb-8 md:flex-row md:items-center">
                    <div className="group relative">
                      <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-[#eff1f3]">
                        <img
                          alt="Avatar"
                          className="h-full w-full object-cover transition-transform group-hover:scale-110"
                          src={displayProfileImageUrl}
                          onError={(event) => {
                            event.currentTarget.src = DEFAULT_PROFILE_IMAGE_URL;
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleChooseProfileImage}
                        className="absolute bottom-0 right-0 rounded-full border-4 border-white bg-[#004be2] p-2 text-white shadow-lg transition-colors hover:bg-[#0041c7]"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        className="hidden"
                        onChange={handleProfileImageChange}
                      />
                    </div>
                    <div className="flex-grow space-y-1">
                      <h3 className="font-['Plus_Jakarta_Sans'] text-lg font-bold">프로필 사진 수정</h3>
                      <p className="text-sm text-[#595c5e]">
                        PNG 또는 JPG 형식 (최대 5MB).
                        <br />
                        권장 사이즈는 400x400px 입니다.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">성함</label>
                      <input
                        className="w-full rounded-2xl border-none bg-[#eff1f3] px-4 py-3.5 font-medium transition-all focus:ring-2 focus:ring-[#004be2]/40"
                        placeholder="성함을 입력하세요"
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">아이디</label>
                      <input
                        className="w-full cursor-not-allowed rounded-2xl border-none bg-[#e7e8e9] px-4 py-3.5 font-medium text-[#595c5e]"
                        type="text"
                        value={loginId}
                        readOnly
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">연락처</label>
                      <input
                        className="w-full cursor-not-allowed rounded-2xl border-none bg-[#e7e8e9] px-4 py-3.5 font-medium text-[#595c5e]"
                        placeholder="010-0000-0000"
                        type="text"
                        value={phoneNumber}
                        readOnly
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">이메일</label>
                      <div className="relative">
                        <input
                          className="w-full rounded-2xl border-none bg-[#eff1f3] px-4 py-3.5 pr-12 font-medium transition-all focus:ring-2 focus:ring-[#004be2]/40"
                          placeholder="email@example.com"
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                        />
                        {email ? (
                          <span
                            className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-[#004be2]"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                          >
                            check_circle
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
                  <div className="mb-8 flex items-center gap-3">
                    <div className="h-6 w-2 rounded-full bg-[#004be2]" />
                    <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold tracking-tight">계정 보안</h2>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">현재 비밀번호</label>
                        <div className="relative">
                          <input
                            className={`w-full rounded-2xl border-none bg-[#eff1f3] px-4 py-3.5 pr-12 font-medium transition-all focus:ring-2 focus:ring-[#004be2]/40 ${
                              passwordTouched.currentPassword && passwordErrors.currentPassword
                                ? 'ring-2 ring-[#ef4444]/30'
                                : ''
                            }`}
                            placeholder="••••••••"
                            type={passwordVisibility.currentPassword ? 'text' : 'password'}
                            value={currentPassword}
                            onChange={(event) => handleCurrentPasswordChange(event.target.value)}
                            onBlur={() => handlePasswordBlur('currentPassword')}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('currentPassword')}
                            className="absolute inset-y-0 right-0 flex items-center px-4 text-[#757779] transition-colors hover:text-[#004be2]"
                            aria-label={passwordVisibility.currentPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                            title={passwordVisibility.currentPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                          >
                            <span className="material-symbols-outlined text-[20px] leading-none">
                              {passwordVisibility.currentPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                        {passwordTouched.currentPassword && passwordErrors.currentPassword ? (
                          <p className="ml-1 text-xs font-semibold text-[#ef4444]">
                            {passwordErrors.currentPassword}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">새 비밀번호</label>
                        <div className="relative">
                          <input
                            className={`w-full rounded-2xl border-none bg-[#eff1f3] px-4 py-3.5 pr-12 font-medium transition-all focus:ring-2 focus:ring-[#004be2]/40 ${
                              passwordTouched.newPassword && passwordErrors.newPassword
                                ? 'ring-2 ring-[#ef4444]/30'
                                : ''
                            }`}
                            placeholder="최소 8자 이상"
                            type={passwordVisibility.newPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(event) => handleNewPasswordChange(event.target.value)}
                            onBlur={() => handlePasswordBlur('newPassword')}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('newPassword')}
                            className="absolute inset-y-0 right-0 flex items-center px-4 text-[#757779] transition-colors hover:text-[#004be2]"
                            aria-label={passwordVisibility.newPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                            title={passwordVisibility.newPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                          >
                            <span className="material-symbols-outlined text-[20px] leading-none">
                              {passwordVisibility.newPassword ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                        {passwordTouched.newPassword && passwordErrors.newPassword ? (
                          <p className="ml-1 text-xs font-semibold text-[#ef4444]">{passwordErrors.newPassword}</p>
                        ) : null}
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="ml-1 text-sm font-semibold text-[#2c2f31]/70">새 비밀번호 확인</label>
                        <div className="relative">
                          <input
                            className={`w-full rounded-2xl border-none bg-[#eff1f3] px-4 py-3.5 pr-12 font-medium transition-all focus:ring-2 focus:ring-[#004be2]/40 ${
                              passwordTouched.newPasswordConfirm && passwordErrors.newPasswordConfirm
                                ? 'ring-2 ring-[#ef4444]/30'
                                : ''
                            }`}
                            placeholder="새 비밀번호를 다시 입력하세요"
                            type={passwordVisibility.newPasswordConfirm ? 'text' : 'password'}
                            value={newPasswordConfirm}
                            onChange={(event) => handleNewPasswordConfirmChange(event.target.value)}
                            onBlur={() => handlePasswordBlur('newPasswordConfirm')}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('newPasswordConfirm')}
                            className="absolute inset-y-0 right-0 flex items-center px-4 text-[#757779] transition-colors hover:text-[#004be2]"
                            aria-label={passwordVisibility.newPasswordConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
                            title={passwordVisibility.newPasswordConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
                          >
                            <span className="material-symbols-outlined text-[20px] leading-none">
                              {passwordVisibility.newPasswordConfirm ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                        {passwordTouched.newPasswordConfirm && passwordErrors.newPasswordConfirm ? (
                          <p className="ml-1 text-xs font-semibold text-[#ef4444]">
                            {passwordErrors.newPasswordConfirm}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <p className="flex items-center gap-1 text-xs text-[#595c5e]">
                      <span className="material-symbols-outlined text-sm">info</span>
                      비밀번호는 영문, 숫자, 특수문자를 포함하여 8~72자로 설정해 주세요.
                    </p>
                  </div>
                </section>

                <div className="flex items-center justify-end gap-4 pb-12 pt-4">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="rounded-2xl bg-[#e0e3e5] px-8 py-4 text-sm font-bold text-[#2c2f31] transition-all active:scale-95 hover:bg-[#dadde0]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-2xl bg-[#004be2] px-10 py-4 text-sm font-bold text-[#f2f1ff] shadow-[0_15px_40px_-10px_rgba(0,75,226,0.3)] transition-all active:scale-95 hover:bg-[#0041c7] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? '저장 중...' : '변경사항 저장'}
                  </button>
                </div>
              </div>

              <div className="space-y-6 md:col-span-4">
                <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                  <h4 className="mb-4 flex items-center gap-2 text-sm font-bold">
                    <span className="material-symbols-outlined text-lg text-[#004be2]">help</span>
                    도움이 필요하신가요?
                  </h4>
                  <ul className="space-y-3">
                    <li>
                      <a className="group flex items-center justify-between" href="#">
                        <span className="text-xs text-[#595c5e] transition-colors group-hover:text-[#004be2]">
                          자주 묻는 질문
                        </span>
                        <span className="material-symbols-outlined text-xs text-[#595c5e]/40 transition-all group-hover:translate-x-1">
                          arrow_forward_ios
                        </span>
                      </a>
                    </li>
                    <li>
                      <a className="group flex items-center justify-between" href="#">
                        <span className="text-xs text-[#595c5e] transition-colors group-hover:text-[#004be2]">
                          1:1 문의하기
                        </span>
                        <span className="material-symbols-outlined text-xs text-[#595c5e]/40 transition-all group-hover:translate-x-1">
                          arrow_forward_ios
                        </span>
                      </a>
                    </li>
                    <li>
                      <a className="group flex items-center justify-between" href="#">
                        <span className="text-xs text-[#595c5e] transition-colors group-hover:text-[#004be2]">
                          서비스 이용 가이드
                        </span>
                        <span className="material-symbols-outlined text-xs text-[#595c5e]/40 transition-all group-hover:translate-x-1">
                          arrow_forward_ios
                        </span>
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
