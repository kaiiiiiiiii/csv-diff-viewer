import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface FullScreenProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  children: ReactNode;
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const currentElement = () => {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

/**
 * Minimal Fullscreen API wrapper. Replaces `react-fullscreen-crossbrowser`,
 * whose CJS default export resolves to the module namespace object in the
 * production bundle and crashes React (error #130).
 */
export default function FullScreen({
  enabled,
  onChange,
  children,
}: FullScreenProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const handler = () => onChangeRef.current(!!currentElement());
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  useEffect(() => {
    const node = nodeRef.current as WebkitElement | null;
    const active = !!currentElement();
    if (enabled && !active && node) {
      const request = node.requestFullscreen ?? node.webkitRequestFullscreen;
      // Rejection (e.g. no user gesture) → sync state back
      Promise.resolve(request?.call(node)).catch(() =>
        onChangeRef.current(false),
      );
    } else if (!enabled && active) {
      const doc = document as WebkitDocument;
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      void Promise.resolve(exit?.call(doc)).catch(() => undefined);
    }
  }, [enabled]);

  return (
    <div ref={nodeRef} style={{ height: "100%", width: "100%" }}>
      {children}
    </div>
  );
}
