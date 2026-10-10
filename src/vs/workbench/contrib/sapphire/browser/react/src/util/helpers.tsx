import { useCallback, useRef, useState } from 'react';

type ReturnType<T> = [{ readonly current: T }, (t: T) => void];

// Когда useState не успевает за частыми обновлениями (стриминг Ctrl+K и т.п.)
export const useRefState = <T,>(initVal: T): ReturnType<T> => {
  // Счётчик, а не boolean: при быстрых toggle boolean React может не перерисовать UI
  // (симптом — JSX «есть», но на экране пусто).
  const [_s, _setState] = useState(0);

  const ref = useRef<T>(initVal);
  const setState = useCallback((newVal: T) => {
    _setState((n) => n + 1); // форсируем rerender
    ref.current = newVal;
  }, []);
  return [ref, setState];
};
