import { invokeDesktop } from "../../lib/tauri";

export type MailProvider = "gmail" | "outlook" | "qq";

export interface MailOAuthStatus {
  provider: MailProvider;
  configured: boolean;
  connected: boolean;
  email: string | null;
  redirectUri: string;
  requiresPassword: boolean;
  clientId: string | null;
}

export const registrationApi = {
  mailStatus: (provider: MailProvider) => invokeDesktop<MailOAuthStatus>("get_mail_oauth_status", { provider }),
  saveMailConfig: (provider: MailProvider, clientId: string, clientSecret?: string) => invokeDesktop<MailOAuthStatus>("save_mail_oauth_config", { request: { provider, clientId, clientSecret: clientSecret || null } }),
  connectMail: (provider: MailProvider) => invokeDesktop<MailOAuthStatus>("start_mail_oauth", { provider }),
  disconnectMail: (provider: MailProvider) => invokeDesktop<void>("disconnect_mail_oauth", { provider }),
  saveMailPassword: (provider: MailProvider, email: string, password: string) => invokeDesktop<MailOAuthStatus>("save_mail_password_config", { request: { provider, email, password } }),
  pollCode: (provider: MailProvider, email: string, stationUrl: string, startedAt: number) => invokeDesktop<string>("poll_registration_code", { request: { provider, email, stationUrl, startedAt } }),
};
