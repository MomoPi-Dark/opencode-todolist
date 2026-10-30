export interface ClearDialogCopy {
    title: string;
    description: string;
    accept: string;
    cancel: string;
    acceptLabel: string;
    cancelLabel: string;
}

export const CLEAR_DIALOG: ClearDialogCopy = {
    title: "Clear the todo list?",
    description: "Every item of this session is removed from the stored list.",
    accept: "Clear the list.",
    cancel: "Keep the list as it is.",
    acceptLabel: "Clear",
    cancelLabel: "Cancel",
};

export type ClearChoice = "clear" | "cancel";

export const clearConsent = (answer: ClearChoice | undefined): boolean =>
    answer === "clear";

export const clearDialogAnswer = (confirm: boolean) => ({
    confirm,
    accept_message: CLEAR_DIALOG.accept,
    cancel_message: CLEAR_DIALOG.cancel,
});
