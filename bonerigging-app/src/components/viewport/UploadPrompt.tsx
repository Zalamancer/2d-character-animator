interface UploadPromptProps {
  visible: boolean;
}

export function UploadPrompt({ visible }: UploadPromptProps) {
  if (!visible) return null;
  return (
    <div className="upload-prompt">
      <div className="icon">🎨</div>
      <div>Drop a character file here</div>
      <div className="hint">SVG, PNG, JPG, WebP supported</div>
    </div>
  );
}
