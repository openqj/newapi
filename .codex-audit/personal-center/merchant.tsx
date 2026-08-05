import { createRoot } from "react-dom/client";
import { ConfirmationProvider, ToastProvider } from "../../src/components/ui";
import { MerchantAdminPage } from "../../src/features/merchant/pages/MerchantAdminPage";
import "../../src/App.css";

createRoot(document.getElementById("root")!).render(<ToastProvider><ConfirmationProvider><MerchantAdminPage /></ConfirmationProvider></ToastProvider>);
