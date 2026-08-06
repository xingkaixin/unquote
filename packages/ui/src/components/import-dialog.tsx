import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface ImportDialogProps {
  open: boolean;
  dismissible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export const ImportDialog = ({ open, dismissible, onClose, children }: ImportDialogProps) => {
  const { t } = useTranslation();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="uq-dialog-backdrop fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[6px]" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <Dialog.Popup className="uq-dialog-popup flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-border-medium bg-surface-100 shadow-[var(--shadow-panel)] outline-none">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <Dialog.Title className="m-0 text-[15px] font-semibold text-text-primary">
                {t("import.title")}
              </Dialog.Title>
              <Dialog.Description className="m-0 text-[12px] text-text-tertiary">
                {t("import.subtitle")}
              </Dialog.Description>
              <span className="flex-1" />
              {dismissible ? (
                <Dialog.Close
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-md px-3 text-[11px] normal-case tracking-normal"
                    >
                      {t("import.back")}
                    </Button>
                  }
                />
              ) : null}
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
