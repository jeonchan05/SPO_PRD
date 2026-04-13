import Swal, { SweetAlertIcon, SweetAlertOptions } from 'sweetalert2';

const SPO_SWAL_BASE_OPTIONS: SweetAlertOptions = {
  allowOutsideClick: false,
  backdrop: 'rgba(15, 23, 42, 0.45)',
  background: '#ffffff',
  color: '#0f172a',
  customClass: {
    popup: 'rounded-3xl border border-slate-100 shadow-2xl',
    title: 'text-[22px] font-extrabold tracking-tight',
    htmlContainer: 'text-sm font-medium text-slate-600',
    input: 'rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-semibold text-slate-800 focus:ring-4 focus:ring-blue-100',
    actions: 'mt-8 flex items-center justify-center gap-3',
    confirmButton:
      '!inline-flex !min-w-[148px] !justify-center !rounded-full !px-6 !py-3 text-base font-extrabold shadow-[0_12px_24px_rgba(37,99,235,0.25)] transition-transform duration-150 hover:!-translate-y-0.5',
    cancelButton:
      'inline-flex !min-w-[120px] !justify-center !rounded-full !border !border-slate-200 !bg-slate-100 !px-6 !py-3 text-base font-bold !text-slate-700 transition-colors duration-150 hover:!bg-slate-200',
  },
};

export const fireSpoSwal = (options: SweetAlertOptions = {}) => {
  const showCancelButton = Boolean(options.showCancelButton);
  const normalizedCancelButtonText =
    showCancelButton && (!options.cancelButtonText || !String(options.cancelButtonText).trim())
      ? '취소'
      : options.cancelButtonText;

  return Swal.fire({
    ...SPO_SWAL_BASE_OPTIONS,
    ...options,
    cancelButtonText: normalizedCancelButtonText,
    customClass: {
      ...SPO_SWAL_BASE_OPTIONS.customClass,
      ...options.customClass,
    },
  } as any);
};

type SpoNoticeOptions = {
  icon: SweetAlertIcon;
  title: string;
  text: string;
  confirmButtonText?: string;
  confirmButtonColor?: string;
  allowOutsideClick?: boolean;
};

export const fireSpoNotice = async ({
  icon,
  title,
  text,
  confirmButtonText = '확인',
  confirmButtonColor = '#2563eb',
  allowOutsideClick = false,
}: SpoNoticeOptions) => {
  await fireSpoSwal({
    icon,
    title,
    text,
    confirmButtonText,
    confirmButtonColor,
    allowOutsideClick,
  });
};
