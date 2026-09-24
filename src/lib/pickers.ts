/**
 * Open the native date/time picker when the user clicks anywhere in a
 * date or time field, not just on the small calendar/clock icon.
 * Registered once per window (main + popup).
 */
export function openPickersOnClick() {
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.type !== "date" && el.type !== "time" && el.type !== "datetime-local") return;
    if (el.disabled || el.readOnly) return;
    try {
      el.showPicker();
    } catch {
      // showPicker can throw if the picker is already open; clicking the icon still works.
    }
  });
}
