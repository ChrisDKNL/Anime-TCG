import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * A button that opens a `role="menu"` with roving tabindex (accounts.md §7):
 * Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows
 * move and wrap; Home/End; Escape closes and returns focus to the button; Tab
 * closes and lets focus move on from the button; clicking outside closes.
 */
export function useMenu(itemCount: number) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemElements = useRef<Array<HTMLElement | null>>([]);

  const openAt = useCallback((index: number) => {
    setActiveIndex(index);
    setOpen(true);
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) itemElements.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /** Enter and Space arrive here as a click. */
  const onButtonClick = useCallback(() => {
    if (open) close(false);
    else openAt(0);
  }, [open, close, openAt]);

  const onButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openAt(0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        openAt(itemCount - 1);
      }
    },
    [openAt, itemCount],
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((i) => (i + 1) % itemCount);
          break;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((i) => (i - 1 + itemCount) % itemCount);
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(itemCount - 1);
          break;
        case "Escape":
          event.preventDefault();
          close(true);
          break;
        case "Tab":
          // Focus goes back to the button first so the browser's Tab moves on from there.
          close(true);
          break;
      }
    },
    [itemCount, close],
  );

  const itemRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      itemElements.current[index] = element;
    },
    [],
  );

  return {
    open,
    activeIndex,
    rootRef,
    buttonRef,
    itemRef,
    onButtonClick,
    onButtonKeyDown,
    onMenuKeyDown,
    close,
  };
}
