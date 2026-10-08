import { useCallback, useEffect, useState } from "react";
import packageJson from "../package.json";

export const RELEASES_URL = "https://github.com/arijit4/emu8086-studio/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/arijit4/emu8086-studio/releases/latest";
const DISMISSED_RELEASE_KEY = "emu8086.dismissed-release";

export interface GitHubRelease {
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

export function useUpdateCheck() {
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);

  const checkForUpdate = useCallback(async (openNotice = true) => {
    const currentVersion = parseVersion(packageJson.version);
    if (!currentVersion) {
      setVerdict("Unable to determine the current version.");
      return;
    }

    setChecking(true);
    setVerdict(null);
    try {
      const response = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        setVerdict("Unable to check for updates.");
        return;
      }

      const latest = (await response.json()) as GitHubRelease;
      const latestVersion = releaseVersion(latest);
      if (latestVersion && isNewer(latestVersion, currentVersion)) {
        setRelease(latest);
        setVerdict(`Update available: ${latest.tag_name || latest.name}`);
        if (openNotice) setShowNotice(true);
      } else {
        setRelease(null);
        setShowNotice(false);
        setVerdict("You're up to date.");
      }
    } catch (error) {
      console.warn("Unable to check for app updates.", error);
      setVerdict("Unable to check for updates.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkForUpdate(false);
  }, [checkForUpdate]);

  const dismissRelease = useCallback(() => {
    if (release) {
      localStorage.setItem(DISMISSED_RELEASE_KEY, release.tag_name);
      setShowNotice(false);
    }
  }, [release]);

  return { release, showNotice, checking, verdict, checkForUpdate, dismissRelease };
}
