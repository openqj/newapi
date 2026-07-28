import { useEffect, useState } from "react";
import { useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../api";
import { LoginProfileTableManager } from "../components/LoginProfileTableManager";
import type { LoginProfile } from "../types";

type LoginProfilesPageProps = {
  demoProfiles: LoginProfile[];
};

export function LoginProfilesPage({
  demoProfiles,
}: LoginProfilesPageProps) {
  const { notify } = useToast();
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
      notify(errorMessage(reason), "error");
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  return (
    <>
      <div>
        <div>
          <p className="text-sm text-slate-500">
            复用中转站登录凭据
          </p>
          <h1 className="mt-1 text-2xl font-semibold">常用登录</h1>
        </div>
      </div>
      <LoginProfileTableManager
        embedded
        profiles={profiles}
        onChanged={loadProfiles}
      />
    </>
  );
}
