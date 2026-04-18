export const isLikelyMobileBrowser = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  const isTouchMac =
    /Macintosh/i.test(userAgent) && (navigator.maxTouchPoints || 0) > 1;

  return (
    isTouchMac ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    )
  );
};

export const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition,
  );
};
