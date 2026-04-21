type InlineErrorMessageProps = {
  message: string | null;
};

export function InlineErrorMessage({ message }: InlineErrorMessageProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
      <p style={{ fontSize: "11px" }} className="text-red-600">
        {message}
      </p>
    </div>
  );
}
