import { Dialog, type DialogProps } from "./ui/Dialog";

export type FormDialogProps = Omit<DialogProps, "portal" | "asForm">;

export function FormDialog(props: FormDialogProps) {
  return <Dialog {...props} asForm />;
}
