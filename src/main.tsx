import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MerchantMarketplacePage } from "./features/merchant/pages/MerchantMarketplacePage";
import { ConfirmationProvider, PromptProvider, ToastProvider } from "./components/ui";
import "./index.css";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RelayHub render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900">
          <section className="max-w-lg rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold">RelayHub failed to render</h1>
            <p className="mt-2 text-sm text-slate-600">{this.state.error.message}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

document.documentElement.dataset.appMounted = "true";
const isMerchantWindow = new URLSearchParams(window.location.search).get("window") === "merchant-market";
if (isMerchantWindow) document.body.classList.add("merchant-market-body");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <ConfirmationProvider>
          <PromptProvider>
            {isMerchantWindow ? <MerchantMarketplacePage /> : <App />}
          </PromptProvider>
        </ConfirmationProvider>
      </ToastProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
