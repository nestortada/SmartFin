import { useCallback, useEffect, useRef, useState } from 'react';

export function useSubscriptionQuery<T>(query: () => Promise<T>, revision = 0) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const current = useRef(0);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    const token = ++current.current;
    setLoading(true);
    setError(undefined);
    try {
      const value = await query();
      if (mounted.current && token === current.current) setData(value);
    } catch (reason) {
      if (mounted.current && token === current.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'No se pudo consultar la información.',
        );
    } finally {
      if (mounted.current && token === current.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    mounted.current = true;
    setData(undefined);
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload, revision]);
  return { data, loading, error, reload };
}
