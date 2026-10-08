import { useEffect, useState } from "react";
import { ExternalLink, PackageOpen, X } from "lucide-react";
import packageJson from "../../package.json";

const RELEASES_URL = "https://github.com/arijit4/emu8086-studio/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/arijit4/emu8086-studio/releases/latest";
const DISMISSED_RELEASE_KEY = "emu8086.dismissed-release";

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  assets: Array<{ name: string }>;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(value: string): Version | null {
  const match = value.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/i);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function releaseVersion(release: GitHubRelease): Version | null {
  return (
    parseVersion(release.tag_name) ??
    parseVersion(release.name) ??
    release.assets.map((asset) => parseVersion(asset.name)).find((version): version is Version => version !== null) ??
    null
  );
}

function isNewer(candidate: Version, current: Version): boolean {
  if (candidate.major !== current.major) return candidate.major > current.major;
  if (candidate.minor !== current.minor) return candidate.minor > current.minor;
  return candidate.patch > current.patch;
}

export default function UpdateNotice() {
  const [release, setRelease] = useState<GitHubRelease | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const currentVersion = parseVersion(packageJson.version);

    if (!currentVersion) return () => controller.abort();

    const checkForUpdate = async () => {
      try {
        const response = await fetch(LATEST_RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) return;

        const latest = (await response.json()) as GitHubRelease;
        const latestVersion = releaseVersion(latest);
        const dismissedRelease = localStorage.getItem(DISMISSED_RELEASE_KEY);

        if (latestVersion && isNewer(latestVersion, currentVersion) && dismissedRelease !== latest.tag_name) {
          setRelease(latest);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Unable to check for app updates.", error);
        }
      }
    };

    void checkForUpdate();
    return () => controller.abort();
  }, []);

  if (!release) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_RELEASE_KEY, release.tag_name);
    setRelease(null);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="relative w-full max-w-md rounded-2xl border border-emerald-400/25 bg-[#0d1015]/95 p-5 shadow-2xl shadow-black/70"
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
