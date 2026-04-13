"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { fireSpoNotice, fireSpoSwal } from "@/lib/ui/swal";

type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "tel" | "file" | "checkbox" | "textarea" | "segmented";
  placeholder?: string;
  accept?: string;
  options?: Array<{
    label: string;
    value: string;
  }>;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  visibleWhen?: {
    field: string;
    equals: string;
  };
};

type ResultField = {
  key: string;
  label: string;
  format?: "datetime";
};

type AuthFormProps = {
  title: string;
  description: string;
  endpoint: string;
  buttonText: string;
  fields: Field[];
  initialValues: Record<string, string>;
  resultFields?: ResultField[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || "/api";
const SIGN_UP_ENDPOINT = "/auth/sign-up";
const LOGIN_ID_REGEX = /^[a-z0-9._-]{4,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_NUMBER_REGEX = /^\+?[0-9]{7,20}$/;

type LoginIdCheckState = {
  status: "idle" | "checking" | "available" | "taken" | "error";
  checkedValue: string;
  message: string | null;
};

const SIGN_UP_FIELD_ORDER = [
  "userType",
  "name",
  "loginId",
  "email",
  "password",
  "passwordConfirm",
  "phoneNumber",
  "academyName",
  "businessRegistrationNumber",
  "academyAddress",
  "termsAgreed",
] as const;

const TERMS_EFFECTIVE_DATE = "2026-04-10";

const isAgreed = (value: string | undefined) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes";
};

const formatValue = (value: unknown, format?: "datetime") => {
  if (value == null || value === "") return "-";
  if (format === "datetime") {
    return new Date(String(value)).toLocaleString("ko-KR");
  }
  return String(value);
};

const normalizeLoginId = (value: string) => value.trim().toLowerCase();
const normalizePhoneNumber = (value: string) => value.replace(/[()\s-]/g, "");
const normalizeBusinessRegistrationNumber = (value: string) => value.replace(/[^0-9]/g, "");

const readJsonSafely = async (response: Response) => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pickMessage = (data: Record<string, unknown>, fallback: string) => {
  const message = data.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

const fallbackMessageByStatus = (status: number, successMessage: string, failMessage: string) => {
  if (status >= 200 && status < 300) return successMessage;
  if (status === 413) return "업로드 파일 용량이 너무 큽니다. 5MB 이하 이미지를 업로드해주세요.";
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  return failMessage;
};

const showSwalPopup = async ({
  icon,
  title,
  text,
  confirmButtonText,
  confirmButtonColor,
}: {
  icon: "success" | "error";
  title: string;
  text: string;
  confirmButtonText: string;
  confirmButtonColor: string;
}) => {
  await fireSpoNotice({
    icon,
    title,
    text,
    confirmButtonText,
    confirmButtonColor,
    allowOutsideClick: false,
  });
};

const showTermsSwal = async () => {
  await fireSpoSwal({
    title: "SPO 회원가입 약관",
    html: `
      <div style="text-align:left;max-height:60vh;overflow-y:auto;padding-right:4px;line-height:1.65;">
        <section style="margin-bottom:16px;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">1. 서비스 이용약관</h3>
          <p style="margin:0 0 6px 0;">시행일: ${TERMS_EFFECTIVE_DATE}</p>
          <p style="margin:0 0 6px 0;">SPO는 스터디 운영, 출석 관리, 학습 활동 기록을 위한 서비스입니다.</p>
          <p style="margin:0;">회원은 정확한 정보를 입력해야 하며, 계정 보안 책임은 회원 본인에게 있습니다.</p>
        </section>
        <section style="margin-bottom:16px;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">2. 수집하는 정보</h3>
          <p style="margin:0 0 6px 0;">필수: 이름, 아이디, 이메일, 비밀번호(평문 미저장, 해시 저장), 약관 동의 여부</p>
          <p style="margin:0 0 6px 0;">선택: 전화번호, 프로필 이미지</p>
          <p style="margin:0;">인증/보안: 로그인 시 JWT 인증 쿠키, 접속 IP, User-Agent, 요청 시각 로그</p>
        </section>
        <section style="margin-bottom:16px;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">3. 이용 목적</h3>
          <p style="margin:0;">회원 식별, 계정 인증, 스터디 서비스 제공, 부정 이용 방지, 장애 대응 및 보안 감사</p>
        </section>
        <section style="margin-bottom:16px;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">4. 저장 위치 및 처리 위탁</h3>
          <p style="margin:0 0 6px 0;">회원 데이터는 SPO 서비스 DB(MySQL)에 저장됩니다.</p>
          <p style="margin:0;">프로필 이미지는 외부 오브젝트 스토리지에 저장되며 서비스 제공 목적 내에서만 사용됩니다.</p>
        </section>
        <section style="margin-bottom:16px;">
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">5. 보관 및 파기</h3>
          <p style="margin:0 0 6px 0;">회원정보는 계정 유지 기간 동안 보관되며, 탈퇴 또는 삭제 요청 시 지체 없이 파기합니다.</p>
          <p style="margin:0;">법령상 보존 의무가 있는 정보는 해당 기간 동안 별도 보관 후 파기합니다.</p>
        </section>
        <section>
          <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#0f172a;">6. 이용자 권리</h3>
          <p style="margin:0 0 6px 0;">이용자는 본인 정보에 대해 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.</p>
          <p style="margin:0;">필수 약관 동의 거부 시 회원가입 및 서비스 이용이 제한됩니다.</p>
        </section>
      </div>
    `,
    confirmButtonText: "확인",
    confirmButtonColor: "#2563eb",
    allowOutsideClick: true,
    width: 760,
  });
};

export default function AuthForm({
  title,
  description,
  endpoint,
  buttonText,
  fields,
  initialValues,
  resultFields = [],
}: AuthFormProps) {
  const [formValues, setFormValues] = useState<Record<string, string>>(initialValues);
  const [fileValues, setFileValues] = useState<Record<string, File | null>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [loginIdCheck, setLoginIdCheck] = useState<LoginIdCheckState>({
    status: "idle",
    checkedValue: "",
    message: null,
  });

  const actionUrl = useMemo(() => `${API_BASE_URL}${endpoint}`, [endpoint]);
  const isSignUpForm = endpoint === SIGN_UP_ENDPOINT;
  const isSignInForm = endpoint === "/auth/sign-in";
  const [passwordVisibility, setPasswordVisibility] = useState<Record<string, boolean>>({});
  const visibleFields = useMemo(
    () =>
      fields.filter((field) => {
        if (!field.visibleWhen) return true;
        return String(formValues[field.visibleWhen.field] || "") === field.visibleWhen.equals;
      }),
    [fields, formValues],
  );

  const togglePasswordVisibility = (fieldName: string) => {
    setPasswordVisibility((current) => ({
      ...current,
      [fieldName]: !current[fieldName],
    }));
  };

  const validateSignUpField = (fieldName: string, values: Record<string, string>) => {
    const userType = String(values.userType || "student").trim().toLowerCase();
    const name = (values.name || "").trim();
    const loginId = normalizeLoginId(values.loginId || "");
    const email = (values.email || "").trim().toLowerCase();
    const password = values.password || "";
    const passwordConfirm = values.passwordConfirm || "";
    const phoneNumber = normalizePhoneNumber(values.phoneNumber || "");
    const academyName = (values.academyName || "").trim();
    const academyAddress = (values.academyAddress || "").trim();
    const businessRegistrationNumber = normalizeBusinessRegistrationNumber(values.businessRegistrationNumber || "");

    switch (fieldName) {
      case "userType":
        if (userType !== "student" && userType !== "academy") {
          return "가입 유형을 선택해주세요.";
        }
        return null;
      case "name":
        if (!name) return "이름을 입력해주세요.";
        return null;
      case "loginId":
        if (!loginId) return "아이디를 입력해주세요.";
        if (!LOGIN_ID_REGEX.test(loginId)) {
          return "아이디는 영문 소문자/숫자/._- 조합의 4~30자여야 합니다.";
        }
        return null;
      case "email":
        if (!email) return "이메일을 입력해주세요.";
        if (!EMAIL_REGEX.test(email)) return "이메일 형식이 올바르지 않습니다.";
        return null;
      case "password":
        if (!password) return "비밀번호를 입력해주세요.";
        if (password.length < 8) return "비밀번호는 8자 이상 입력해주세요.";
        if (password.length > 72) return "비밀번호는 72자 이하로 입력해주세요.";
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          return "비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.";
        }
        return null;
      case "passwordConfirm":
        if (!passwordConfirm) return "비밀번호 확인을 입력해주세요.";
        if (password !== passwordConfirm) return "비밀번호 확인이 일치하지 않습니다.";
        return null;
      case "phoneNumber":
        if (phoneNumber && !PHONE_NUMBER_REGEX.test(phoneNumber)) {
          return "전화번호 형식이 올바르지 않습니다.";
        }
        return null;
      case "academyName":
        if (userType === "academy" && !academyName) return "학원명을 입력해주세요.";
        return null;
      case "businessRegistrationNumber":
        if (userType !== "academy") return null;
        if (businessRegistrationNumber.length !== 10) return "사업자번호는 숫자 10자리로 입력해주세요.";
        return null;
      case "academyAddress":
        if (userType === "academy" && !academyAddress) return "학원 주소를 입력해주세요.";
        return null;
      case "termsAgreed":
        if (!isAgreed(values.termsAgreed)) {
          return "이용약관 및 개인정보 수집·이용에 동의해주세요.";
        }
        return null;
      default:
        return null;
    }
  };

  const validateSignUpFields = () => {
    const loginId = normalizeLoginId(formValues.loginId || "");
    const nextErrors: Record<string, string | null> = {};

    for (const fieldName of SIGN_UP_FIELD_ORDER) {
      nextErrors[fieldName] = validateSignUpField(fieldName, formValues);
    }

    if (!nextErrors.loginId && (loginIdCheck.status !== "available" || loginIdCheck.checkedValue !== loginId)) {
      nextErrors.loginId = "아이디 중복 확인을 완료해주세요.";
    }

    setFieldErrors((current) => ({
      ...current,
      ...nextErrors,
    }));

    for (const fieldName of SIGN_UP_FIELD_ORDER) {
      const errorMessage = nextErrors[fieldName];
      if (errorMessage) {
        return errorMessage;
      }
    }

    return null;
  };

  const checkLoginIdDuplicate = async (rawLoginId?: string) => {
    const normalizedLoginId = normalizeLoginId(rawLoginId ?? formValues.loginId ?? "");

    if (!normalizedLoginId) {
      setFieldErrors((current) => ({
        ...current,
        loginId: "아이디를 먼저 입력해주세요.",
      }));
      setLoginIdCheck({
        status: "error",
        checkedValue: "",
        message: "아이디를 먼저 입력해주세요.",
      });
      return;
    }

    if (!LOGIN_ID_REGEX.test(normalizedLoginId)) {
      setFieldErrors((current) => ({
        ...current,
        loginId: "아이디는 영문 소문자/숫자/._- 조합의 4~30자여야 합니다.",
      }));
      setLoginIdCheck({
        status: "error",
        checkedValue: "",
        message: "아이디는 영문 소문자/숫자/._- 조합의 4~30자여야 합니다.",
      });
      return;
    }

    setFieldErrors((current) => ({
      ...current,
      loginId: null,
    }));
    setLoginIdCheck({
      status: "checking",
      checkedValue: normalizedLoginId,
      message: "아이디 중복 확인 중...",
    });

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/check-login-id?loginId=${encodeURIComponent(normalizedLoginId)}`,
        {
          method: "GET",
          credentials: "include",
        },
      );
      const data = await readJsonSafely(response);

      if (!response.ok) {
        const errorMessage = pickMessage(data, "아이디 중복 확인에 실패했습니다.");
        setFieldErrors((current) => ({
          ...current,
          loginId: errorMessage,
        }));
        setLoginIdCheck({
          status: "error",
          checkedValue: normalizedLoginId,
          message: errorMessage,
        });
        return;
      }

      const available = Boolean(data.available);
      const statusMessage = pickMessage(data, available ? "사용 가능한 아이디입니다." : "이미 사용 중인 아이디입니다.");
      setFieldErrors((current) => ({
        ...current,
        loginId: available ? null : statusMessage,
      }));
      setLoginIdCheck({
        status: available ? "available" : "taken",
        checkedValue: normalizedLoginId,
        message: statusMessage,
      });
    } catch {
      setFieldErrors((current) => ({
        ...current,
        loginId: "아이디 중복 확인 중 네트워크 오류가 발생했습니다.",
      }));
      setLoginIdCheck({
        status: "error",
        checkedValue: normalizedLoginId,
        message: "아이디 중복 확인 중 네트워크 오류가 발생했습니다.",
      });
    }
  };

  const handleSignUpFieldBlur = async (fieldName: string, rawValue: string) => {
    const nextValues = {
      ...formValues,
      [fieldName]: rawValue,
    };

    const nextErrors: Record<string, string | null> = {
      [fieldName]: validateSignUpField(fieldName, nextValues),
    };

    if (fieldName === "password" || fieldName === "passwordConfirm") {
      nextErrors.password = validateSignUpField("password", nextValues);
      nextErrors.passwordConfirm = validateSignUpField("passwordConfirm", nextValues);
    }

    setFieldErrors((current) => ({
      ...current,
      ...nextErrors,
    }));

    if (fieldName === "loginId" && !nextErrors.loginId) {
      const normalizedLoginId = normalizeLoginId(rawValue);
      if (
        normalizedLoginId &&
        (loginIdCheck.checkedValue !== normalizedLoginId || loginIdCheck.status !== "available")
      ) {
        await checkLoginIdDuplicate(normalizedLoginId);
      }
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsError(false);
    setResult(null);

    if (isSignUpForm) {
      const validationMessage = validateSignUpFields();
      if (validationMessage) {
        setIsError(true);
        setMessage(validationMessage);
        return;
      }
    }

    setLoading(true);

    try {
      const hasFileField = fields.some((field) => field.type === "file");
      const requestBody = hasFileField ? new FormData() : JSON.stringify(formValues);

      if (hasFileField && requestBody instanceof FormData) {
        for (const field of fields) {
          if (field.type === "file") {
            const file = fileValues[field.name];
            if (file) {
              requestBody.append(field.name, file);
            }
            continue;
          }

          requestBody.append(field.name, formValues[field.name] || "");
        }
      }

      const response = await fetch(actionUrl, {
        method: "POST",
        credentials: "include",
        headers: hasFileField
          ? undefined
          : {
              "Content-Type": "application/json",
            },
        body: requestBody,
      });

      const data = await readJsonSafely(response);

      if (response.ok && isSignUpForm) {
        await showSwalPopup({
          icon: "success",
          title: "회원가입 완료",
          text: pickMessage(data, "회원가입이 완료되었습니다."),
          confirmButtonText: "로그인하러 가기",
          confirmButtonColor: "#2563eb",
        });
        window.location.href = "/sign-in";
        return;
      }

      if (isSignInForm) {
        if (response.ok) {
          const role = typeof data.user === "object" && data.user && "role" in data.user ? String(data.user.role || "") : "";
          window.location.href = "/main";
          return;
        }

        await showSwalPopup({
          icon: "error",
          title: "로그인 실패",
          text: "로그인에 실패했습니다.",
          confirmButtonText: "확인",
          confirmButtonColor: "#e11d48",
        });
        return;
      }

      setMessage(
        pickMessage(
          data,
          fallbackMessageByStatus(response.status, "요청이 완료되었습니다.", "요청에 실패했습니다."),
        ),
      );
      setIsError(!response.ok);
      setResult(data);

    } catch (error) {
      if (isSignInForm) {
        await showSwalPopup({
          icon: "error",
          title: "로그인 실패",
          text: "로그인에 실패했습니다.",
          confirmButtonText: "확인",
          confirmButtonColor: "#e11d48",
        });
        return;
      }

      setIsError(true);
      setMessage(error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-10 flex flex-col items-center">
        <div className="group mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full shadow-lg shadow-primary-container/20 transition-transform duration-300 hover:scale-105">
          <Image
            alt="SPO 로고"
            className="h-full w-full scale-110 object-cover"
            height={80}
            priority
            src="/spo-logo.png"
            width={80}
          />
        </div>
        <h1 className="mb-3 text-center font-headline text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="whitespace-pre-line text-center text-sm font-medium text-on-surface-variant">
          {description}
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        {visibleFields.map((field) => (
          <div className="space-y-2" key={field.name}>
            {field.type !== "checkbox" ? (
              <label className="block px-1 text-sm font-semibold text-on-surface/80">
                {field.label}
              </label>
            ) : null}
            {field.type === "checkbox" ? (
              <>
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      checked={isAgreed(formValues[field.name])}
                      className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                      id={field.name}
                      name={field.name}
                      onBlur={(event) => {
                        if (!isSignUpForm) return;
                        void handleSignUpFieldBlur(field.name, event.target.checked ? "true" : "false");
                      }}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setFormValues((current) => ({
                          ...current,
                          [field.name]: checked ? "true" : "false",
                        }));
                        setFieldErrors((current) => ({
                          ...current,
                          [field.name]: null,
                        }));
                      }}
                      type="checkbox"
                    />
                    <label className="cursor-pointer text-sm font-semibold text-primary" htmlFor={field.name}>
                      {field.label}
                    </label>
                    <a
                      className="ml-auto whitespace-nowrap text-sm font-semibold text-primary underline underline-offset-2"
                      href="#terms"
                      onClick={async (event) => {
                        event.preventDefault();
                        await showTermsSwal();
                      }}
                    >
                      약관보기
                    </a>
                  </div>
                </div>
                {isSignUpForm && fieldErrors[field.name] ? (
                  <p className="px-1 text-xs text-red-600">{fieldErrors[field.name]}</p>
                ) : null}
              </>
            ) : field.type === "segmented" ? (
              <>
                <div className="grid grid-cols-2 rounded-xl bg-surface-container-low p-1">
                  {(field.options || []).map((option) => {
                    const selected = (formValues[field.name] || "") === option.value;
                    return (
                      <button
                        key={`${field.name}-${option.value}`}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          selected
                            ? "bg-surface-container-lowest text-primary shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                        onClick={() => {
                          setFormValues((current) => {
                            if (field.name !== "userType") {
                              return {
                                ...current,
                                [field.name]: option.value,
                              };
                            }

                            if (option.value === "student") {
                              return {
                                ...current,
                                userType: option.value,
                                academyName: "",
                                businessRegistrationNumber: "",
                                academyAddress: "",
                              };
                            }

                            return {
                              ...current,
                              userType: option.value,
                            };
                          });
                          setFieldErrors((current) => ({
                            ...current,
                            [field.name]: null,
                            academyName: null,
                            businessRegistrationNumber: null,
                            academyAddress: null,
                          }));
                        }}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {isSignUpForm && fieldErrors[field.name] ? (
                  <p className="px-1 text-xs text-red-600">{fieldErrors[field.name]}</p>
                ) : null}
              </>
            ) : field.type === "file" ? (
              <>
                <input
                  accept={field.accept || "image/*"}
                  className="w-full rounded-xl border-none bg-surface-container-low px-5 py-4 text-sm outline-none transition-all duration-200 file:mr-3 file:rounded-full file:border-0 file:bg-primary-container file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container"
                  name={field.name}
                  onChange={(event) =>
                    setFileValues((current) => ({
                      ...current,
                      [field.name]: event.target.files?.[0] || null,
                    }))
                  }
                  type="file"
                />
                <p className="px-1 text-xs text-on-surface-variant">
                  {fileValues[field.name]?.name || "선택하지 않으면 기본 프로필 이미지가 적용됩니다."}
                </p>
              </>
            ) : field.type === "textarea" ? (
              <>
                <textarea
                  className="min-h-[112px] w-full resize-none rounded-xl border-none bg-surface-container-low px-5 py-4 text-sm outline-none transition-all duration-200 placeholder:text-outline/50 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container"
                  name={field.name}
                  onBlur={(event) => {
                    if (!isSignUpForm) return;
                    void handleSignUpFieldBlur(field.name, event.target.value);
                  }}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setFormValues((current) => ({
                      ...current,
                      [field.name]: nextValue,
                    }));

                    if (!isSignUpForm) return;

                    setFieldErrors((current) => ({
                      ...current,
                      [field.name]: null,
                    }));
                  }}
                  placeholder={field.placeholder}
                  value={formValues[field.name] || ""}
                />
                {isSignUpForm && fieldErrors[field.name] ? (
                  <p className="px-1 text-xs text-red-600">{fieldErrors[field.name]}</p>
                ) : null}
              </>
            ) : (
              <>
                {isSignUpForm && field.name === "loginId" ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="w-full rounded-xl border-none bg-surface-container-low px-5 py-4 text-sm outline-none transition-all duration-200 placeholder:text-outline/50 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container"
                      name={field.name}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        const nextNormalized = normalizeLoginId(nextValue);
                        setFormValues((current) => ({
                          ...current,
                          [field.name]: nextValue,
                        }));

                        if (nextNormalized !== loginIdCheck.checkedValue) {
                          setLoginIdCheck({
                            status: "idle",
                            checkedValue: "",
                            message: null,
                          });
                        }

                        setFieldErrors((current) => ({
                          ...current,
                          loginId: null,
                        }));
                      }}
                      onBlur={(event) => {
                        void handleSignUpFieldBlur(field.name, event.target.value);
                      }}
                      placeholder={field.placeholder}
                      type={field.type || "text"}
                      value={formValues[field.name] || ""}
                    />
                    <button
                      className="min-w-[92px] rounded-xl bg-primary-container px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={loading || loginIdCheck.status === "checking"}
                      onClick={() => {
                        void checkLoginIdDuplicate();
                      }}
                      type="button"
                    >
                      {loginIdCheck.status === "checking" ? "확인중..." : "중복확인"}
                    </button>
                  </div>
                ) : field.type === "password" ? (
                  <div className="relative">
                    <input
                      className="w-full rounded-xl border-none bg-surface-container-low px-5 py-4 pr-12 text-sm outline-none transition-all duration-200 placeholder:text-outline/50 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container"
                      name={field.name}
                      onBlur={(event) => {
                        if (!isSignUpForm) return;
                        void handleSignUpFieldBlur(field.name, event.target.value);
                      }}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setFormValues((current) => ({
                          ...current,
                          [field.name]: nextValue,
                        }));

                        if (!isSignUpForm) return;

                        setFieldErrors((current) => {
                          const nextErrors = {
                            ...current,
                            [field.name]: null,
                          };

                          if (field.name === "password" || field.name === "passwordConfirm") {
                            nextErrors.passwordConfirm = null;
                          }

                          return nextErrors;
                        });
                      }}
                      placeholder={field.placeholder}
                      type={passwordVisibility[field.name] ? "text" : "password"}
                      value={formValues[field.name] || ""}
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility(field.name)}
                      className="absolute inset-y-0 right-0 flex items-center px-4 text-outline transition-colors hover:text-primary"
                      aria-label={passwordVisibility[field.name] ? "비밀번호 숨기기" : "비밀번호 보기"}
                      title={passwordVisibility[field.name] ? "비밀번호 숨기기" : "비밀번호 보기"}
                    >
                      <span className="material-symbols-outlined text-[20px] leading-none">
                        {passwordVisibility[field.name] ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                ) : (
                  <input
                    className="w-full rounded-xl border-none bg-surface-container-low px-5 py-4 text-sm outline-none transition-all duration-200 placeholder:text-outline/50 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-container"
                    name={field.name}
                    onBlur={(event) => {
                      if (!isSignUpForm) return;
                      void handleSignUpFieldBlur(field.name, event.target.value);
                    }}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setFormValues((current) => ({
                        ...current,
                        [field.name]: nextValue,
                      }));

                      if (!isSignUpForm) return;

                      setFieldErrors((current) => {
                        const nextErrors = {
                          ...current,
                          [field.name]: null,
                        };

                        if (field.name === "password" || field.name === "passwordConfirm") {
                          nextErrors.passwordConfirm = null;
                        }

                        return nextErrors;
                      });
                    }}
                    placeholder={field.placeholder}
                    type={field.type || "text"}
                    inputMode={field.inputMode}
                    value={formValues[field.name] || ""}
                  />
                )}
                {isSignUpForm && field.name === "loginId" ? (
                  <p
                    className={`px-1 text-xs ${
                      fieldErrors.loginId || loginIdCheck.status === "taken" || loginIdCheck.status === "error"
                        ? "text-red-600"
                        : loginIdCheck.status === "available"
                        ? "text-emerald-600"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {fieldErrors.loginId || loginIdCheck.message || "아이디는 영문 소문자/숫자/._- 조합 4~30자"}
                  </p>
                ) : isSignUpForm && fieldErrors[field.name] ? (
                  <p className="px-1 text-xs text-red-600">{fieldErrors[field.name]}</p>
                ) : null}
              </>
            )}
          </div>
        ))}

        <button
          className="mt-6 w-full rounded-full bg-gradient-to-r from-primary-container to-primary py-3 font-headline text-base font-bold text-white shadow-lg shadow-primary-container/25 transition-all duration-300 hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "처리 중..." : buttonText}
        </button>
      </form>

      {message ? (
        <div
          className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
            isError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          <p className="font-semibold">{message}</p>
          {!isError && result && resultFields.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {resultFields.map((field) => {
                const rawValue = field.key.includes(".")
                  ? field.key.split(".").reduce<unknown>((acc, key) => {
                      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
                        return (acc as Record<string, unknown>)[key];
                      }
                      return undefined;
                    }, result)
                  : result[field.key];

                return (
                  <li key={field.key}>
                    {field.label}: {formatValue(rawValue, field.format)}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

    </>
  );
}
