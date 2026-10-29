import { useCallback, useEffect, useRef, useState } from "react";

interface FocusRequest<F extends string> {
  field: F;
  seq: number;
}

/**
 * Focus moves inside a form (first invalid field, next step's first field)
 * without `autoFocus`: the form hook calls `focusField`, the component hands
 * `fieldRef(field)` to each input, and the move happens after the render that
 * mounted or marked the field. Each request has its own sequence number so the
 * same field can be focused twice in a row. `initialField` is focused as soon
 * as the form mounts (the delete-confirm password field, §7 "Dialog").
 */
export function useFieldFocus<F extends string>(initialField?: F) {
  const elements = useRef(new Map<F, HTMLElement>());
  const [request, setRequest] = useState<FocusRequest<F> | null>(
    initialField === undefined ? null : { field: initialField, seq: 1 },
  );

  useEffect(() => {
    if (request !== null) elements.current.get(request.field)?.focus();
  }, [request]);

  const focusField = useCallback((field: F) => {
    setRequest((previous) => ({ field, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  const fieldRef = useCallback(
    (field: F) => (element: HTMLElement | null) => {
      if (element === null) elements.current.delete(field);
      else elements.current.set(field, element);
    },
    [],
  );

  return { focusField, fieldRef };
}
