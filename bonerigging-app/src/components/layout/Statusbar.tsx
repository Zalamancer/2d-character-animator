interface StatusbarProps {
  text: string;
}

export function Statusbar({ text }: StatusbarProps) {
  return (
    <div id="statusbar">
      {text}
    </div>
  );
}
