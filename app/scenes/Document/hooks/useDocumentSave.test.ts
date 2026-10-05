import {
  deferUnlessRemounted,
  shouldAutoDeleteDraftOnUnmount,
} from "./useDocumentSave";

describe("shouldAutoDeleteDraftOnUnmount", () => {
  const baseOptions = {
    title: "",
    createdById: "user-1",
    currentUserId: "user-1",
    isDraft: true,
    isActive: true,
    hasEmptyTitle: true,
    isPersistedOnce: true,
  };

  it("does not auto delete drafts with non-empty editor content", () => {
    expect(
      shouldAutoDeleteDraftOnUnmount({
        ...baseOptions,
        isEditorEmpty: false,
      })
    ).toBe(false);
  });

  it("auto deletes drafts that are still empty and untitled", () => {
    expect(
      shouldAutoDeleteDraftOnUnmount({
        ...baseOptions,
        isEditorEmpty: true,
      })
    ).toBe(true);
  });
});

describe("deferUnlessRemounted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the action once the delay has elapsed", () => {
    const action = vi.fn();
    deferUnlessRemounted(action);

    expect(action).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not run the action when cancelled before the delay", () => {
    const action = vi.fn();
    const cancel = deferUnlessRemounted(action);

    cancel();
    vi.runAllTimers();
    expect(action).not.toHaveBeenCalled();
  });
});
