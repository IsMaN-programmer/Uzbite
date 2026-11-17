import { SERVICE_ZONES, type Language } from '@uzbite/shared';

const currency: Record<Language, string> = { ru: 'сум', uz: 'so‘m', en: 'UZS' };
/** 125000 → "125 000 сум"; no Intl dependency so it formats the same on every engine. */
export function money(value: number | null | undefined, language: Language) {
  if (value === null || value === undefined) return '—';
  const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${value < 0 ? '−' : ''}${grouped}${fraction && fraction !== '00' ? `,${fraction}` : ''}\u00a0${currency[language]}`;
}
const pad = (value: number) => String(value).padStart(2, '0');
export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const time = (iso: string | null | undefined) => { if (!iso) return '—'; const date = new Date(iso); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };
/** Seconds → "m:ss". */
export const countdown = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${pad(Math.max(0, seconds) % 60)}`;
export function zoneName(code: string | null | undefined, language: Language) {
  if (!code) return '';
  return SERVICE_ZONES.find(zone => zone.code === code)?.name[language] ?? code;
}
export const initials = (first: string, last: string) => `${first.trim()[0] ?? ''}${last.trim()[0] ?? ''}`.toUpperCase() || 'U';
