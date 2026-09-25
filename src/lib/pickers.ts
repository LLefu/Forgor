/**
 * Date/time fields act as one control: a mouse click anywhere opens the native
 * picker, and the whole field is highlighted instead of the day/month/year
 * segment under the cursor. (That segment highlight lives inside the input's
 * internals and can't be restyled with CSS, so we stop the click from focusing
 * a segment.) Keyboard users can still Tab in and type.
 * Registered once per window (main + popup).
 */
const PICKER_TYPES = new Set(["date", "time", "datetime-local"]);
const OPEN_CLASS = "picker-open";

function pickerInput(target: EventTarget | null): HTMLInputElement | null {
  return target instanceof HTMLInputElement && PICKER_TYPES.has(target.type) && !target.disabled && !target.readOnly ? target : null;
}

const canShowPicker = typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype;

export function openPickersOnClick() {
  let open: HTMLInputElement | null = null;
  const clearOpen = () => {
    open?.classList.remove(OPEN_CLASS);
    open = null;
  };

  document.addEventListener(
    "mousedown",
    (e) => {
      const el = pickerInput(e.target);
      if (el !== open) clearOpen();
      // Only when we can open the picker ourselves; otherwise keep the native behaviour.
      if (el && canShowPicker && e.button === 0) e.preventDefault();
    },
    true,
  );

  document.addEventListener("click", (e) => {
    const el = pickerInput(e.target);
    if (!el) return;
    try {
      el.showPicker();
      clearOpen();
      el.classList.add(OPEN_CLASS);
      open = el;
    } catch {
      el.focus(); // picker unavailable: at least allow typing
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target === open) clearOpen();
  });
  window.addEventListener("blur", () => {
    // The native picker takes focus while open; clear once the window is active again.
    window.addEventListener("focus", clearOpen, { once: true });
  });
}
