import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const hex = (v: number, w = 4): string =>
  (v & (w === 2 ? 0xff : w === 4 ? 0xffff : 0xfffff)).toString(16).toUpperCase().padStart(w, "0");

export const dec = (v: number): string => (v & 0xffff).toString(10);

export const bin = (v: number, w = 16): string =>
  (v & (w === 8 ? 0xff : 0xffff)).toString(2).padStart(w, "0");

export const fmtCount = (v: number): string => v.toLocaleString("en-US");

export const fmtSpeed = (s: number): string => {
  if (s <= 1) return "1 op/s";
  if (s < 1000) return `${s} op/s`;
  if (s < 1e6) return `${s / 1000}k op/s`;
  return "MAX";
};

export function groupBin(v: number, w = 16): string {
  const b = bin(v, w);
  return b.replace(/(\d{4})(?=\d)/g, "$1 ");
}
