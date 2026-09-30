import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * false on the server and while React hydrates, true right after. Gate anything that depends on the viewer's clock or
 * time zone (today, the hour a timed event lands on) behind it, or the server's HTML and the browser's disagree.
 */
export const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);
