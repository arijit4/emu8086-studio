import { ExternalLink, PackageOpen, X } from "lucide-react";
import { RELEASES_URL, type GitHubRelease } from "../update";

interface Props {
  release: GitHubRelease | null;
  onDismiss: () => void;
}

export default function UpdateNotice({ release, onDismiss }: Props) {
  if (!release) return null;

  const dismiss = onDismiss;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="relative w-full max-w-md rounded-2xl border border-emerald-400/25 bg-[#0d1015]/95 p-5 shadow-2xl shadow-black/70"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Dismiss update notice"
          className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <X size={15} />
        </button>
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
            <PackageOpen size={17} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400/80">Update available</p>
            <h2 id="update-title" className="font-display text-lg font-semibold text-zinc-100">
              A newer version is ready
            </h2>
          </div>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-zinc-400">
          {release.name || release.tag_name} is available on GitHub Releases.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={dismiss}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            Later
          </button>
          <a
            href={release.html_url || RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            onClick={dismiss}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
          >
            View release
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
