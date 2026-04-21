type ErrorOverlayProps = {
  message: string | null;
};

export function ErrorOverlay({ message }: ErrorOverlayProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-white text-center px-4">
      <span className="text-lg font-semibold">{message}</span>
    </div>
  );
}
