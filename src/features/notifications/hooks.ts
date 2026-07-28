import { useCallback, useState } from "react";

/** Local dialog state so shell and future notification surfaces share one contract. */
export function useMessagesDialog(initiallyOpen = false) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, open, close };
}
