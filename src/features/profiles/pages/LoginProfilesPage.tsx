import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import { LoginProfileTableManager } from "../components/LoginProfileTableManager";
import type { LoginProfile } from "../types";

type LoginProfilesPageProps = {
  demoProfiles: LoginProfile[];
  setError: (message: string) => void;
  onAddStation: () => void;
};

export function LoginProfilesPage({
  demoProfiles,
  setError,
  onAddStation,
}: LoginProfilesPageProps) {
  const [profiles, setProfiles] = useState<LoginProfile[]>(() =>
    isTauri() ? [] : demoProfiles,
  );

  const loadProfiles = async () => {
    if (!isTauri()) {
      setProfiles(demoProfiles);
      return;
    }
    try {
      setProfiles(await profileApi.list<LoginProfile[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">
            \u590d\u7528\u4e2d\u8f6c\u7ad9\u767b\u5f55\u51ed\u636e
          </p>
          <h1 className="mt-1 text-2xl font-semibold">\u5e38\u7528\u767b\u5f55</h1>
        </div>
        <button type="button" className="button-primary" onClick={onAddStation}>
          <Plus size={16} />
          \u6dfb\u52a0\u7ad9\u70b9
        </button>
      </div>
      <LoginProfileTableManager
        embedded
        profiles={profiles}
        onChanged={loadProfiles}
        setError={setError}
      />
    </>
  );
}
