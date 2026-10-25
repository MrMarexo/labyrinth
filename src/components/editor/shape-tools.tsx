"use client";

import { useTranslations } from "next-intl";

import { RadioButtons } from "~/components/radio-buttons";
import { iconButtonClass, Tooltip } from "~/components/tooltip";
import { BRUSH_SIZES, type BrushSize, type Tool } from "~/maze";
import { BrushIcon, PALETTE_GROUP, PALETTE_ROWS, ToolIcon } from "./tool-icons";

export type ShapeToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Turns the move tool on, or off again back to the tool before it. */
  onToggleMove: () => void;
  used: number;
  budget: number;
  brush: BrushSize;
  onBrush: (brush: BrushSize) => void;
};

/** The two shape tools, in display and arrow-key order. */
const SHAPE_TOOLS: readonly Tool[] = ["paint", "erase-cell"];

export function ShapeTools({
  tool,
  onTool,
  onToggleMove,
  used,
  budget,
  brush,
  onBrush,
}: ShapeToolsProps) {
  const t = useTranslations("editor");

  function toolLabel(option: Tool): string {
    if (option === "move") return t("move");
    return option === "paint" ? t("paint") : t("eraseCell");
  }
  function brushLabel(size: BrushSize): string {
    return t("brushSize", { size });
  }

  const renderTool = (option: Tool) => (
    <>
      <ToolIcon tool={option} />
      <Tooltip label={toolLabel(option)} />
    </>
  );

  // On a desktop one column, like the detail palette: move, then the brush
  // size, then what the brush does. On a phone the three groups share a row.
  return (
    <div className="space-y-3">
      <div className={PALETTE_ROWS}>
        {/* A toggle, not a radio: pressed again, it hands back the tool
            that was active before it. */}
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={tool === "move"}
            aria-label={t("move")}
            onClick={onToggleMove}
            className={iconButtonClass(tool === "move")}
          >
            <ToolIcon tool="move" />
            <Tooltip label={t("move")} />
          </button>
        </div>
        <RadioButtons
          aria-label={t("brushLabel")}
          options={BRUSH_SIZES}
          value={brush}
          onChange={onBrush}
          optionLabel={brushLabel}
          renderOption={(size) => (
            <>
              <BrushIcon size={size} />
              <Tooltip label={brushLabel(size)} />
            </>
          )}
          buttonClass={iconButtonClass}
          className={PALETTE_GROUP}
        />
        {/* `tool` is shared with the detail palette, so a group can hold a
            value none of its buttons represents; RadioButtons keeps a tab
            stop anyway. */}
        <RadioButtons
          aria-label={t("shapeToolsLabel")}
          options={SHAPE_TOOLS}
          value={tool}
          onChange={onTool}
          optionLabel={toolLabel}
          renderOption={renderTool}
          buttonClass={iconButtonClass}
          className={PALETTE_GROUP}
        />
      </div>

      <p data-budget className="text-sm">
        {t("budget", { used, budget })}
      </p>
    </div>
  );
}
