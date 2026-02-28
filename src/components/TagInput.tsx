import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface TagInputProps {
  tags: string[];
  knownTags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ tags, knownTags, onChange, placeholder = "Add tag…" }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = knownTags.filter(
    (t) => t.toLowerCase().includes(inputValue.toLowerCase()) &&
           !tags.some(s => s.toLowerCase() === t.toLowerCase())
  );

  // Compute dropdown position from the container's current layout
  let dropdownPos: { top: number; left: number; width: number } | null = null;
  if (dropdownOpen && containerRef.current) {
    const rect = containerRef.current.getBoundingClientRect();
    dropdownPos = { top: rect.bottom + 4, left: rect.left, width: rect.width };
  }

  const addTag = useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (!tag || tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
        setInputValue("");
        return;
      }
      const canonical = knownTags.find(t => t.toLowerCase() === tag.toLowerCase()) ?? tag;
      onChange([...tags, canonical]);
      setInputValue("");
      setHighlightedIndex(-1);
    },
    [tags, onChange, knownTags]
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          addTag(suggestions[highlightedIndex]);
        } else {
          addTag(inputValue);
        }
        setDropdownOpen(false);
      } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
        removeTag(tags.length - 1);
      } else if (e.key === "Escape") {
        setDropdownOpen(false);
        setHighlightedIndex(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setDropdownOpen(true);
        setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, -1));
      }
    },
    [inputValue, suggestions, highlightedIndex, addTag, removeTag, tags]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.endsWith(",")) {
      addTag(val.slice(0, -1));
      setDropdownOpen(false);
      return;
    }
    setInputValue(val);
    setDropdownOpen(val.length > 0);
    setHighlightedIndex(-1);
  }, [addTag]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <>
      <div ref={containerRef} className="relative">
        <div
          className="min-h-[2.25rem] w-full flex flex-wrap gap-1 items-center px-2 py-1.5 rounded-md border border-input bg-background cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((tag, i) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#c9a84c]/10 text-foreground border border-[#c9a84c]/60"
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(i);
                }}
                className="opacity-70 hover:opacity-100 leading-none"
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onFocus={() => {
              if (inputValue.length > 0) setDropdownOpen(true);
            }}
            placeholder={tags.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[6rem] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {dropdownOpen && suggestions.length > 0 && dropdownPos &&
        createPortal(
          <ul
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            className="z-[9999] rounded-md border border-[#333] bg-[#1a1a1a] text-[#e0e0e0] shadow-lg max-h-40 overflow-y-auto"
          >
            {suggestions.map((s, i) => (
              <li
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(s);
                  setDropdownOpen(false);
                }}
                className={`px-3 py-1.5 text-sm cursor-pointer ${
                  i === highlightedIndex ? "bg-[#c9a84c]/30 text-[#c9a84c]" : "hover:bg-[#242424]"
                }`}
              >
                {s}
              </li>
            ))}
          </ul>,
          document.body
        )
      }
    </>
  );
}
