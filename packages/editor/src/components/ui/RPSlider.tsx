import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * RPSlider — exact replica of AutoStudio's RPSlider from RightPanel.tsx
 * with editable value box (click to type) and instant thumb response.
 */
export function RPSlider({ label, value, onChange, min, max, step, precision = 0 }: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number; precision?: number
}) {
  const display = precision > 0 ? value.toFixed(precision) : String(Math.round(value))
  const pct = ((value - min) / (max - min)) * 100

  // Editable value box state
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(display)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
    }
  }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    const parsed = parseFloat(editText)
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed))
      onChange(clamped)
    }
  }, [editText, min, max, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }, [commitEdit])

  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-gray-400 text-sm w-20 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex items-center gap-2 flex-1">
        {/* Value box — click to edit */}
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded-lg min-w-[48px] w-[56px] text-center focus:outline-none focus:ring-1 focus:ring-[#4a7eff]"
          />
        ) : (
          <div
            className="bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded-lg min-w-[48px] text-center cursor-text"
            onClick={() => { setEditText(display); setEditing(true) }}
          >
            {display}
          </div>
        )}
        {/* Slider track — no transition for instant response */}
        <div className="flex-1 relative h-8 bg-[#2a2a2a] rounded-lg overflow-hidden">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-5 bg-[#5a5a5a] rounded-md pointer-events-none"
            style={{ left: `${pct}%`, width: '20px', transform: 'translate(-50%, -50%)' }}
          />
        </div>
      </div>
    </div>
  )
}
